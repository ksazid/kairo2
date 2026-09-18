import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { invariant } from './core.mjs';
import { normalizeGraphMemoryState, validateGraphMemoryState } from './graph-memory.mjs';

const EXACT_SHA = /^[0-9a-f]{40}$/i;
const clone = value => structuredClone(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function validateCertificationPolicy(policy, governance) {
  invariant(policy && typeof policy === 'object', 'Certification policy is required');
  invariant(policy.version === 1, 'Unsupported certification policy version');
  invariant(Array.isArray(policy.requiredPreCertificationApprovals), 'requiredPreCertificationApprovals must be an array');
  invariant(typeof policy.finalApprovalType === 'string' && policy.finalApprovalType, 'finalApprovalType is required');
  invariant(Number.isInteger(policy.minimumArtifacts) && policy.minimumArtifacts >= 1, 'minimumArtifacts must be >= 1');
  invariant(Number.isInteger(policy.minimumEvaluations) && policy.minimumEvaluations >= 1, 'minimumEvaluations must be >= 1');
  invariant(policy.minimumEvidenceByRisk && typeof policy.minimumEvidenceByRisk === 'object', 'minimumEvidenceByRisk is required');
  invariant(Array.isArray(policy.acceptedGraphStatuses), 'acceptedGraphStatuses must be an array');
  invariant(Number.isInteger(policy.maxTraceHops) && policy.maxTraceHops >= 1, 'maxTraceHops must be >= 1');
  invariant(Array.isArray(policy.blockUnresolvedRiskLevels), 'blockUnresolvedRiskLevels must be an array');
  invariant(typeof policy.storeFile === 'string' && policy.storeFile, 'storeFile is required');
  invariant(governance && Array.isArray(governance.approvalTypes), 'Governance approval types are required');

  const approvalTypes = new Set(governance.approvalTypes);
  for (const type of policy.requiredPreCertificationApprovals) invariant(approvalTypes.has(type), `Unknown certification approval type: ${type}`);
  invariant(approvalTypes.has(policy.finalApprovalType), `Unknown final certification approval type: ${policy.finalApprovalType}`);
  for (const risk of governance.riskLevels ?? []) {
    invariant(Number.isInteger(policy.minimumEvidenceByRisk[risk]) && policy.minimumEvidenceByRisk[risk] >= 0, `Missing certification evidence floor for risk ${risk}`);
  }
  return true;
}

export function buildCertificationCandidate({
  bundleId,
  slice,
  commitSha,
  graph,
  context,
  gateResult,
  approvals = [],
  artifactIds = [],
  evidenceIds = [],
  evaluationIds = [],
  unresolvedRisks = [],
  governance,
  policy,
  authority,
  createdAt = new Date().toISOString()
}) {
  validateCertificationPolicy(policy, governance);
  invariant(typeof bundleId === 'string' && bundleId, 'bundleId is required');
  validateSlice(slice);
  invariant(EXACT_SHA.test(commitSha), 'Certification requires an exact 40-character commit SHA');
  const graphState = normalizeGraphMemoryState(graph);
  validateGraphMemoryState(graphState);

  const contextSnapshot = stripFunctions(context);
  const gateSnapshot = stripFunctions(gateResult);
  const blockers = validateCandidateInputs({
    slice,
    commitSha,
    graphState,
    context: contextSnapshot,
    gateResult: gateSnapshot,
    approvals,
    artifactIds,
    evidenceIds,
    evaluationIds,
    unresolvedRisks,
    policy,
    authority
  });
  invariant(blockers.length === 0, `Certification candidate blocked: ${blockers.map(item => item.code).join(', ')}`);

  const candidate = {
    schemaVersion: 1,
    bundleId,
    status: 'candidate',
    sliceId: slice.id,
    objectiveId: slice.objectiveId,
    riskLevel: slice.riskLevel,
    commitSha: commitSha.toLowerCase(),
    graphRevision: graphState.revision,
    contextHash: contextSnapshot.contextHash,
    contextSnapshot,
    gateDecisionHash: hash(gateSnapshot),
    gateSnapshot,
    approvals: clone(approvals),
    artifactIds: unique(artifactIds),
    evidenceIds: unique(evidenceIds),
    evaluationIds: unique(evaluationIds),
    unresolvedRisks: clone(unresolvedRisks),
    trace: buildTraceSummary(graphState, slice.objectiveId, {
      artifactIds,
      evidenceIds,
      evaluationIds,
      maxHops: policy.maxTraceHops
    }),
    createdAt
  };
  candidate.candidateHash = certificationCandidateHash(candidate);
  return candidate;
}

export function verifyCertificationCandidate(candidate, {
  graph,
  context = candidate?.contextSnapshot ?? null,
  gateResult = candidate?.gateSnapshot ?? null,
  governance,
  policy,
  authority,
  currentCommitSha = null,
  allowHistoricalGraphRevision = false
}) {
  validateCertificationPolicy(policy, governance);
  const blockers = [];
  if (!candidate || candidate.schemaVersion !== 1 || candidate.status !== 'candidate') {
    return { ok: false, blockers: [{ code: 'invalid-candidate-shape', message: 'Certification candidate shape is invalid' }] };
  }
  if (!EXACT_SHA.test(candidate.commitSha ?? '')) blockers.push({ code: 'invalid-exact-sha', message: 'Candidate commit SHA is invalid' });
  if (currentCommitSha && candidate.commitSha?.toLowerCase() !== currentCommitSha.toLowerCase()) blockers.push({ code: 'sha-mismatch', message: `Candidate SHA ${candidate.commitSha} does not match current SHA ${currentCommitSha}` });
  if (candidate.candidateHash !== certificationCandidateHash(candidate)) blockers.push({ code: 'candidate-hash-mismatch', message: 'Certification candidate hash does not match content' });

  const graphState = normalizeGraphMemoryState(graph);
  try { validateGraphMemoryState(graphState); } catch (error) { blockers.push({ code: 'invalid-graph-state', message: error.message }); }

  const effectivePolicy = allowHistoricalGraphRevision ? { ...policy, requireCurrentGraphRevision: false } : policy;
  blockers.push(...validateCandidateInputs({
    slice: { id: candidate.sliceId, objectiveId: candidate.objectiveId, riskLevel: candidate.riskLevel },
    commitSha: candidate.commitSha,
    graphState,
    context,
    gateResult,
    approvals: candidate.approvals,
    artifactIds: candidate.artifactIds,
    evidenceIds: candidate.evidenceIds,
    evaluationIds: candidate.evaluationIds,
    unresolvedRisks: candidate.unresolvedRisks,
    policy: effectivePolicy,
    authority
  }));

  if (allowHistoricalGraphRevision) {
    if (graphState.revision < candidate.graphRevision) blockers.push({ code: 'graph-history-missing', message: `Current graph revision ${graphState.revision} predates certified revision ${candidate.graphRevision}` });
  } else if (candidate.graphRevision !== graphState.revision) {
    blockers.push({ code: 'candidate-graph-revision-mismatch', message: `Candidate records graph revision ${candidate.graphRevision}; current=${graphState.revision}` });
  }

  if (candidate.contextHash !== context?.contextHash) blockers.push({ code: 'candidate-context-hash-mismatch', message: 'Candidate context hash no longer matches supplied context' });
  if (hash(stripFunctions(candidate.contextSnapshot)) !== hash(stripFunctions(context))) blockers.push({ code: 'candidate-context-snapshot-mismatch', message: 'Candidate context snapshot no longer matches supplied context' });
  if (candidate.gateDecisionHash !== hash(stripFunctions(gateResult))) blockers.push({ code: 'candidate-gate-hash-mismatch', message: 'Candidate gate decision hash no longer matches supplied gate result' });
  if (hash(candidate.gateSnapshot) !== hash(stripFunctions(gateResult))) blockers.push({ code: 'candidate-gate-snapshot-mismatch', message: 'Candidate gate snapshot no longer matches supplied gate result' });

  const expectedTrace = buildTraceSummary(graphState, candidate.objectiveId, {
    artifactIds: candidate.artifactIds,
    evidenceIds: candidate.evidenceIds,
    evaluationIds: candidate.evaluationIds,
    maxHops: policy.maxTraceHops
  });
  if (hash(expectedTrace) !== hash(candidate.trace)) blockers.push({ code: 'candidate-trace-mismatch', message: 'Candidate graph trace no longer matches immutable graph objects' });

  return { ok: blockers.length === 0, blockers };
}

export function finalizeCertification(candidate, certificationApproval, {
  graph,
  context = candidate?.contextSnapshot ?? null,
  gateResult = candidate?.gateSnapshot ?? null,
  governance,
  policy,
  authority,
  currentCommitSha = null,
  certifiedAt = new Date().toISOString()
}) {
  const verification = verifyCertificationCandidate(candidate, {
    graph,
    context,
    gateResult,
    governance,
    policy,
    authority,
    currentCommitSha,
    allowHistoricalGraphRevision: false
  });
  invariant(verification.ok, `Cannot finalize certification: ${verification.blockers.map(item => item.code).join(', ')}`);
  validateFinalApproval(certificationApproval, candidate, policy);

  const certified = {
    ...clone(candidate),
    status: 'certified',
    certificationApproval: clone(certificationApproval),
    certifiedAt
  };
  certified.certifiedHash = certificationBundleHash(certified);
  return certified;
}

export function verifyCertifiedBundle(bundle, inputs) {
  if (!bundle || bundle.status !== 'certified') return { ok: false, blockers: [{ code: 'invalid-certified-bundle', message: 'Bundle is not certified' }] };
  const candidate = clone(bundle);
  delete candidate.certificationApproval;
  delete candidate.certifiedAt;
  delete candidate.certifiedHash;
  candidate.status = 'candidate';

  const verification = verifyCertificationCandidate(candidate, {
    ...inputs,
    context: inputs.context ?? candidate.contextSnapshot,
    gateResult: inputs.gateResult ?? candidate.gateSnapshot,
    allowHistoricalGraphRevision: true
  });
  const blockers = [...verification.blockers];
  try { validateFinalApproval(bundle.certificationApproval, candidate, inputs.policy); }
  catch (error) { blockers.push({ code: 'invalid-final-certification-approval', message: error.message }); }
  if (bundle.certifiedHash !== certificationBundleHash(bundle)) blockers.push({ code: 'certified-hash-mismatch', message: 'Certified bundle hash does not match content' });
  return { ok: blockers.length === 0, blockers };
}

export function certificationCandidateHash(candidate) {
  const copy = clone(candidate);
  delete copy.candidateHash;
  return hash(copy);
}

export function certificationBundleHash(bundle) {
  const copy = clone(bundle);
  delete copy.certifiedHash;
  return hash(copy);
}

export class JsonCertificationStore {
  constructor(filePath) {
    invariant(typeof filePath === 'string' && filePath, 'Certification store path is required');
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  loadAll() {
    if (!fs.existsSync(this.filePath)) return { schemaVersion: 1, records: [] };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    invariant(parsed?.schemaVersion === 1 && Array.isArray(parsed.records), 'Invalid certification store');
    return parsed;
  }

  append(bundle) {
    invariant(bundle?.status === 'certified', 'Only finalized certified bundles may be persisted');
    return this.withLock(() => {
      const state = this.loadAll();
      invariant(!state.records.some(item => item.bundleId === bundle.bundleId), `Duplicate certification bundle id: ${bundle.bundleId}`);
      invariant(!state.records.some(item => item.sliceId === bundle.sliceId && item.commitSha === bundle.commitSha), `Commit already certified for slice ${bundle.sliceId}`);
      state.records.push(clone(bundle));
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.filePath);
      return clone(bundle);
    });
  }

  findByCommit(commitSha) {
    return this.loadAll().records.filter(item => item.commitSha === commitSha.toLowerCase()).map(clone);
  }

  withLock(fn) {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    let fd;
    let acquired = false;
    try {
      fd = fs.openSync(this.lockPath, 'wx');
      acquired = true;
      return fn();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (acquired && fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);
    }
  }
}

function validateCandidateInputs({
  slice,
  commitSha,
  graphState,
  context,
  gateResult,
  approvals,
  artifactIds,
  evidenceIds,
  evaluationIds,
  unresolvedRisks,
  policy,
  authority
}) {
  const blockers = [];
  if (!EXACT_SHA.test(commitSha ?? '')) blockers.push({ code: 'invalid-exact-sha', message: 'Exact 40-character commit SHA is required' });
  const objective = graphState.nodes.find(node => node.id === slice.objectiveId);
  if (!objective || objective.type !== 'Objective') blockers.push({ code: 'missing-objective', message: `Objective ${slice.objectiveId} is missing from graph` });

  if (policy.requireCurrentGraphRevision && context?.graphRevision !== graphState.revision) blockers.push({ code: 'stale-context', message: `Context revision ${context?.graphRevision ?? 'missing'} does not match graph revision ${graphState.revision}` });
  if (policy.requireContextHash && !(typeof context?.contextHash === 'string' && context.contextHash)) blockers.push({ code: 'missing-context-hash', message: 'Context hash is required for certification' });
  const seeds = new Set([...(context?.requestedSeeds ?? []), ...(context?.resolvedSeeds ?? [])]);
  if (!seeds.has(slice.objectiveId)) blockers.push({ code: 'context-missing-objective', message: `Certification context must be seeded with objective ${slice.objectiveId}` });
  if (policy.requireNoContextContradictions && (context?.contradictions?.length ?? 0) > 0) blockers.push({ code: 'unresolved-context-contradictions', message: 'Certification context contains unresolved contradictions' });

  if (policy.requireAllowedCertificationGate) {
    if (gateResult?.allowed !== true || gateResult?.requestedState !== 'certification' || gateResult?.sliceId !== slice.id) {
      blockers.push({ code: 'missing-allowed-certification-gate', message: 'An allowed PES gate result into certification is required' });
    }
  }

  blockers.push(...validatePreCertificationApprovals(approvals, slice.id, policy, authority));

  const artifactCheck = validateLinkedNodes(graphState, slice.objectiveId, unique(artifactIds), {
    allowedTypes: new Set(['Artifact']), acceptedStatuses: new Set(policy.acceptedGraphStatuses), maxHops: policy.maxTraceHops
  });
  if (artifactCheck.accepted.length < policy.minimumArtifacts) blockers.push({ code: 'insufficient-artifacts', message: `Certification requires ${policy.minimumArtifacts} linked artifact(s); found ${artifactCheck.accepted.length}`, details: artifactCheck });

  const evaluationCheck = validateLinkedNodes(graphState, slice.objectiveId, unique(evaluationIds), {
    allowedTypes: new Set(['Evaluation']), acceptedStatuses: new Set(policy.acceptedGraphStatuses), maxHops: policy.maxTraceHops
  });
  if (evaluationCheck.accepted.length < policy.minimumEvaluations) blockers.push({ code: 'insufficient-evaluations', message: `Certification requires ${policy.minimumEvaluations} linked evaluation(s); found ${evaluationCheck.accepted.length}`, details: evaluationCheck });

  const evidenceFloor = policy.minimumEvidenceByRisk[slice.riskLevel] ?? 0;
  const evidenceCheck = validateLinkedNodes(graphState, slice.objectiveId, unique(evidenceIds), {
    allowedTypes: new Set(['Evidence', 'Source', 'Metric', 'Claim']), acceptedStatuses: new Set(policy.acceptedGraphStatuses), maxHops: policy.maxTraceHops
  });
  if (evidenceCheck.accepted.length < evidenceFloor) blockers.push({ code: 'insufficient-certification-evidence', message: `Certification requires ${evidenceFloor} linked evidence item(s); found ${evidenceCheck.accepted.length}`, details: evidenceCheck });

  const blockingRisks = unresolvedRisks.filter(item => policy.blockUnresolvedRiskLevels.includes(item?.level));
  if (blockingRisks.length) blockers.push({ code: 'blocking-unresolved-risk', message: 'Certification has unresolved blocking risk', details: blockingRisks });
  return blockers;
}

function validateSlice(slice) {
  invariant(slice && typeof slice === 'object', 'Slice is required');
  invariant(typeof slice.id === 'string' && slice.id, 'Slice id is required');
  invariant(typeof slice.objectiveId === 'string' && slice.objectiveId, 'Slice objectiveId is required');
  invariant(typeof slice.riskLevel === 'string' && slice.riskLevel, 'Slice riskLevel is required');
}

function validatePreCertificationApprovals(approvals, sliceId, policy, authority) {
  const blockers = [];
  const humanRequired = new Set(authority?.humanApprovalRequired ?? []);
  for (const type of policy.requiredPreCertificationApprovals) {
    const valid = approvals.find(item => {
      if (item?.type !== type || item?.scopeId !== sliceId || item?.status !== 'approved') return false;
      if (authority?.agentMaySelfApprove === false && item.actorType === 'agent') return false;
      if (humanRequired.has(type) && item.actorType !== 'human') return false;
      return true;
    });
    if (!valid) blockers.push({ code: 'missing-pre-certification-approval', message: `Missing valid ${type} approval for ${sliceId}`, details: { type, humanRequired: humanRequired.has(type) } });
  }
  return blockers;
}

function validateFinalApproval(approval, candidate, policy) {
  invariant(approval && typeof approval === 'object', 'Certification approval is required');
  invariant(approval.type === policy.finalApprovalType, `Final approval type must be ${policy.finalApprovalType}`);
  invariant(approval.status === 'approved', 'Final certification approval must be approved');
  if (policy.requireHumanFinalApproval) invariant(approval.actorType === 'human', 'Final certification approval must be human');
  invariant(approval.scopeId === candidate.sliceId, `Certification approval must be scoped to ${candidate.sliceId}`);
  invariant(approval.commitSha?.toLowerCase() === candidate.commitSha.toLowerCase(), 'Certification approval must reference the exact candidate SHA');
  invariant(approval.candidateHash === candidate.candidateHash, 'Certification approval must reference the exact candidate hash');
  invariant(typeof approval.approvedAt === 'string' && approval.approvedAt, 'Certification approval requires approvedAt');
  return true;
}

function validateLinkedNodes(state, objectiveId, ids, { allowedTypes, acceptedStatuses, maxHops }) {
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  const accepted = [];
  const rejected = [];
  for (const id of ids) {
    const node = byId.get(id);
    if (!node) { rejected.push({ id, reason: 'missing-node' }); continue; }
    if (!allowedTypes.has(node.type)) { rejected.push({ id, reason: `unsupported-type:${node.type}` }); continue; }
    if (node.status && !acceptedStatuses.has(node.status)) { rejected.push({ id, reason: `unaccepted-status:${node.status}` }); continue; }
    const distance = graphDistance(state, objectiveId, id, maxHops);
    if (distance === null) { rejected.push({ id, reason: 'not-linked-to-objective' }); continue; }
    accepted.push({ id, type: node.type, status: node.status ?? null, distance });
  }
  return { accepted, rejected };
}

function buildTraceSummary(state, objectiveId, { artifactIds, evidenceIds, evaluationIds, maxHops }) {
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  const ids = [...unique(artifactIds), ...unique(evidenceIds), ...unique(evaluationIds)];
  return ids.map(id => {
    const node = byId.get(id);
    return {
      id,
      type: node?.type ?? null,
      status: node?.status ?? null,
      nodeHash: node ? hash(node) : null,
      memoryEventId: node?.memoryProvenance?.eventId ?? null,
      distanceFromObjective: graphDistance(state, objectiveId, id, maxHops)
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
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

function stripFunctions(value) {
  if (Array.isArray(value)) return value.map(stripFunctions);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item !== 'function').map(([key, item]) => [key, stripFunctions(item)]));
  }
  return value;
}

function unique(values) {
  return [...new Set(values ?? [])];
}
