import { invariant } from './core.mjs';
import { normalizeGraphMemoryState, validateGraphMemoryState } from './graph-memory.mjs';

const EVIDENCE_TYPES = new Set(['Evidence', 'Evaluation', 'Artifact', 'Source', 'Metric', 'Claim']);
const ACCEPTED_EVIDENCE_STATUSES = new Set(['verified', 'approved', 'active']);
const TERMINAL_RELEASE_STATES = new Set(['certification', 'certified', 'release-pending', 'released', 'observed', 'validated']);

const clone = value => structuredClone(value);

export function validateGatePolicy(policy, governance) {
  invariant(policy && typeof policy === 'object', 'Gate policy is required');
  invariant(policy.version === 1, 'Unsupported gate policy version');
  invariant(Array.isArray(policy.requireContextFrom), 'requireContextFrom must be an array');
  invariant(Array.isArray(policy.requireEvidenceFrom), 'requireEvidenceFrom must be an array');
  invariant(policy.minEvidenceByRisk && typeof policy.minEvidenceByRisk === 'object', 'minEvidenceByRisk is required');
  invariant(policy.approvalsByState && typeof policy.approvalsByState === 'object', 'approvalsByState is required');
  invariant(Array.isArray(policy.protectedPaths), 'protectedPaths must be an array');
  invariant(policy.deliveryGraph && typeof policy.deliveryGraph === 'object', 'deliveryGraph policy is required');
  invariant(Array.isArray(policy.deliveryGraph.triggerRiskLevels), 'deliveryGraph.triggerRiskLevels must be an array');
  invariant(Array.isArray(policy.deliveryGraph.triggerSignals), 'deliveryGraph.triggerSignals must be an array');
  invariant(Number.isInteger(policy.deliveryGraph.repeatedFailureThreshold) && policy.deliveryGraph.repeatedFailureThreshold >= 1, 'deliveryGraph.repeatedFailureThreshold must be positive');
  invariant(Array.isArray(policy.deliveryGraph.requiredFromStates), 'deliveryGraph.requiredFromStates must be an array');
  invariant(Array.isArray(policy.blockContradictionsFrom), 'blockContradictionsFrom must be an array');
  invariant(policy.minimumPermissionByState && typeof policy.minimumPermissionByState === 'object', 'minimumPermissionByState is required');
  invariant(governance && Array.isArray(governance.lifecycle), 'Governance lifecycle is required');

  const knownStates = new Set([...governance.lifecycle, ...(governance.exceptionStates ?? [])]);
  for (const state of [
    ...policy.requireContextFrom,
    ...policy.requireEvidenceFrom,
    ...policy.deliveryGraph.requiredFromStates,
    ...policy.blockContradictionsFrom,
    ...Object.keys(policy.approvalsByState),
    ...Object.keys(policy.minimumPermissionByState)
  ]) invariant(knownStates.has(state), `Unknown gate state: ${state}`);

  const knownApprovals = new Set(governance.approvalTypes ?? []);
  for (const approvals of Object.values(policy.approvalsByState)) {
    invariant(Array.isArray(approvals), 'Each approvalsByState value must be an array');
    for (const approval of approvals) invariant(knownApprovals.has(approval), `Unknown approval type in gate policy: ${approval}`);
  }
  for (const item of policy.protectedPaths) {
    invariant(typeof item.pattern === 'string' && item.pattern, 'Protected path pattern is required');
    invariant(knownApprovals.has(item.approval), `Unknown protected-path approval: ${item.approval}`);
  }
  for (const risk of governance.riskLevels ?? []) {
    invariant(Number.isInteger(policy.minEvidenceByRisk[risk]) && policy.minEvidenceByRisk[risk] >= 0, `Missing evidence floor for risk ${risk}`);
  }
  return true;
}

