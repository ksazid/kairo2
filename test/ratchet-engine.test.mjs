import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachArtifact,
  beginAttempt,
  createRatchetRun,
  evaluateAttempt,
  finalizeAttempt,
  recoverInterruptedRun,
  summarizeRun,
  toGraphUpdate,
  validateEvaluatorContract
} from '../src/ratchet-engine.mjs';
import { JsonRatchetRunStore } from '../src/run-store.mjs';
import { FileSnapshotWorkspaceAdapter, GitWorktreeAdapter } from '../src/workspace-adapters.mjs';
import { validateGraph } from '../src/core.mjs';

const budget = {
  maxModelCalls: 3, maxSubAgents: 0, maxConcurrentWorkers: 1, maxToolCalls: 10,
  maxTokens: 1000, maxFinancialCost: 2, maxWallClockMinutes: 5, maxRetries: 1,
  maxGraphWrites: 20, minEvidenceItems: 1
};
const evaluator = {
  id: 'EVAL-1', type: 'deterministic', metric: 'quality', direction: 'higher',
  rubricId: 'RUBRIC-1', minEvidenceItems: 1
};

function newRun(maxAttempts = 5) {
  return createRatchetRun({ id: 'RUN-1', objectiveId: 'OBJ-1', baselineScore: 0.60, evaluator, budget, maxAttempts });
}

function candidate(run, { id, score, digest, crashed = false }) {
  run = beginAttempt(run, { id, hypothesis: `candidate ${id}`, checkpointBefore: `checkpoint-${id}` });
  run = attachArtifact(run, id, { id: `ART-${id}`, version: 1, path: `${id}.txt`, digest });
  const evaluated = evaluateAttempt(run, id, {
    id: `EV-${id}`,
    rubricId: evaluator.rubricId,
    score,
    crashed,
    evidence: [{ source: 'fixture' }]
  });
  return finalizeAttempt(evaluated.run, id, { checkpointAfter: evaluated.result.decision === 'keep' ? `accepted-${id}` : null });
}

test('ratchet keeps measured improvement and retains failed lineage', () => {
  let run = newRun();
  run = candidate(run, { id: 'ATT-1', score: 0.55, digest: 'd1' });
  run = candidate(run, { id: 'ATT-2', score: 0.72, digest: 'd2' });
  run = candidate(run, { id: 'ATT-3', score: 0.70, digest: 'd3' });

  assert.equal(run.currentScore, 0.72);
  assert.equal(run.acceptedAttemptId, 'ATT-2');
  assert.deepEqual(run.attempts.map(a => a.status), ['reverted', 'kept', 'reverted']);
  assert.equal(summarizeRun(run).reverted, 2);
  assert.equal(run.attempts[0].parentAttemptId, null);
  assert.equal(run.attempts[1].parentAttemptId, 'ATT-1');
});

test('evaluation cannot keep without required evidence', () => {
  let run = newRun();
  run = beginAttempt(run, { id: 'ATT-1', hypothesis: 'test', checkpointBefore: 'cp' });
  run = attachArtifact(run, 'ATT-1', { id: 'ART-1', version: 1, path: 'x', digest: 'd' });
  assert.throws(() => evaluateAttempt(run, 'ATT-1', {
    id: 'EV-1', rubricId: evaluator.rubricId, score: 0.7, evidence: []
  }), /at least 1 evidence/);
});

test('interrupted attempt restores checkpoint and remains in lineage', () => {
  let run = newRun();
  run = beginAttempt(run, { id: 'ATT-1', hypothesis: 'unfinished', checkpointBefore: 'checkpoint-1' });
  const restores = [];
  run = recoverInterruptedRun(run, { restore: checkpoint => restores.push(checkpoint) }, { recoveredAt: '2026-09-01T00:00:00.000Z' });
  assert.deepEqual(restores, ['checkpoint-1']);
  assert.equal(run.attempts[0].status, 'recovered-reverted');
  assert.equal(run.attempts[0].recovery.restoredCheckpoint, 'checkpoint-1');
});

test('run store persists and reloads durable execution state atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pes-ratchet-store-'));
  const store = new JsonRatchetRunStore(path.join(dir, 'runs.json'));
  let run = newRun();
  run = candidate(run, { id: 'ATT-1', score: 0.75, digest: 'd1' });
  store.save(run);
  const loaded = store.load(run.id);
  assert.equal(loaded.currentScore, 0.75);
  assert.equal(loaded.attempts[0].status, 'kept');
});

test('file snapshot adapter reverses declared mutable files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pes-snapshot-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'before');
  const adapter = new FileSnapshotWorkspaceAdapter({ root });
  const checkpoint = adapter.checkpoint('ATT-1', ['a.txt', 'new.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'after');
  fs.writeFileSync(path.join(root, 'new.txt'), 'created');
  adapter.restore(checkpoint);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'before');
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), false);
});

test('git worktree adapter issues reversible isolated-workspace commands', () => {
  const calls = [];
  const runner = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (args[0] === 'rev-parse') return 'abc123\n';
    return '';
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pes-git-root-'));
  const adapter = new GitWorktreeAdapter({ repoRoot: root, worktreeRoot: path.join(root, 'worktrees'), runner });
  const worktree = adapter.prepare('ATT-1', 'main');
  assert.equal(adapter.checkpoint(worktree), 'abc123');
  adapter.restore('abc123', worktree);
  adapter.dispose(worktree);
  assert.deepEqual(calls.map(c => c.args.slice(0, 2)), [
    ['worktree', 'add'], ['rev-parse', 'HEAD'], ['reset', '--hard'], ['clean', '-fd'], ['worktree', 'remove']
  ]);
});

test('finalized attempts publish valid graph lineage', () => {
  let run = newRun();
  run = candidate(run, { id: 'ATT-1', score: 0.75, digest: 'd1' });
  const update = toGraphUpdate(run, 'ATT-1');
  assert.equal(validateGraph(update), true);
  assert.equal(update.nodes.some(n => n.type === 'Evaluation'), true);
  assert.equal(update.edges.some(e => e.type === 'PRODUCED'), true);

  run = candidate(run, { id: 'ATT-2', score: 0.80, digest: 'd2' });
  const secondUpdate = toGraphUpdate(run, 'ATT-2');
  assert.equal(validateGraph(secondUpdate), true);
  assert.equal(secondUpdate.edges.some(e => e.type === 'PARENT_OF'), true);
});

test('evaluator contract must declare metric, direction, rubric and evidence floor', () => {
  assert.equal(validateEvaluatorContract(evaluator), true);
  assert.throws(() => validateEvaluatorContract({ ...evaluator, direction: 'sideways' }), /direction/);
});
