import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessMultiAgentExecution,
  buildExecutionTopology,
  evaluateExecutionBenchmark,
  JsonExecutionBenchmarkStore,
  validateExecutionPlan,
  validateMultiAgentPolicy
} from '../src/multi-agent-engine.mjs';

const governance = { riskLevels: ['low', 'medium', 'high'] };
const policy = {
  version: 1,
  maxWorkers: 4,
  maxTasks: 16,
  minIndependentTasks: 2,
  requireIsolation: true,
  requireReducer: true,
  rejectConcurrentWriteOverlap: true,
  allowedRiskLevels: ['low', 'medium'],
  benchmark: {
    minSamplesPerMode: 3,
    maxQualityRegression: 0,
    maxFailureRateIncrease: 0,
    maxCostIncreasePercent: 50,
    minWallClockImprovementPercent: 20,
    minCoverageImprovementPercent: 10,
    requireAtLeastOneMeasuredBenefit: true
  }
};

const budget = {
  maxModelCalls: 10,
  maxSubAgents: 4,
  maxConcurrentWorkers: 2,
  maxToolCalls: 40,
  maxTokens: 10000,
  maxFinancialCost: 10,
  maxWallClockMinutes: 60,
  maxRetries: 2,
  maxGraphWrites: 100,
  minEvidenceItems: 1
};

function graph() {
  return {
    schemaVersion: 1,
    version: 2,
    revision: 0,
    nodes: [{ id: 'OBJ-1', type: 'Objective', status: 'active' }],
    edges: [],
    events: []
  };
}

function plan(overrides = {}) {
  return {
    id: 'PLAN-1',
    objectiveId: 'OBJ-1',
    riskLevel: 'medium',
    reducer: { id: 'REDUCE-1', strategy: 'evidence-ranked-merge', outputContract: 'one accepted implementation artifact' },
    tasks: [
      {
        id: 'A', role: 'implementer', dependsOn: [], isolation: 'worktree',
        writeSet: ['src/a.mjs'], readSet: [], estimatedModelCalls: 2, estimatedTokens: 1200, estimatedCost: 1
      },
      {
        id: 'B', role: 'test-author', dependsOn: [], isolation: 'worktree',
        writeSet: ['test/b.test.mjs'], readSet: ['src/a.mjs'], estimatedModelCalls: 2, estimatedTokens: 1000, estimatedCost: 1
      },
      {
        id: 'C', role: 'reviewer', dependsOn: ['A', 'B'], isolation: 'worktree',
        writeSet: ['reports/review.json'], readSet: ['src/a.mjs', 'test/b.test.mjs'], estimatedModelCalls: 1, estimatedTokens: 800, estimatedCost: 0.5
      }
    ],
    ...overrides
  };
}

function passingBenchmark() {
  return {
    single: [
      { quality: 0.90, coverage: 0.80, wallClockMinutes: 60, cost: 3.0, failureRate: 0 },
      { quality: 0.91, coverage: 0.80, wallClockMinutes: 58, cost: 3.1, failureRate: 0 },
      { quality: 0.90, coverage: 0.81, wallClockMinutes: 62, cost: 2.9, failureRate: 0 }
    ],
    multi: [
      { quality: 0.92, coverage: 0.82, wallClockMinutes: 35, cost: 3.8, failureRate: 0 },
      { quality: 0.91, coverage: 0.83, wallClockMinutes: 36, cost: 3.9, failureRate: 0 },
      { quality: 0.92, coverage: 0.82, wallClockMinutes: 34, cost: 3.7, failureRate: 0 }
    ]
  };
}

test('multi-agent policy validates conservative benchmark thresholds', () => {
  assert.equal(validateMultiAgentPolicy(policy, governance), true);
});

test('plan requires reducer, isolation and acyclic dependencies', () => {
  assert.equal(validateExecutionPlan(plan(), policy), true);
  assert.throws(() => validateExecutionPlan(plan({ reducer: null }), policy), /requires a reducer/);
  const cyclic = plan();
  cyclic.tasks[0].dependsOn = ['C'];
  assert.throws(() => validateExecutionPlan(cyclic, policy), /Dependency cycle/);
});

