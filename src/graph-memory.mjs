import fs from 'node:fs';
import path from 'node:path';
import { invariant, validateGraph } from './core.mjs';

const MEMORY_SCHEMA_VERSION = 1;
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).filter(key => key !== 'memoryProvenance').sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function sameDomainObject(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function normalizeEvent(event) {
  return {
    id: event.id,
    revision: event.revision,
    operation: event.operation,
    actorId: event.actorId,
    runId: event.runId ?? null,
    reason: event.reason,
    sourceIds: [...(event.sourceIds ?? [])],
    addedNodeIds: [...(event.addedNodeIds ?? [])],
    addedEdgeIds: [...(event.addedEdgeIds ?? [])],
    recordedAt: event.recordedAt
  };
}

export function normalizeGraphMemoryState(input) {
  invariant(input && typeof input === 'object', 'Graph memory state is required');
  const state = clone(input);
  state.schemaVersion ??= MEMORY_SCHEMA_VERSION;
  state.version ??= 1;
  state.revision ??= 0;
  state.nodes ??= [];
  state.edges ??= [];
  state.events ??= [];
  return state;
}

export function validateGraphMemoryState(input, { requireObjectProvenance = false } = {}) {
  const state = normalizeGraphMemoryState(input);
  invariant(state.schemaVersion === MEMORY_SCHEMA_VERSION, `Unsupported graph memory schemaVersion: ${state.schemaVersion}`);
  invariant(Number.isInteger(state.revision) && state.revision >= 0, 'Graph memory revision must be a non-negative integer');
  validateGraph(state);

  const eventIds = new Set();
  let previousRevision = 0;
  for (const event of state.events) {
    invariant(typeof event.id === 'string' && event.id, 'Graph event id is required');
    invariant(!eventIds.has(event.id), `Duplicate graph event id: ${event.id}`);
    eventIds.add(event.id);
    invariant(Number.isInteger(event.revision) && event.revision > previousRevision, `Graph event ${event.id} has invalid revision`);
    invariant(event.revision <= state.revision, `Graph event ${event.id} exceeds state revision`);
    invariant(typeof event.operation === 'string' && event.operation, `Graph event ${event.id} requires operation`);
    invariant(typeof event.actorId === 'string' && event.actorId, `Graph event ${event.id} requires actorId`);
    invariant(typeof event.reason === 'string' && event.reason.trim(), `Graph event ${event.id} requires reason`);
    invariant(typeof event.recordedAt === 'string' && event.recordedAt, `Graph event ${event.id} requires recordedAt`);
    invariant(Array.isArray(event.addedNodeIds) && Array.isArray(event.addedEdgeIds), `Graph event ${event.id} requires added ids`);
    previousRevision = event.revision;
  }
  if (state.events.length) invariant(previousRevision === state.revision, 'Latest graph event revision must equal state revision');
  else invariant(state.revision === 0, 'Graph state with no events must have revision 0');

  const nodeIds = new Set(state.nodes.map(node => node.id));
  const edgeIds = new Set(state.edges.map(edge => edge.id));
  for (const event of state.events) {
    for (const id of event.addedNodeIds) invariant(nodeIds.has(id), `Graph event ${event.id} references missing node ${id}`);
    for (const id of event.addedEdgeIds) invariant(edgeIds.has(id), `Graph event ${event.id} references missing edge ${id}`);
  }

  if (requireObjectProvenance) {
    for (const node of state.nodes) validateMemoryProvenance(node, eventIds, `Node ${node.id}`);
    for (const edge of state.edges) validateMemoryProvenance(edge, eventIds, `Edge ${edge.id}`);
  }
  validateSupersessionCycles(state);
  return true;
}

export function appendGraphUpdate(input, update, metadata = {}) {
  const state = normalizeGraphMemoryState(input);
  validateGraphMemoryState(state);
  invariant(update && Array.isArray(update.nodes) && Array.isArray(update.edges), 'Graph update requires nodes and edges');
  invariant(typeof metadata.actorId === 'string' && metadata.actorId, 'Graph write actorId is required');
  invariant(typeof metadata.reason === 'string' && metadata.reason.trim(), 'Graph write reason is required');

  const nodeMap = new Map(state.nodes.map(node => [node.id, node]));
  const edgeMap = new Map(state.edges.map(edge => [edge.id, edge]));
  const newNodes = [];
  const newEdges = [];

  for (const incoming of update.nodes) {
    invariant(incoming && typeof incoming.id === 'string' && incoming.id, 'Graph update node requires id');
    const existing = nodeMap.get(incoming.id);
    if (existing) {
      invariant(sameDomainObject(existing, incoming), `Conflicting node rewrite rejected: ${incoming.id}`);
      continue;
    }
    const node = clone(incoming);
    newNodes.push(node);
    nodeMap.set(node.id, node);
  }

  for (const incoming of update.edges) {
    invariant(incoming && typeof incoming.id === 'string' && incoming.id, 'Graph update edge requires id');
    const existing = edgeMap.get(incoming.id);
    if (existing) {
      invariant(sameDomainObject(existing, incoming), `Conflicting edge rewrite rejected: ${incoming.id}`);
      continue;
    }
    const edge = clone(incoming);
    newEdges.push(edge);
    edgeMap.set(edge.id, edge);
  }

  const writes = newNodes.length + newEdges.length;
  if (metadata.maxWrites !== undefined) {
    invariant(Number.isInteger(metadata.maxWrites) && metadata.maxWrites >= 0, 'maxWrites must be a non-negative integer');
    invariant(writes <= metadata.maxWrites, `Graph update exceeds maxWrites (${writes} > ${metadata.maxWrites})`);
  }
  if (writes === 0) return { state, event: null, changed: false };

  const revision = state.revision + 1;
  const eventId = metadata.eventId ?? `GM-${String(revision).padStart(6, '0')}`;
  invariant(!state.events.some(event => event.id === eventId), `Duplicate graph event id: ${eventId}`);
  const recordedAt = metadata.recordedAt ?? now();
  const sourceIds = Array.isArray(metadata.sourceIds) ? [...metadata.sourceIds] : [];
  const provenance = { eventId, revision, actorId: metadata.actorId, runId: metadata.runId ?? null, sourceIds, recordedAt };
  for (const node of newNodes) node.memoryProvenance = clone(provenance);
  for (const edge of newEdges) edge.memoryProvenance = clone(provenance);

  const next = {
    ...state,
    revision,
    nodes: [...state.nodes, ...newNodes],
    edges: [...state.edges, ...newEdges],
    events: [...state.events, normalizeEvent({
      id: eventId,
      revision,
      operation: metadata.operation ?? 'append',
      actorId: metadata.actorId,
      runId: metadata.runId ?? null,
      reason: metadata.reason.trim(),
      sourceIds,
      addedNodeIds: newNodes.map(node => node.id),
      addedEdgeIds: newEdges.map(edge => edge.id),
      recordedAt
    })]
  };
  validateGraphMemoryState(next);
  return { state: next, event: next.events.at(-1), changed: true };
}

export function resolveCurrentNode(input, nodeId) {
  const state = normalizeGraphMemoryState(input);
  validateGraphMemoryState(state);
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  invariant(byId.has(nodeId), `Unknown node: ${nodeId}`);

  const chain = [nodeId];
  const seen = new Set(chain);
  let current = nodeId;
  while (true) {
    const superseders = state.edges.filter(edge => edge.type === 'SUPERSEDES' && edge.to === current).map(edge => edge.from);
    if (superseders.length === 0) return { status: 'resolved', requestedId: nodeId, currentId: current, node: clone(byId.get(current)), chain };
    if (superseders.length > 1) return { status: 'conflict', requestedId: nodeId, currentId: current, candidates: superseders, chain };
    const nextId = superseders[0];
    invariant(byId.has(nextId), `SUPERSEDES edge points from missing node: ${nextId}`);
    invariant(!seen.has(nextId), `Supersession cycle detected at ${nextId}`);
    seen.add(nextId);
    chain.push(nextId);
    current = nextId;
  }
}

export function supersedeNode(input, options) {
  const state = normalizeGraphMemoryState(input);
  const target = state.nodes.find(node => node.id === options.targetId);
  invariant(target, `Unknown supersession target: ${options.targetId}`);
  const current = resolveCurrentNode(state, options.targetId);
  invariant(current.status === 'resolved' && current.currentId === options.targetId, `Cannot supersede stale or conflicted node: ${options.targetId}`);
  invariant(options.replacement && typeof options.replacement.id === 'string' && options.replacement.id, 'Replacement node is required');
  invariant(options.replacement.id !== options.targetId, 'Replacement must have a new id');
  invariant(options.replacement.type === target.type, 'Replacement type must match target type');
  invariant(typeof options.reason === 'string' && options.reason.trim(), 'Supersession reason is required');

  const replacement = {
    ...clone(options.replacement),
    logicalId: options.replacement.logicalId ?? target.logicalId ?? target.id,
    supersedesId: options.targetId
  };
  const edge = { id: `EDGE-SUPERSEDES-${replacement.id}-${options.targetId}`, type: 'SUPERSEDES', from: replacement.id, to: options.targetId };
  return appendGraphUpdate(state, { nodes: [replacement], edges: [edge] }, {
    actorId: options.actorId,
    runId: options.runId ?? null,
    sourceIds: options.sourceIds ?? [],
    recordedAt: options.recordedAt,
    eventId: options.eventId,
    maxWrites: options.maxWrites,
    operation: 'supersede',
    reason: options.reason
  });
}

export function correctNode(input, options) {
  invariant(options && typeof options.reason === 'string' && options.reason.trim(), 'Correction reason is required');
  const replacement = { ...clone(options.replacement), correctionOf: options.targetId, correctionReason: options.reason.trim() };
  const result = supersedeNode(input, { ...options, replacement });
  const next = clone(result.state);
  if (result.event) {
    next.events[next.events.length - 1].operation = 'correction';
    validateGraphMemoryState(next);
  }
  return { ...result, state: next, event: next.events.at(-1) };
}

export function reconstructLineage(input, seedId, {
  edgeTypes = ['PARENT_OF','PRODUCED','EVALUATES','REVISES','DERIVED_FROM','SUPPORTS','SUPERSEDES','ABOUT','DEPENDS_ON'],
  maxDepth = 8,
  maxNodes = 100,
  requireProvenance = false
} = {}) {
  const state = normalizeGraphMemoryState(input);
  validateGraphMemoryState(state);
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  invariant(byId.has(seedId), `Unknown lineage seed: ${seedId}`);
  invariant(Number.isInteger(maxDepth) && maxDepth >= 0, 'maxDepth must be a non-negative integer');
  invariant(Number.isInteger(maxNodes) && maxNodes > 0, 'maxNodes must be positive');

  const allowed = new Set(edgeTypes);
  const queue = [{ id: seedId, depth: 0 }];
  const seen = new Set();
  const selectedEdges = new Map();
  while (queue.length && seen.size < maxNodes) {
    const current = queue.shift();
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    if (current.depth >= maxDepth) continue;
    for (const edge of state.edges) {
      if (!allowed.has(edge.type)) continue;
      if (requireProvenance && !(edge.memoryProvenance || edge.provenance || edge.sourceId)) continue;
      let next = null;
      if (edge.from === current.id) next = edge.to;
      else if (edge.to === current.id) next = edge.from;
      if (!next) continue;
      selectedEdges.set(edge.id, edge);
      if (!seen.has(next)) queue.push({ id: next, depth: current.depth + 1 });
    }
  }
  return {
    seedId,
    nodes: [...seen].map(id => clone(byId.get(id))).filter(Boolean),
    edges: [...selectedEdges.values()].filter(edge => seen.has(edge.from) && seen.has(edge.to)).map(clone),
    truncated: queue.length > 0
  };
}

export function getObjectProvenance(input, objectId) {
  const state = normalizeGraphMemoryState(input);
  validateGraphMemoryState(state);
  const object = state.nodes.find(node => node.id === objectId) ?? state.edges.find(edge => edge.id === objectId);
  invariant(object, `Unknown graph object: ${objectId}`);
  const events = state.events.filter(event => event.addedNodeIds.includes(objectId) || event.addedEdgeIds.includes(objectId));
  return {
    objectId,
    memoryProvenance: clone(object.memoryProvenance ?? null),
    domainProvenance: clone(object.provenance ?? null),
    events: events.map(clone),
    tracked: Boolean(object.memoryProvenance || object.provenance || events.length)
  };
}

export function explainArtifact(input, artifactId) {
  const state = normalizeGraphMemoryState(input);
  validateGraphMemoryState(state);
  const resolved = resolveCurrentNode(state, artifactId);
  invariant(resolved.status === 'resolved', `Artifact ${artifactId} has unresolved supersession conflict`);
  const artifact = state.nodes.find(node => node.id === resolved.currentId);
  invariant(artifact?.type === 'Artifact', `${artifactId} is not an Artifact`);

  const producerIds = state.edges.filter(edge => edge.type === 'PRODUCED' && edge.to === artifact.id).map(edge => edge.from);
  const producers = producerIds.map(id => state.nodes.find(node => node.id === id)).filter(Boolean);
  const evaluationIds = state.edges.filter(edge => edge.type === 'EVALUATES' && edge.to === artifact.id).map(edge => edge.from);
  const evaluations = evaluationIds.map(id => state.nodes.find(node => node.id === id)).filter(Boolean);
  const objectiveIds = [...new Set(producers.map(run => run.objectiveId).filter(Boolean))];
  const objectives = objectiveIds.map(id => state.nodes.find(node => node.id === id)).filter(Boolean);
  const attempts = state.nodes.filter(node => node.type === 'AgentRun' && objectiveIds.includes(node.objectiveId)).sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')));

  return {
    requestedArtifactId: artifactId,
    currentArtifactId: artifact.id,
    supersessionChain: resolved.chain,
    artifact: clone(artifact),
    producers: producers.map(clone),
    evaluations: evaluations.map(clone),
    objectives: objectives.map(clone),
    attempts: attempts.map(clone),
    failedAttempts: attempts.filter(node => node.status === 'failed').map(clone),
    lineage: reconstructLineage(state, artifact.id),
    provenance: getObjectProvenance(state, artifact.id)
  };
}

export class JsonGraphMemoryStore {
  constructor(filePath) {
    invariant(typeof filePath === 'string' && filePath, 'Graph memory filePath is required');
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  load() {
    invariant(fs.existsSync(this.filePath), `Graph memory file does not exist: ${this.filePath}`);
    const state = normalizeGraphMemoryState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    validateGraphMemoryState(state);
    return state;
  }

  save(state, { expectedRevision = null } = {}) {
    return this.withLock(() => {
      const current = this.load();
      if (expectedRevision !== null) invariant(current.revision === expectedRevision, `Graph revision conflict: expected ${expectedRevision}, found ${current.revision}`);
      const next = normalizeGraphMemoryState(state);
      validateGraphMemoryState(next);
      invariant(next.revision >= current.revision, 'Graph revision cannot move backwards');
      this.writeAtomic(next);
      return clone(next);
    });
  }

  append(update, metadata = {}) {
    return this.withLock(() => {
      const current = this.load();
      if (metadata.expectedRevision !== undefined) invariant(current.revision === metadata.expectedRevision, `Graph revision conflict: expected ${metadata.expectedRevision}, found ${current.revision}`);
      const result = appendGraphUpdate(current, update, metadata);
      if (result.changed) this.writeAtomic(result.state);
      return clone(result);
    });
  }

  supersede(options) {
    return this.withLock(() => {
      const current = this.load();
      if (options.expectedRevision !== undefined) invariant(current.revision === options.expectedRevision, `Graph revision conflict: expected ${options.expectedRevision}, found ${current.revision}`);
      const result = supersedeNode(current, options);
      this.writeAtomic(result.state);
      return clone(result);
    });
  }

  correct(options) {
    return this.withLock(() => {
      const current = this.load();
      if (options.expectedRevision !== undefined) invariant(current.revision === options.expectedRevision, `Graph revision conflict: expected ${options.expectedRevision}, found ${current.revision}`);
      const result = correctNode(current, options);
      this.writeAtomic(result.state);
      return clone(result);
    });
  }

  writeAtomic(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, this.filePath);
  }

  withLock(fn) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    let fd;
    try {
      fd = fs.openSync(this.lockPath, 'wx');
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error(`Graph memory is locked: ${this.lockPath}`);
      throw error;
    }
    try {
      return fn();
    } finally {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(this.lockPath); } catch {}
    }
  }
}

