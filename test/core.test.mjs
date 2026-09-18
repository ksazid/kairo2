import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, ratchetDecision, validateBudget, validateGraph, validateRunUsage } from '../src/core.mjs';

const budget = {
  maxModelCalls: 3, maxSubAgents: 0, maxConcurrentWorkers: 1, maxToolCalls: 10,
  maxTokens: 1000, maxFinancialCost: 2, maxWallClockMinutes: 5, maxRetries: 1,
  maxGraphWrites: 20, minEvidenceItems: 1
};

test('budget contract validates and detects overrun', () => {
  assert.equal(validateBudget(budget), true);
  const result = validateRunUsage({ modelCalls: 4 }, budget);
  assert.equal(result.ok, false);
  assert.equal(result.exceeded[0].usage, 'modelCalls');
});

test('ratchet keeps only declared metric improvement', () => {
  assert.equal(ratchetDecision({ baseline: 10, candidate: 9, direction: 'lower' }).decision, 'keep');
  assert.equal(ratchetDecision({ baseline: 10, candidate: 11, direction: 'lower' }).decision, 'revert');
  assert.equal(ratchetDecision({ baseline: 10, candidate: 9, direction: 'lower', crashed: true }).decision, 'revert');
});

test('graph requires provenance for evidence edges', () => {
  const graph = {
    nodes: [
      { id: 'C1', type: 'Claim', sourceIds: ['S1'] },
      { id: 'S1', type: 'Source' }
    ],
    edges: [{ id: 'E1', type: 'SUPPORTS', from: 'S1', to: 'C1', provenance: 'fixture' }]
  };
  assert.equal(validateGraph(graph), true);
});

test('bounded context respects hops and node limit', () => {
  const graph = {
    nodes: [
      { id: 'A', type: 'Objective', status: 'active' },
      { id: 'B', type: 'Decision', status: 'approved' },
      { id: 'C', type: 'Artifact', status: 'verified', runId: 'R1', version: 1 },
      { id: 'D', type: 'Source', status: 'verified' }
    ],
    edges: [
      { id: 'AB', type: 'DEPENDS_ON', from: 'A', to: 'B' },
      { id: 'BC', type: 'PRODUCED', from: 'B', to: 'C' },
      { id: 'CD', type: 'DERIVED_FROM', from: 'C', to: 'D', provenance: 'fixture' }
    ]
  };
  const context = buildContext(graph, ['A'], { maxHops: 1, maxNodes: 10 });
  assert.deepEqual(context.nodes.map(n => n.id), ['A','B']);
  assert.equal(context.edges.length, 1);
});
