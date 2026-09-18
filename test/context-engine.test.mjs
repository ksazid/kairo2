import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRankedContext, contextHashFor, serializeContext, validateContextPolicy } from '../src/context-engine.mjs';
import { appendGraphUpdate } from '../src/graph-memory.mjs';

const policy = {
  maxHops: 2,
  maxNodes: 8,
  maxTokens: 4000,
  preferVerified: true,
  includeContradictions: true,
  resolveSuperseded: true
};

function memory() {
  let state = { schemaVersion: 1, version: 1, revision: 0, nodes: [], edges: [], events: [] };
  const result = appendGraphUpdate(state, {
    nodes: [
      { id: 'OBJ-1', type: 'Objective', status: 'active', title: 'Ship safe context', updatedAt: '2026-09-01T10:00:00Z' },
      { id: 'DEC-good', type: 'Decision', status: 'verified', title: 'Use bounded graph context', updatedAt: '2026-09-01T11:00:00Z' },
      { id: 'DEC-old', type: 'Decision', status: 'failed', title: 'Replay every transcript', updatedAt: '2026-08-01T11:00:00Z' },
      { id: 'CLAIM-A', type: 'Claim', status: 'verified', sourceIds: ['SRC-1'], title: 'Context should be bounded', updatedAt: '2026-09-01T11:10:00Z' },
      { id: 'CLAIM-B', type: 'Claim', status: 'verified', sourceIds: ['SRC-2'], title: 'Some tasks need wider context', updatedAt: '2026-09-01T11:11:00Z' },
      { id: 'SRC-1', type: 'Source', status: 'verified', title: 'Evidence A' },
      { id: 'SRC-2', type: 'Source', status: 'verified', title: 'Evidence B' }
    ],
    edges: [
      { id: 'E-1', type: 'DEPENDS_ON', from: 'OBJ-1', to: 'DEC-good' },
      { id: 'E-2', type: 'DEPENDS_ON', from: 'OBJ-1', to: 'DEC-old' },
      { id: 'E-3', type: 'ABOUT', from: 'DEC-good', to: 'CLAIM-A' },
      { id: 'E-4', type: 'CONTRADICTS', from: 'CLAIM-A', to: 'CLAIM-B', provenance: 'fixture' },
      { id: 'E-5', type: 'SUPPORTS', from: 'SRC-1', to: 'CLAIM-A', provenance: 'fixture' },
      { id: 'E-6', type: 'SUPPORTS', from: 'SRC-2', to: 'CLAIM-B', provenance: 'fixture' }
    ]
  }, {
    actorId: 'test',
    reason: 'context fixture',
    eventId: 'GM-000001',
    recordedAt: '2026-09-01T12:00:00Z'
  });
  return result.state;
}

test('context policy is explicit and bounded', () => {
  assert.equal(validateContextPolicy(policy), true);
  assert.throws(() => validateContextPolicy({ ...policy, maxTokens: 0 }), /maxTokens/);
});

test('verified and recent state outranks failed alternatives at the same hop', () => {
  const result = buildRankedContext(memory(), ['OBJ-1'], policy);
  const good = result.ranking.findIndex(item => item.id === 'DEC-good');
  const old = result.ranking.findIndex(item => item.id === 'DEC-old');
  assert.ok(good >= 0 && old >= 0);
  assert.ok(good < old);
});

test('contradictory claims are surfaced together with explicit conflict metadata', () => {
  const result = buildRankedContext(memory(), ['CLAIM-A'], policy);
  assert.ok(result.nodes.some(node => node.id === 'CLAIM-A'));
  assert.ok(result.nodes.some(node => node.id === 'CLAIM-B'));
  assert.equal(result.contradictions.length, 1);
  assert.deepEqual(new Set([result.contradictions[0].from, result.contradictions[0].to]), new Set(['CLAIM-A','CLAIM-B']));
});

test('context hash is deterministic and changes when relevant graph state changes', () => {
  const first = buildRankedContext(memory(), ['OBJ-1'], policy);
  const second = buildRankedContext(memory(), ['OBJ-1'], policy);
  assert.equal(first.contextHash, second.contextHash);
  assert.equal(first.unchangedFrom(second.contextHash), true);
  assert.equal(contextHashFor(first), first.contextHash);

  const changed = appendGraphUpdate(memory(), {
    nodes: [{ id: 'DEC-new', type: 'Decision', status: 'verified', title: 'New nearby decision' }],
    edges: [{ id: 'E-new', type: 'DEPENDS_ON', from: 'OBJ-1', to: 'DEC-new' }]
  }, { actorId: 'test', reason: 'add relevant state', eventId: 'GM-000002', recordedAt: '2026-09-01T13:00:00Z' }).state;
  const third = buildRankedContext(changed, ['OBJ-1'], policy);
  assert.notEqual(first.contextHash, third.contextHash);
});

test('serialization stays inside declared token budget and omits lower-ranked nodes first', () => {
  const constrained = { ...policy, maxNodes: 7, maxTokens: 600 };
  const result = buildRankedContext(memory(), ['OBJ-1'], constrained);
  assert.ok(result.estimatedTokens <= constrained.maxTokens);
  assert.ok(result.nodes.some(node => node.id === 'OBJ-1'));
  assert.ok(result.nodes.some(node => node.id === 'DEC-good'));
  assert.equal(result.truncated, true);
  assert.ok(serializeContext(result).includes(result.contextHash));
});

test('superseded seed resolves to current approved node before ranking', () => {
  const original = memory();
  const withReplacement = appendGraphUpdate(original, {
    nodes: [{ id: 'DEC-good-v2', type: 'Decision', status: 'verified', title: 'Use bounded ranked graph context', logicalId: 'DEC-good', supersedesId: 'DEC-good' }],
    edges: [{ id: 'E-super', type: 'SUPERSEDES', from: 'DEC-good-v2', to: 'DEC-good' }]
  }, { actorId: 'test', reason: 'supersede decision', eventId: 'GM-000002', recordedAt: '2026-09-01T13:00:00Z' }).state;

  const result = buildRankedContext(withReplacement, ['DEC-good'], policy);
  assert.deepEqual(result.resolvedSeeds, ['DEC-good-v2']);
  assert.equal(result.resolution[0].currentId, 'DEC-good-v2');
});
