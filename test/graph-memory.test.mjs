import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  JsonGraphMemoryStore,
  appendGraphUpdate,
  correctNode,
  explainArtifact,
  getObjectProvenance,
  normalizeGraphMemoryState,
  reconstructLineage,
  resolveCurrentNode,
  supersedeNode,
  validateGraphMemoryState
} from '../src/graph-memory.mjs';

const legacy = () => ({ version: 1, nodes: [{ id: 'OBJ-1', type: 'Objective', status: 'active' }], edges: [] });

test('legacy graph normalizes without losing nodes', () => {
  const state = normalizeGraphMemoryState(legacy());
  assert.equal(state.revision, 0);
  assert.equal(state.events.length, 0);
  assert.equal(validateGraphMemoryState(state), true);
});

test('append is provenance-bearing, revisioned and idempotent', () => {
  let state = normalizeGraphMemoryState(legacy());
  const update = {
    nodes: [{ id: 'RUN-1', type: 'AgentRun', status: 'failed', objectiveId: 'OBJ-1' }],
    edges: [{ id: 'E-1', type: 'ABOUT', from: 'RUN-1', to: 'OBJ-1' }]
  };
  let result = appendGraphUpdate(state, update, { actorId: 'agent', reason: 'record run', recordedAt: '2026-09-01T00:00:00.000Z' });
  state = result.state;
  assert.equal(state.revision, 1);
  assert.equal(state.nodes.at(-1).memoryProvenance.eventId, 'GM-000001');
  assert.equal(state.edges.at(-1).memoryProvenance.actorId, 'agent');
  const second = appendGraphUpdate(state, update, { actorId: 'agent', reason: 'retry publication' });
  assert.equal(second.changed, false);
  assert.equal(second.state.revision, 1);
});

test('conflicting id rewrite is rejected', () => {
  let state = normalizeGraphMemoryState(legacy());
  state = appendGraphUpdate(state, { nodes: [{ id: 'DEC-1', type: 'Decision', value: 'A' }], edges: [] }, { actorId: 'human', reason: 'decision' }).state;
  assert.throws(() => appendGraphUpdate(state, { nodes: [{ id: 'DEC-1', type: 'Decision', value: 'B' }], edges: [] }, { actorId: 'agent', reason: 'rewrite' }), /Conflicting node rewrite/);
});

test('supersession is immutable and current resolution follows the chain', () => {
  let state = normalizeGraphMemoryState({ version: 1, nodes: [{ id: 'DEC-1', type: 'Decision', value: 'A' }], edges: [] });
  state = supersedeNode(state, {
    targetId: 'DEC-1', replacement: { id: 'DEC-2', type: 'Decision', value: 'B' }, actorId: 'human', reason: 'approved replacement'
  }).state;
  assert.equal(state.nodes.find(n => n.id === 'DEC-1').value, 'A');
  assert.equal(resolveCurrentNode(state, 'DEC-1').currentId, 'DEC-2');
  assert.throws(() => supersedeNode(state, {
    targetId: 'DEC-1', replacement: { id: 'DEC-3', type: 'Decision', value: 'C' }, actorId: 'human', reason: 'stale replacement'
  }), /stale or conflicted/);
});

test('correction preserves original object and reason', () => {
  const state = normalizeGraphMemoryState({ version: 1, nodes: [{ id: 'SRC-1', type: 'Source', title: 'wrong' }], edges: [] });
  const result = correctNode(state, {
    targetId: 'SRC-1', replacement: { id: 'SRC-2', type: 'Source', title: 'correct' }, actorId: 'operator', reason: 'source title was incorrect'
  });
  assert.equal(result.state.nodes.find(n => n.id === 'SRC-1').title, 'wrong');
  assert.equal(result.state.nodes.find(n => n.id === 'SRC-2').correctionReason, 'source title was incorrect');
  assert.equal(result.event.operation, 'correction');
});

test('artifact explanation reconstructs accepted and failed attempts', () => {
  let state = normalizeGraphMemoryState({ version: 1, nodes: [{ id: 'OBJ-1', type: 'Objective', status: 'active' }], edges: [] });
  state = appendGraphUpdate(state, {
    nodes: [
      { id: 'ATT-1', type: 'AgentRun', status: 'failed', objectiveId: 'OBJ-1', startedAt: '2026-09-01T00:00:00Z' },
      { id: 'ATT-2', type: 'AgentRun', status: 'verified', objectiveId: 'OBJ-1', startedAt: '2026-09-01T00:01:00Z' },
      { id: 'ART-2', type: 'Artifact', status: 'verified', runId: 'ATT-2', version: 1 },
      { id: 'EV-2', type: 'Evaluation', status: 'verified', rubricId: 'R-1', score: 0.8 }
    ],
    edges: [
      { id: 'E-PARENT', type: 'PARENT_OF', from: 'ATT-1', to: 'ATT-2' },
      { id: 'E-PROD', type: 'PRODUCED', from: 'ATT-2', to: 'ART-2' },
      { id: 'E-EVAL', type: 'EVALUATES', from: 'EV-2', to: 'ART-2' }
    ]
  }, { actorId: 'ratchet-engine', runId: 'ATT-2', reason: 'publish attempt lineage' }).state;

  const report = explainArtifact(state, 'ART-2');
  assert.equal(report.objectives[0].id, 'OBJ-1');
  assert.equal(report.failedAttempts[0].id, 'ATT-1');
  assert.equal(report.evaluations[0].id, 'EV-2');
  assert.equal(report.provenance.tracked, true);
  assert.equal(reconstructLineage(state, 'ART-2').nodes.length >= 3, true);
  assert.equal(getObjectProvenance(state, 'ART-2').events.length, 1);
});

test('file store persists append-only revisions and rejects stale writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pes-graph-memory-'));
  const file = path.join(dir, 'graph.json');
  fs.writeFileSync(file, JSON.stringify(legacy()));
  const store = new JsonGraphMemoryStore(file);
  const first = store.append({ nodes: [{ id: 'SRC-1', type: 'Source' }], edges: [] }, { actorId: 'ingest', reason: 'source', expectedRevision: 0 });
  assert.equal(first.state.revision, 1);
  assert.throws(() => store.append({ nodes: [{ id: 'SRC-2', type: 'Source' }], edges: [] }, { actorId: 'ingest', reason: 'stale', expectedRevision: 0 }), /revision conflict/);
  assert.equal(store.load().nodes.some(n => n.id === 'SRC-1'), true);
});

test('strict provenance validation accepts fully tracked state', () => {
  let state = normalizeGraphMemoryState({ version: 1, nodes: [], edges: [] });
  state = appendGraphUpdate(state, { nodes: [{ id: 'S-1', type: 'Source' }], edges: [] }, { actorId: 'ingest', reason: 'seed' }).state;
  assert.equal(validateGraphMemoryState(state, { requireObjectProvenance: true }), true);
});