export function evaluateGate({
  slice,
  requestedState,
  governance,
  policy,
  graph,
  context = null,
  approvals = [],
  evidenceIds = [],
  changedPaths = [],
  deliveryGraph = null,
  authority = { humanApprovalRequired: [], agentMaySelfApprove: false }
}) {
  invariant(slice && typeof slice === 'object', 'Slice is required');
  invariant(typeof slice.id === 'string' && slice.id, 'Slice id is required');
  invariant(typeof slice.objectiveId === 'string' && slice.objectiveId, 'Slice objectiveId is required');
  invariant(typeof slice.state === 'string' && slice.state, 'Slice state is required');
  invariant(typeof requestedState === 'string' && requestedState, 'requestedState is required');
  invariant(governance && Array.isArray(governance.lifecycle), 'Governance is required');
  validateGatePolicy(policy, governance);

  const state = normalizeGraphMemoryState(graph);
  validateGraphMemoryState(state);
  const blockers = [];
  const warnings = [];

  validateTransitionShape(slice.state, requestedState, governance, blockers);
  const protectedMatches = matchProtectedPaths(changedPaths, policy.protectedPaths);
  const requiredApprovals = requiredApprovalsFor(requestedState, policy, protectedMatches);
  const approvalResult = validateApprovals(requiredApprovals, approvals, authority, slice.id);
  blockers.push(...approvalResult.blockers);

  const delivery = evaluateDeliveryGraphRequirement({ slice, requestedState, policy, protectedMatches, deliveryGraph });
  if (delivery.required && delivery.blocking) blockers.push({ code: 'delivery-graph-not-ready', message: `Delivery graph is required before entering ${requestedState}`, details: delivery.reasons });

  const contextRequired = policy.requireContextFrom.includes(requestedState);
  if (contextRequired) validateContextForGate({ context, graphState: state, objectiveId: slice.objectiveId, blockers });

  const evidenceRequired = policy.requireEvidenceFrom.includes(requestedState);
  const evidenceFloor = evidenceRequired ? (policy.minEvidenceByRisk[slice.riskLevel] ?? 0) : 0;
  const evidence = evaluateEvidence(state, slice.objectiveId, evidenceIds, policy.maxEvidenceHops ?? 3);
  if (evidenceFloor > evidence.accepted.length) {
    blockers.push({
      code: 'insufficient-linked-evidence',
      message: `Transition requires ${evidenceFloor} linked verified evidence item(s); found ${evidence.accepted.length}`,
      details: { required: evidenceFloor, accepted: evidence.accepted.map(item => item.id), rejected: evidence.rejected }
    });
  }

  if (policy.blockContradictionsFrom.includes(requestedState) && (context?.contradictions?.length ?? 0) > 0) {
    blockers.push({ code: 'unresolved-context-contradictions', message: 'Relevant context contains unresolved contradictions', details: context.contradictions });
  }

  const permission = validatePermission(slice.implementationPermission, requestedState, governance, policy);
  if (!permission.ok) blockers.push({ code: 'insufficient-implementation-permission', message: permission.message });

  if (slice.riskLevel === 'high' && TERMINAL_RELEASE_STATES.has(requestedState) && !approvalResult.validTypes.has('certification')) {
    warnings.push({ code: 'high-risk-certification-review', message: 'High-risk release path should retain explicit certification approval through release.' });
  }

  return {
    allowed: blockers.length === 0,
    sliceId: slice.id,
    fromState: slice.state,
    requestedState,
    blockers,
    warnings,
    requiredApprovals,
    validApprovals: [...approvalResult.validTypes],
    protectedPaths: protectedMatches,
    evidence,
    deliveryGraph: delivery,
    context: context ? {
      hash: context.contextHash ?? null,
      graphRevision: context.graphRevision ?? null,
      contradictions: context.contradictions?.length ?? 0
    } : null
  };
}

export function assertGateAllowed(input) {
  const result = evaluateGate(input);
  invariant(result.allowed, `PES gate blocked transition: ${result.blockers.map(item => item.code).join(', ')}`);
  return result;
}

function validateTransitionShape(fromState, requestedState, governance, blockers) {
  const lifecycle = governance.lifecycle;
  const exceptions = new Set(governance.exceptionStates ?? []);
  invariant(lifecycle.includes(fromState) || exceptions.has(fromState), `Unknown current lifecycle state: ${fromState}`);
  invariant(lifecycle.includes(requestedState) || exceptions.has(requestedState), `Unknown requested lifecycle state: ${requestedState}`);
  if (exceptions.has(requestedState)) return;
  const fromIndex = lifecycle.indexOf(fromState);
  const toIndex = lifecycle.indexOf(requestedState);
  if (fromIndex < 0 || toIndex !== fromIndex + 1) {
    blockers.push({ code: 'invalid-lifecycle-transition', message: `Expected next lifecycle state after ${fromState}, received ${requestedState}` });
  }
}

function requiredApprovalsFor(requestedState, policy, protectedMatches) {
  const required = new Set(policy.approvalsByState[requestedState] ?? []);
  for (const match of protectedMatches) required.add(match.approval);
  return [...required];
}

