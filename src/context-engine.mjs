import crypto from 'node:crypto';
import { invariant } from './core.mjs';
import { normalizeGraphMemoryState, resolveCurrentNode, validateGraphMemoryState } from './graph-memory.mjs';

const DEFAULT_EDGE_WEIGHTS = {
  DEPENDS_ON: 8,
  ABOUT: 8,
  SUPPORTS: 7,
  CONTRADICTS: 9,
  PRODUCED: 7,
  EVALUATES: 7,
  DERIVED_FROM: 6,
  REVISES: 6,
  SUPERSEDES: 5,
  PARENT_OF: 4,
  IMPLEMENTED_BY: 4,
  APPROVED_BY: 4,
  FAILED_BECAUSE: 6,
  RESOLVED_TO: 4
};

const STATUS_WEIGHTS = {
  verified: 12,
  approved: 11,
  active: 9,
  proposed: 3,
  superseded: -6,
  failed: -8,
  rejected: -10
};

const TYPE_WEIGHTS = {
  Objective: 8,
  Decision: 8,
  Claim: 7,
  Evidence: 7,
  Evaluation: 6,
  Artifact: 6,
  Source: 5,
  AgentRun: 4,
  Task: 4,
  Commit: 3,
  Version: 3,
  Metric: 3
};

const HASH_KEYS = [
  'schemaVersion', 'graphRevision', 'requestedSeeds', 'resolvedSeeds', 'resolution',
  'nodes', 'edges', 'ranking', 'contradictions', 'omittedNodeIds', 'policy'
];

const clone = value => structuredClone(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonical(value));
}

function estimatedTokens(value) {
  return Math.ceil(Buffer.byteLength(typeof value === 'string' ? value : stableStringify(value), 'utf8') / 4);
}