test('topology parallelizes independent non-overlapping tasks and respects dependencies', () => {
  const topology = buildExecutionTopology(plan(), policy);
  assert.deepEqual(topology.waves, [['A', 'B'], ['C']]);
  assert.equal(topology.maxParallelWidth, 2);
  assert.equal(topology.independentEnough, true);
});

test('overlapping writes are not allowed in the same execution wave', () => {
  const conflicting = plan();
  conflicting.tasks[1].writeSet = ['src/a.mjs'];
  const topology = buildExecutionTopology(conflicting, policy);
  assert.equal(topology.maxParallelWidth, 1);
  assert.ok(topology.deferredConflicts.some(item => item.taskId === 'B' && item.conflictsWith === 'A'));
});

test('benchmark passes only when value improves without quality, failure or cost regression beyond policy', () => {
  const result = evaluateExecutionBenchmark(passingBenchmark(), policy);
  assert.equal(result.passed, true);
  assert.ok(result.benefits.some(item => item.type === 'wall-clock'));
  assert.ok(result.deltas.wallClockImprovementPercent >= 20);
});

test('faster multi-agent run is rejected when quality regresses', () => {
  const benchmark = passingBenchmark();
  benchmark.multi = benchmark.multi.map(sample => ({ ...sample, quality: 0.80 }));
  const result = evaluateExecutionBenchmark(benchmark, policy);
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some(item => item.code === 'quality-regression'));
});

test('multi-agent mode is not justified when no measured benefit threshold is met', () => {
  const benchmark = passingBenchmark();
  benchmark.multi = benchmark.single.map(sample => ({ ...sample, wallClockMinutes: sample.wallClockMinutes * 0.95 }));
  const result = evaluateExecutionBenchmark(benchmark, policy);
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some(item => item.code === 'no-measured-benefit'));
});

test('passing benchmark can make a plan activation-ready while PES keeps multi-agent disabled', () => {
  const result = assessMultiAgentExecution({
    plan: plan(), benchmark: passingBenchmark(), policy, governance,
    config: { available: true, enabled: false, activationRequiresBenchmark: true },
    budget, graph: graph()
  });
  assert.equal(result.eligible, true);
  assert.equal(result.activationReady, true);
  assert.equal(result.authorized, false);
  assert.ok(result.authorizationBlockers.some(item => item.code === 'multi-agent-disabled'));
});

test('execution is authorized only after explicit enablement and sufficient PES budgets', () => {
  const result = assessMultiAgentExecution({
    plan: plan(), benchmark: passingBenchmark(), policy, governance,
    config: { available: true, enabled: true, activationRequiresBenchmark: true },
    budget, graph: graph()
  });
  assert.equal(result.authorized, true);
});

test('lite-style budget blocks multi-agent execution even with a good benchmark', () => {
  const liteBudget = { ...budget, maxSubAgents: 0, maxConcurrentWorkers: 1 };
  const result = assessMultiAgentExecution({
    plan: plan(), benchmark: passingBenchmark(), policy, governance,
    config: { available: true, enabled: true, activationRequiresBenchmark: true },
    budget: liteBudget, graph: graph()
  });
  assert.equal(result.authorized, false);
  assert.ok(result.blockers.some(item => item.code === 'concurrency-budget-exceeded'));
  assert.ok(result.blockers.some(item => item.code === 'subagent-budget-exceeded'));
});

test('high-risk plans remain ineligible by default', () => {
  const result = assessMultiAgentExecution({
    plan: plan({ riskLevel: 'high' }), benchmark: passingBenchmark(), policy, governance,
    config: { available: true, enabled: true, activationRequiresBenchmark: true },
    budget, graph: graph()
  });
  assert.equal(result.authorized, false);
  assert.ok(result.blockers.some(item => item.code === 'risk-not-eligible'));
});

test('benchmark store is append-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pes-benchmark-store-'));
  const store = new JsonExecutionBenchmarkStore(path.join(dir, 'benchmarks.json'));
  store.append({ id: 'BENCH-1', planId: 'PLAN-1', result: { passed: true } });
  assert.equal(store.loadAll().records.length, 1);
  assert.throws(() => store.append({ id: 'BENCH-1', planId: 'PLAN-1' }), /Duplicate benchmark record id/);
});