function validateApprovals(required, approvals, authority, sliceId) {
  const blockers = [];
  const validTypes = new Set();
  const humanRequired = new Set(authority.humanApprovalRequired ?? []);
  for (const type of required) {
    const candidates = approvals.filter(item => item?.type === type && item?.scopeId === sliceId && item?.status === 'approved');
    const valid = candidates.find(item => {
      if (authority.agentMaySelfApprove === false && item.actorType === 'agent') return false;
      if (humanRequired.has(type) && item.actorType !== 'human') return false;
      return true;
    });
    if (!valid) {
      blockers.push({
        code: 'missing-required-approval',
        message: `Missing valid ${type} approval for ${sliceId}`,
        details: { type, humanRequired: humanRequired.has(type) }
      });
    } else validTypes.add(type);
  }
  return { blockers, validTypes };
}

function matchProtectedPaths(paths, rules) {
  const matches = [];
  for (const path of paths) {
    for (const rule of rules) {
      if (matchesPath(path, rule.pattern)) matches.push({ path, ...clone(rule) });
    }
  }
  return matches;
}

function matchesPath(path, pattern) {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -3));
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  return path === pattern;
}

function evaluateDeliveryGraphRequirement({ slice, requestedState, policy, protectedMatches, deliveryGraph }) {
  const reasons = [];
  if (policy.deliveryGraph.triggerRiskLevels.includes(slice.riskLevel)) reasons.push(`risk:${slice.riskLevel}`);
  for (const signal of policy.deliveryGraph.triggerSignals) if (slice[signal] === true) reasons.push(`signal:${signal}`);
  if ((slice.repeatedFailureCount ?? 0) >= policy.deliveryGraph.repeatedFailureThreshold) reasons.push(`repeated-failures:${slice.repeatedFailureCount}`);
  if (protectedMatches.some(item => item.deliveryGraph === true)) reasons.push('protected-path');
  const required = reasons.length > 0;
  const blocking = required && policy.deliveryGraph.requiredFromStates.includes(requestedState) && deliveryGraph?.status !== 'ready';
  return { required, blocking, status: deliveryGraph?.status ?? null, reasons: [...new Set(reasons)] };
}

function validateContextForGate({ context, graphState, objectiveId, blockers }) {
  if (!context || typeof context.contextHash !== 'string' || !context.contextHash) {
    blockers.push({ code: 'missing-context', message: 'A hashed bounded context is required for this transition' });
    return;
  }
  if (context.graphRevision !== graphState.revision) blockers.push({ code: 'stale-context', message: `Context graph revision ${context.graphRevision} does not match current revision ${graphState.revision}` });
  const seeds = new Set([...(context.requestedSeeds ?? []), ...(context.resolvedSeeds ?? [])]);
  if (!seeds.has(objectiveId)) blockers.push({ code: 'context-missing-objective', message: `Context does not include slice objective ${objectiveId} as a seed` });
}

function evaluateEvidence(state, objectiveId, evidenceIds, maxHops) {
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  const accepted = [];
  const rejected = [];
  for (const id of [...new Set(evidenceIds)]) {
    const node = byId.get(id);
    if (!node) {
      rejected.push({ id, reason: 'missing-node' });
      continue;
    }
    if (!EVIDENCE_TYPES.has(node.type)) {
      rejected.push({ id, reason: `unsupported-type:${node.type}` });
      continue;
    }
    if (node.status && !ACCEPTED_EVIDENCE_STATUSES.has(node.status)) {
      rejected.push({ id, reason: `unaccepted-status:${node.status}` });
      continue;
    }
    const distance = graphDistance(state, objectiveId, id, maxHops);
    if (distance === null) {
      rejected.push({ id, reason: 'not-linked-to-objective' });
      continue;
    }
    accepted.push({ id, type: node.type, status: node.status ?? null, distance });
  }
  return { accepted, rejected };
}

function graphDistance(state, fromId, toId, maxHops) {
  if (fromId === toId) return 0;
  const ids = new Set(state.nodes.map(node => node.id));
  if (!ids.has(fromId) || !ids.has(toId)) return null;
  const adjacency = new Map();
  for (const edge of state.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const queue = [{ id: fromId, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    if (current.depth >= maxHops) continue;
    for (const next of adjacency.get(current.id) ?? []) {
      if (next === toId) return current.depth + 1;
      if (!seen.has(next)) queue.push({ id: next, depth: current.depth + 1 });
    }
  }
  return null;
}

function validatePermission(permission, requestedState, governance, policy) {
  const minimum = policy.minimumPermissionByState[requestedState];
  if (!minimum) return { ok: true };
  const levels = governance.implementationPermissions ?? [];
  const actualIndex = levels.indexOf(permission);
  const minimumIndex = levels.indexOf(minimum);
  if (actualIndex < minimumIndex) return { ok: false, message: `${requestedState} requires implementation permission >= ${minimum}; current=${permission ?? 'missing'}` };
  return { ok: true };
}
