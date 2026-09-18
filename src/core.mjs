const NODE_TYPES = new Set([
  'Objective','Decision','Artifact','Evidence','Evaluation','AgentRun','Version',
  'Claim','Source','Task','Commit','Metric'
]);

const EDGE_TYPES = new Set([
  'DEPENDS_ON','PRODUCED','EVALUATES','REVISES','SUPERSEDES','DERIVED_FROM',
  'APPROVED_BY','IMPLEMENTED_BY','FAILED_BECAUSE','SUPPORTS','CONTRADICTS',
  'PARENT_OF','RESOLVED_TO','ABOUT'
]);

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateBudget(budget) {
  const required = [
    'maxModelCalls','maxSubAgents','maxConcurrentWorkers','maxToolCalls','maxTokens',
    'maxFinancialCost','maxWallClockMinutes','maxRetries','maxGraphWrites','minEvidenceItems'
  ];
  for (const key of required) {
    invariant(Number.isFinite(budget[key]) && budget[key] >= 0, `Invalid budget: ${key}`);
  }
  invariant(budget.maxConcurrentWorkers >= 1, 'maxConcurrentWorkers must be >= 1');
  return true;
}

export function validateGraph(graph) {
  invariant(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges), 'Graph must contain nodes and edges arrays');
  const ids = new Set();
  for (const node of graph.nodes) {
    invariant(typeof node.id === 'string' && node.id.length > 0, 'Every node requires an id');
    invariant(!ids.has(node.id), `Duplicate node id: ${node.id}`);
    invariant(NODE_TYPES.has(node.type), `Unsupported node type: ${node.type}`);
    ids.add(node.id);

    if (node.type === 'Claim') {
      const sourced = Array.isArray(node.sourceIds) && node.sourceIds.length > 0;
      invariant(sourced || node.inference === true, `Claim ${node.id} requires sourceIds or inference=true`);
    }
    if (node.type === 'Artifact') {
      invariant(typeof node.runId === 'string' && node.runId, `Artifact ${node.id} requires runId`);
      invariant(node.version !== undefined && node.version !== null, `Artifact ${node.id} requires version`);
    }
    if (node.type === 'Evaluation') {
      invariant(typeof node.rubricId === 'string' && node.rubricId, `Evaluation ${node.id} requires rubricId`);
    }
  }

  for (const edge of graph.edges) {
    invariant(typeof edge.id === 'string' && edge.id.length > 0, 'Every edge requires an id');
    invariant(EDGE_TYPES.has(edge.type), `Unsupported edge type: ${edge.type}`);
    invariant(ids.has(edge.from), `Edge ${edge.id} has missing from node: ${edge.from}`);
    invariant(ids.has(edge.to), `Edge ${edge.id} has missing to node: ${edge.to}`);
    if (['SUPPORTS','CONTRADICTS','DERIVED_FROM'].includes(edge.type)) {
      invariant(edge.provenance || edge.sourceId, `Evidence edge ${edge.id} requires provenance or sourceId`);
    }
  }
  return true;
}

export function ratchetDecision({ baseline, candidate, direction = 'higher', crashed = false }) {
  invariant(Number.isFinite(baseline), 'baseline must be numeric');
  if (crashed || !Number.isFinite(candidate)) {
    return { decision: 'revert', improved: false, reason: crashed ? 'candidate crashed' : 'candidate score missing' };
  }
  invariant(direction === 'higher' || direction === 'lower', 'direction must be higher or lower');
  const improved = direction === 'higher' ? candidate > baseline : candidate < baseline;
  return {
    decision: improved ? 'keep' : 'revert',
    improved,
    reason: improved ? 'candidate improved the declared metric' : 'candidate did not improve the declared metric'
  };
}

export function buildContext(graph, seedIds, { maxHops = 2, maxNodes = 40, includeStatuses = null } = {}) {
  validateGraph(graph);
  invariant(Array.isArray(seedIds) && seedIds.length > 0, 'At least one seed id is required');
  invariant(Number.isInteger(maxHops) && maxHops >= 0, 'maxHops must be a non-negative integer');
  invariant(Number.isInteger(maxNodes) && maxNodes > 0, 'maxNodes must be positive');

  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  for (const id of seedIds) invariant(byId.has(id), `Unknown seed node: ${id}`);

  const allowedStatus = includeStatuses ? new Set(includeStatuses) : null;
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push({ edge, next: edge.to });
    adjacency.get(edge.to).push({ edge, next: edge.from });
  }

  const queue = seedIds.map(id => ({ id, depth: 0 }));
  const seen = new Set();
  const selectedNodes = [];
  const selectedEdges = new Map();

  while (queue.length && selectedNodes.length < maxNodes) {
    const current = queue.shift();
    if (seen.has(current.id)) continue;
    const node = byId.get(current.id);
    if (!node) continue;
    if (allowedStatus && node.status && !allowedStatus.has(node.status) && !seedIds.includes(node.id)) continue;

    seen.add(current.id);
    selectedNodes.push(node);
    if (current.depth >= maxHops) continue;

    for (const link of adjacency.get(current.id) || []) {
      selectedEdges.set(link.edge.id, link.edge);
      if (!seen.has(link.next)) queue.push({ id: link.next, depth: current.depth + 1 });
    }
  }

  const selectedIds = new Set(selectedNodes.map(n => n.id));
  return {
    seeds: seedIds,
    maxHops,
    maxNodes,
    nodes: selectedNodes,
    edges: [...selectedEdges.values()].filter(e => selectedIds.has(e.from) && selectedIds.has(e.to)),
    truncated: queue.length > 0
  };
}

export function validateRunUsage(usage, budget) {
  validateBudget(budget);
  const map = {
    modelCalls: 'maxModelCalls', subAgents: 'maxSubAgents', concurrentWorkers: 'maxConcurrentWorkers',
    toolCalls: 'maxToolCalls', tokens: 'maxTokens', financialCost: 'maxFinancialCost',
    wallClockMinutes: 'maxWallClockMinutes', retries: 'maxRetries', graphWrites: 'maxGraphWrites'
  };
  const exceeded = [];
  for (const [usageKey, budgetKey] of Object.entries(map)) {
    const value = Number(usage[usageKey] || 0);
    if (value > budget[budgetKey]) exceeded.push({ usage: usageKey, value, limit: budget[budgetKey] });
  }
  return { ok: exceeded.length === 0, exceeded };
}
