import { buildRankedContext, estimatedTokens } from './context-engine.mjs';

const NODE_FIELDS = [
  'id', 'type', 'status', 'title', 'name', 'summary', 'description',
  'objective', 'decision', 'claim', 'path', 'version', 'commitSha',
  'sourceIds', 'artifactIds', 'updatedAt', 'decidedAt', 'evaluatedAt'
];

function isUseful(value) {
  return value !== undefined && value !== null && value !== '' &&
    (!Array.isArray(value) || value.length > 0);
}

export function compactNode(node) {
  return Object.fromEntries(
    NODE_FIELDS
      .filter(key => isUseful(node[key]))
      .map(key => [key, structuredClone(node[key])])
  );
}

export function buildAgentBrief(input, seedIds, policy, { objective = null, priorHash = null } = {}) {
  const context = buildRankedContext(input, seedIds, policy);
  const nodes = context.nodes.map(compactNode);
  const inferredObjective = nodes.find(node => node.type === 'Objective')?.title ?? null;

  const payload = {
    schemaVersion: 1,
    kind: 'kairo-agent-brief',
    objective: objective ?? inferredObjective,
    contextHash: context.contextHash,
    unchanged: priorHash ? priorHash === context.contextHash : null,
    graphRevision: context.graphRevision,
    requestedSeeds: context.requestedSeeds,
    resolvedSeeds: context.resolvedSeeds,
    nodes,
    contradictions: context.contradictions,
    omittedNodeCount: context.omittedNodeIds.length,
    truncated: context.truncated,
    bounds: {
      maxHops: policy.maxHops,
      maxNodes: policy.maxNodes,
      sourceTokenBudget: policy.maxTokens
    }
  };

  return {
    ...payload,
    estimatedTokens: estimatedTokens(payload)
  };
}

export function compactFailureOutput(value, { maxLines = 40, maxChars = 6000 } = {}) {
  const normalized = String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (!normalized) return '';

  const lines = normalized.split('\n');
  const selected = lines.length > maxLines ? lines.slice(-maxLines) : lines;
  const joined = selected.join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(joined.length - maxChars);
}
