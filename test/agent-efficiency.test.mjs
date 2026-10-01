import test from 'node:test';
import assert from 'node:assert/strict';
import { appendGraphUpdate } from '../src/graph-memory.mjs';
import { buildAgentBrief, compactFailureOutput } from '../src/agent-efficiency.mjs';
import { buildRankedContext, serializeContext } from '../src/context-engine.mjs';

const policy = {
  maxHops: 2,
  maxNodes: 8,
  maxTokens: 4000,
  preferVerified: true,
  includeContradictions: true,
  resolveSuperseded: true
};

function memory() {
  const initial = { schemaVersion: 1, version: 1, revision: 0, nodes: [], edges: [], events: [] };
  return appendGraphUpdate(initial, {
    nodes: [
      { id: 'OBJ-1', type: 'Objective', status: 'active', title: 'Reduce agent context cost', description: 'Keep execution bounded and deterministic.', updatedAt: '2026-10-01T10:00:00Z' },
      { id: 'DEC-1', type: 'Decision', status: 'verified', title: 'Use bounded graph context', description: 'Do not replay long chat history.', updatedAt: '2026-10-01T11:00:00Z' },
      { id: 'SRC-1', type: 'Source', status: 'verified', title: 'PES evidence', description: 'Verified source material.' }
    ],
    edges: [
      { id: 'E-1', type: 'DEPENDS_ON', from: 'OBJ-1', to: 'DEC-1' },
      { id: 'E-2', type: 'SUPPORTS', from: 'SRC-1', to: 'DEC-1', provenance: 'fixture' }
    ]
  }, {
    actorId: 'test',
    reason: 'agent efficiency fixture',
    eventId: 'GM-AE-0001',
    recordedAt: '2026-10-01T12:00:00Z'
  }).state;
}

test('agent brief preserves bounded context lineage while reducing payload size', () => {
  const graph = memory();
  const raw = buildRankedContext(graph, ['OBJ-1'], policy);
  const brief = buildAgentBrief(graph, ['OBJ-1'], policy);

  assert.equal(brief.kind, 'kairo-agent-brief');
  assert.equal(brief.contextHash, raw.contextHash);
  assert.equal(brief.objective, 'Reduce agent context cost');
  assert.ok(brief.estimatedTokens < raw.estimatedTokens);
  assert.ok(JSON.stringify(brief).length < serializeContext(raw).length);
});

test('agent brief reports unchanged context from a prior hash', () => {
  const graph = memory();
  const first = buildAgentBrief(graph, ['OBJ-1'], policy);
  const second = buildAgentBrief(graph, ['OBJ-1'], policy, { priorHash: first.contextHash });
  assert.equal(second.unchanged, true);
});

test('failure output strips ansi and keeps only a bounded tail', () => {
  const lines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join('\n');
  const result = compactFailureOutput(`\u001b[31m${lines}\u001b[0m`, { maxLines: 3, maxChars: 100 });
  assert.equal(result, 'line-10\nline-11\nline-12');
});