function validateMemoryProvenance(object, eventIds, label) {
  invariant(object.memoryProvenance && typeof object.memoryProvenance === 'object', `${label} requires memoryProvenance`);
  invariant(typeof object.memoryProvenance.eventId === 'string' && eventIds.has(object.memoryProvenance.eventId), `${label} has unknown memory event`);
  invariant(Number.isInteger(object.memoryProvenance.revision) && object.memoryProvenance.revision > 0, `${label} has invalid memory revision`);
  invariant(typeof object.memoryProvenance.actorId === 'string' && object.memoryProvenance.actorId, `${label} requires provenance actorId`);
}

function validateSupersessionCycles(state) {
  const nextByTarget = new Map();
  for (const edge of state.edges.filter(edge => edge.type === 'SUPERSEDES')) {
    if (!nextByTarget.has(edge.to)) nextByTarget.set(edge.to, []);
    nextByTarget.get(edge.to).push(edge.from);
  }
  for (const node of state.nodes) {
    const seen = new Set([node.id]);
    const frontier = [node.id];
    while (frontier.length) {
      const current = frontier.pop();
      for (const next of nextByTarget.get(current) ?? []) {
        invariant(!seen.has(next), `Supersession cycle detected at ${next}`);
        seen.add(next);
        frontier.push(next);
      }
    }
  }
}