function timestampFor(node) {
  const candidates = [
    node.updatedAt,
    node.decidedAt,
    node.evaluatedAt,
    node.endedAt,
    node.startedAt,
    node.recordedAt,
    node.memoryProvenance?.recordedAt
  ].filter(Boolean);
  for (const value of candidates) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function recencyScores(nodes) {
  const timestamps = nodes.map(timestampFor).filter(value => value > 0);
  if (!timestamps.length) return new Map();
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const span = Math.max(1, max - min);
  return new Map(nodes.map(node => {
    const ts = timestampFor(node);
    return [node.id, ts > 0 ? ((ts - min) / span) * 5 : 0];
  }));
}

function adjacencyFor(state) {
  const adjacency = new Map();
  for (const edge of state.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push({ edge, next: edge.to });
    adjacency.get(edge.to).push({ edge, next: edge.from });
  }
  return adjacency;
}

function collectCandidates(state, seedIds, maxHops) {
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  const adjacency = adjacencyFor(state);
  const queue = seedIds.map(id => ({ id, hop: 0, pathWeight: 0 }));
  const best = new Map();

  while (queue.length) {
    const current = queue.shift();
    const prior = best.get(current.id);
    if (prior && (prior.hop < current.hop || (prior.hop === current.hop && prior.pathWeight >= current.pathWeight))) continue;
    best.set(current.id, current);
    if (current.hop >= maxHops) continue;

    for (const link of adjacency.get(current.id) ?? []) {
      const weight = DEFAULT_EDGE_WEIGHTS[link.edge.type] ?? 1;
      queue.push({ id: link.next, hop: current.hop + 1, pathWeight: Math.max(current.pathWeight, weight) });
    }
  }

  return [...best.values()].map(item => ({ ...item, node: byId.get(item.id) })).filter(item => item.node);
}

function scoreCandidate(candidate, recency, seedSet, preferVerified) {
  const { node, hop, pathWeight } = candidate;
  const seedBonus = seedSet.has(node.id) ? 1000 : 0;
  const distance = Math.max(0, 100 - (hop * 22));
  const status = preferVerified ? (STATUS_WEIGHTS[node.status] ?? 0) : 0;
  const type = TYPE_WEIGHTS[node.type] ?? 0;
  const recent = recency.get(node.id) ?? 0;
  return seedBonus + distance + pathWeight + status + type + recent;
}

function resolveSeeds(state, seedIds, resolveSuperseded) {
  const existing = new Set(state.nodes.map(node => node.id));
  const resolved = [];
  const resolution = [];
  for (const id of seedIds) {
    invariant(existing.has(id), `Unknown context seed: ${id}`);
    if (!resolveSuperseded) {
      resolved.push(id);
      continue;
    }
    const result = resolveCurrentNode(state, id);
    invariant(result.status === 'resolved', `Context seed ${id} has unresolved supersession conflict`);
    resolved.push(result.currentId);
    resolution.push({ requestedId: id, currentId: result.currentId, chain: result.chain });
  }
  return { resolved: [...new Set(resolved)], resolution };
}

function contradictionSet(state, ids) {
  const selected = new Set(ids);
  const required = new Set();
  for (const edge of state.edges) {
    if (edge.type !== 'CONTRADICTS') continue;
    if (selected.has(edge.from)) required.add(edge.to);
    if (selected.has(edge.to)) required.add(edge.from);
  }
  return required;
}

function hashPayload(context) {
  return Object.fromEntries(HASH_KEYS.map(key => [key, clone(context[key])]));
}

export function validateContextPolicy(policy) {
  invariant(policy && typeof policy === 'object', 'Context policy is required');
  invariant(Number.isInteger(policy.maxHops) && policy.maxHops >= 0, 'context.maxHops must be a non-negative integer');
  invariant(Number.isInteger(policy.maxNodes) && policy.maxNodes > 0, 'context.maxNodes must be positive');
  invariant(Number.isInteger(policy.maxTokens) && policy.maxTokens > 0, 'context.maxTokens must be positive');
  invariant(policy.preferVerified === true || policy.preferVerified === false, 'context.preferVerified must be boolean');
  invariant(policy.includeContradictions === true || policy.includeContradictions === false, 'context.includeContradictions must be boolean');
  invariant(policy.resolveSuperseded === true || policy.resolveSuperseded === false, 'context.resolveSuperseded must be boolean');
  return true;
}

export function buildRankedContext(input, seedIds, policy) {
  validateContextPolicy(policy);
  const state = normalizeGraphMemoryState(input);
  validateGraphMemoryState(state);
  invariant(Array.isArray(seedIds) && seedIds.length > 0, 'At least one context seed is required');

  const { resolved: resolvedSeeds, resolution } = resolveSeeds(state, seedIds, policy.resolveSuperseded);
  const seedSet = new Set(resolvedSeeds);
  const candidates = collectCandidates(state, resolvedSeeds, policy.maxHops);
  const recency = recencyScores(candidates.map(candidate => candidate.node));

  const ranked = candidates.map(candidate => ({
    ...candidate,
    score: scoreCandidate(candidate, recency, seedSet, policy.preferVerified)
  }));

  const forcedContradictions = policy.includeContradictions
    ? contradictionSet(state, ranked.map(item => item.node.id))
    : new Set();

  for (const nodeId of forcedContradictions) {
    if (ranked.some(item => item.node.id === nodeId)) continue;
    const node = state.nodes.find(item => item.id === nodeId);
    if (node) ranked.push({ node, id: node.id, hop: policy.maxHops + 1, pathWeight: DEFAULT_EDGE_WEIGHTS.CONTRADICTS, score: 80 });
  }

  const ordered = ranked.sort((a, b) => {
    const aSeed = seedSet.has(a.node.id) ? 1 : 0;
    const bSeed = seedSet.has(b.node.id) ? 1 : 0;
    const aContradictionBonus = forcedContradictions.has(a.node.id) ? 15 : 0;
    const bContradictionBonus = forcedContradictions.has(b.node.id) ? 15 : 0;
    return bSeed - aSeed ||
      ((b.score + bContradictionBonus) - (a.score + aContradictionBonus)) ||
      a.hop - b.hop || a.node.id.localeCompare(b.node.id);
  });

  let selected = ordered.slice(0, policy.maxNodes).map(item => ({ ...item, node: clone(item.node) }));

  const assemble = selectedItems => {
    const selectedIds = new Set(selectedItems.map(item => item.node.id));
    const edges = state.edges.filter(edge => selectedIds.has(edge.from) && selectedIds.has(edge.to)).map(clone);
    const contradictions = edges.filter(edge => edge.type === 'CONTRADICTS').map(edge => ({ id: edge.id, from: edge.from, to: edge.to }));
    const nodes = selectedItems.map(item => item.node);
    const ranking = selectedItems.map(item => ({ id: item.node.id, score: Number(item.score.toFixed(3)), hop: item.hop, status: item.node.status ?? null }));
    const omittedNodeIds = ordered.map(item => item.node.id).filter(id => !selectedIds.has(id));
    return {
      schemaVersion: 1,
      graphRevision: state.revision ?? 0,
      requestedSeeds: [...seedIds],
      resolvedSeeds,
      resolution,
      nodes,
      edges,
      ranking,
      contradictions,
      omittedNodeIds,
      policy: clone(policy)
    };
  };

  let payload = assemble(selected);
  while (estimatedTokens(payload) > policy.maxTokens) {
    const removableIndex = [...selected].map((item, index) => ({ item, index })).reverse().find(({ item }) => !seedSet.has(item.node.id))?.index;
    invariant(removableIndex !== undefined, `Context token budget too small for required seed set (${estimatedTokens(payload)} > ${policy.maxTokens})`);
    selected.splice(removableIndex, 1);
    payload = assemble(selected);
  }

  const selectedIds = new Set(payload.nodes.map(node => node.id));
  for (const seedId of resolvedSeeds) invariant(selectedIds.has(seedId), `Required context seed omitted: ${seedId}`);

  const contextHash = crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
  const finalTokens = estimatedTokens(payload);

  return {
    ...payload,
    contextHash,
    estimatedTokens: finalTokens,
    truncated: payload.omittedNodeIds.length > 0,
    unchangedFrom: priorHash => priorHash === contextHash
  };
}

export function serializeContext(context, { pretty = false } = {}) {
  const serializable = { ...context };
  delete serializable.unchangedFrom;
  return JSON.stringify(canonical(serializable), null, pretty ? 2 : 0);
}

export function contextHashFor(context) {
  return crypto.createHash('sha256').update(stableStringify(hashPayload(context))).digest('hex');
}

export { estimatedTokens };
