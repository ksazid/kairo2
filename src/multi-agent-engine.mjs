import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { invariant, validateBudget } from './core.mjs';
import { normalizeGraphMemoryState, validateGraphMemoryState } from './graph-memory.mjs';

const clone = value => structuredClone(value);
const ISOLATION_TYPES = new Set(['worktree', 'sandbox', 'container']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function validateMultiAgentPolicy(policy, governance) {
  invariant(policy && typeof policy === 'object', 'Multi-agent policy is required');
  invariant(policy.version === 1, 'Unsupported multi-agent policy version');
  invariant(Number.isInteger(policy.maxWorkers) && policy.maxWorkers >= 2, 'maxWorkers must be >= 2');
  invariant(Number.isInteger(policy.maxTasks) && policy.maxTasks >= policy.maxWorkers, 'maxTasks must be >= maxWorkers');
  invariant(Number.isInteger(policy.minIndependentTasks) && policy.minIndependentTasks >= 2, 'minIndependentTasks must be >= 2');
  invariant(typeof policy.requireIsolation === 'boolean', 'requireIsolation must be boolean');
  invariant(typeof policy.requireReducer === 'boolean', 'requireReducer must be boolean');
  invariant(typeof policy.rejectConcurrentWriteOverlap === 'boolean', 'rejectConcurrentWriteOverlap must be boolean');
  invariant(Array.isArray(policy.allowedRiskLevels), 'allowedRiskLevels must be an array');
  invariant(governance && Array.isArray(governance.riskLevels), 'Governance riskLevels are required');
  for (const risk of policy.allowedRiskLevels) invariant(governance.riskLevels.includes(risk), `Unknown multi-agent risk level: ${risk}`);

  const benchmark = policy.benchmark;
  invariant(benchmark && typeof benchmark === 'object', 'Benchmark policy is required');
  invariant(Number.isInteger(benchmark.minSamplesPerMode) && benchmark.minSamplesPerMode >= 2, 'minSamplesPerMode must be >= 2');
  for (const key of ['maxQualityRegression','maxFailureRateIncrease','maxCostIncreasePercent','minWallClockImprovementPercent','minCoverageImprovementPercent']) {
    invariant(Number.isFinite(benchmark[key]) && benchmark[key] >= 0, `Invalid benchmark threshold: ${key}`);
  }
  invariant(typeof benchmark.requireAtLeastOneMeasuredBenefit === 'boolean', 'requireAtLeastOneMeasuredBenefit must be boolean');
  return true;
}

export function validateExecutionPlan(plan, policy) {
  invariant(plan && typeof plan === 'object', 'Execution plan is required');
  invariant(typeof plan.id === 'string' && plan.id, 'Plan id is required');
  invariant(typeof plan.objectiveId === 'string' && plan.objectiveId, 'Plan objectiveId is required');
  invariant(typeof plan.riskLevel === 'string' && plan.riskLevel, 'Plan riskLevel is required');
  invariant(Array.isArray(plan.tasks) && plan.tasks.length >= 1, 'Plan requires tasks');
  invariant(plan.tasks.length <= policy.maxTasks, `Plan exceeds maxTasks (${plan.tasks.length} > ${policy.maxTasks})`);
  if (policy.requireReducer) {
    invariant(plan.reducer && typeof plan.reducer.id === 'string' && plan.reducer.id, 'Multi-agent plan requires a reducer');
    invariant(typeof plan.reducer.strategy === 'string' && plan.reducer.strategy, 'Reducer strategy is required');
    invariant(typeof plan.reducer.outputContract === 'string' && plan.reducer.outputContract, 'Reducer outputContract is required');
  }

  const ids = new Set();
  for (const task of plan.tasks) {
    invariant(typeof task.id === 'string' && task.id, 'Every task requires id');
    invariant(!ids.has(task.id), `Duplicate task id: ${task.id}`);
    ids.add(task.id);
    invariant(typeof task.role === 'string' && task.role, `Task ${task.id} requires role`);
    invariant(Array.isArray(task.dependsOn), `Task ${task.id} dependsOn must be an array`);
    invariant(Array.isArray(task.writeSet), `Task ${task.id} writeSet must be an array`);
    invariant(Array.isArray(task.readSet ?? []), `Task ${task.id} readSet must be an array`);
    if (policy.requireIsolation) invariant(ISOLATION_TYPES.has(task.isolation), `Task ${task.id} requires isolated execution`);
    for (const key of ['estimatedModelCalls','estimatedTokens','estimatedCost']) {
      invariant(Number.isFinite(task[key] ?? 0) && (task[key] ?? 0) >= 0, `Task ${task.id} has invalid ${key}`);
    }
  }

  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      invariant(ids.has(dep), `Task ${task.id} depends on unknown task ${dep}`);
      invariant(dep !== task.id, `Task ${task.id} cannot depend on itself`);
    }
  }
  detectCycle(plan.tasks);
  return true;
}

export function buildExecutionTopology(plan, policy) {
  validateExecutionPlan(plan, policy);
  const pending = new Map(plan.tasks.map(task => [task.id, clone(task)]));
  const completed = new Set();
  const waves = [];
  const deferredConflicts = [];

  while (pending.size) {
    const ready = [...pending.values()]
      .filter(task => task.dependsOn.every(dep => completed.has(dep)))
      .sort((a, b) => a.id.localeCompare(b.id));
    invariant(ready.length > 0, 'Execution plan cannot make progress');

    const selected = [];
    for (const task of ready) {
      if (selected.length >= policy.maxWorkers) break;
      const conflict = policy.rejectConcurrentWriteOverlap && selected.find(other => writeSetsOverlap(task.writeSet, other.writeSet));
      if (conflict) {
        deferredConflicts.push({ taskId: task.id, conflictsWith: conflict.id, paths: overlappingPaths(task.writeSet, conflict.writeSet) });
        continue;
      }
      selected.push(task);
    }
    if (!selected.length) selected.push(ready[0]);

    waves.push(selected.map(task => task.id));
    for (const task of selected) {
      pending.delete(task.id);
      completed.add(task.id);
    }
  }

  const maxParallelWidth = Math.max(...waves.map(wave => wave.length));
  return {
    planId: plan.id,
    waves,
    maxParallelWidth,
    independentEnough: maxParallelWidth >= policy.minIndependentTasks,
    deferredConflicts,
    taskCount: plan.tasks.length
  };
}

export function evaluateExecutionBenchmark(benchmark, policy) {
  const threshold = policy.benchmark;
  invariant(benchmark && Array.isArray(benchmark.single) && Array.isArray(benchmark.multi), 'Benchmark requires single and multi samples');
  invariant(benchmark.single.length >= threshold.minSamplesPerMode, `Single-worker benchmark requires at least ${threshold.minSamplesPerMode} samples`);
  invariant(benchmark.multi.length >= threshold.minSamplesPerMode, `Multi-agent benchmark requires at least ${threshold.minSamplesPerMode} samples`);

  for (const [mode, samples] of [['single', benchmark.single], ['multi', benchmark.multi]]) {
    for (const sample of samples) validateBenchmarkSample(sample, mode);
  }

  const single = aggregateSamples(benchmark.single);
  const multi = aggregateSamples(benchmark.multi);
  const qualityDelta = multi.quality - single.quality;
  const coverageImprovementPercent = percentageChange(single.coverage, multi.coverage);
  const wallClockImprovementPercent = improvementPercent(single.wallClockMinutes, multi.wallClockMinutes);
  const costIncreasePercent = percentageChange(single.cost, multi.cost);
  const failureRateIncrease = multi.failureRate - single.failureRate;

  const blockers = [];
  if (qualityDelta < -threshold.maxQualityRegression) blockers.push({ code: 'quality-regression', message: `Quality regressed by ${Math.abs(qualityDelta).toFixed(4)}` });
  if (failureRateIncrease > threshold.maxFailureRateIncrease) blockers.push({ code: 'failure-rate-regression', message: `Failure rate increased by ${failureRateIncrease.toFixed(4)}` });
  if (costIncreasePercent > threshold.maxCostIncreasePercent) blockers.push({ code: 'cost-regression', message: `Cost increased ${costIncreasePercent.toFixed(2)}%` });

  const benefits = [];
  if (wallClockImprovementPercent >= threshold.minWallClockImprovementPercent) benefits.push({ type: 'wall-clock', value: wallClockImprovementPercent });
  if (coverageImprovementPercent >= threshold.minCoverageImprovementPercent) benefits.push({ type: 'coverage', value: coverageImprovementPercent });
  if (qualityDelta > 0) benefits.push({ type: 'quality', value: qualityDelta });
  if (threshold.requireAtLeastOneMeasuredBenefit && benefits.length === 0) blockers.push({ code: 'no-measured-benefit', message: 'Multi-agent mode did not meet any declared benefit threshold' });

  return {
    passed: blockers.length === 0,
    blockers,
    benefits,
    single,
    multi,
    deltas: { qualityDelta, coverageImprovementPercent, wallClockImprovementPercent, costIncreasePercent, failureRateIncrease },
    benchmarkHash: stableHash({ single: benchmark.single, multi: benchmark.multi })
  };
}

export function assessMultiAgentExecution({
  plan,
  benchmark,
  policy,
  governance,
  config,
  budget,
  graph
}) {
  validateMultiAgentPolicy(policy, governance);
  validateExecutionPlan(plan, policy);
  validateBudget(budget);
  const graphState = normalizeGraphMemoryState(graph);
  validateGraphMemoryState(graphState);

  const blockers = [];
  const authorizationBlockers = [];
  const objective = graphState.nodes.find(node => node.id === plan.objectiveId);
  if (!objective || objective.type !== 'Objective') blockers.push({ code: 'missing-objective', message: `Plan objective ${plan.objectiveId} is not present in graph memory` });
  if (!policy.allowedRiskLevels.includes(plan.riskLevel)) blockers.push({ code: 'risk-not-eligible', message: `Risk level ${plan.riskLevel} is not eligible for multi-agent execution` });

  const topology = buildExecutionTopology(plan, policy);
  if (!topology.independentEnough) blockers.push({ code: 'insufficient-independent-work', message: `Plan parallel width ${topology.maxParallelWidth} is below required ${policy.minIndependentTasks}` });

  const estimate = estimatePlanUsage(plan, topology);
  if (estimate.maxConcurrentWorkers > budget.maxConcurrentWorkers) blockers.push({ code: 'concurrency-budget-exceeded', message: `Plan needs ${estimate.maxConcurrentWorkers} workers; budget allows ${budget.maxConcurrentWorkers}` });
  if (plan.tasks.length > budget.maxSubAgents) blockers.push({ code: 'subagent-budget-exceeded', message: `Plan has ${plan.tasks.length} worker tasks; budget allows ${budget.maxSubAgents}` });
  if (estimate.modelCalls > budget.maxModelCalls) blockers.push({ code: 'model-call-budget-exceeded', message: `Plan estimates ${estimate.modelCalls} model calls; budget allows ${budget.maxModelCalls}` });
  if (estimate.tokens > budget.maxTokens) blockers.push({ code: 'token-budget-exceeded', message: `Plan estimates ${estimate.tokens} tokens; budget allows ${budget.maxTokens}` });
  if (estimate.financialCost > budget.maxFinancialCost) blockers.push({ code: 'financial-budget-exceeded', message: `Plan estimates cost ${estimate.financialCost}; budget allows ${budget.maxFinancialCost}` });

  let benchmarkResult = null;
  if (benchmark) benchmarkResult = evaluateExecutionBenchmark(benchmark, policy);
  else blockers.push({ code: 'benchmark-required', message: 'Measured single-worker vs multi-agent benchmark is required' });
  if (benchmarkResult && !benchmarkResult.passed) blockers.push(...benchmarkResult.blockers.map(item => ({ ...item, source: 'benchmark' })));

  const activationReady = blockers.length === 0;
  if (config?.available !== true) authorizationBlockers.push({ code: 'multi-agent-unavailable', message: 'Multi-agent execution is not available in PES configuration' });
  if (config?.enabled !== true) authorizationBlockers.push({ code: 'multi-agent-disabled', message: 'Multi-agent execution remains disabled until explicitly enabled after benchmark approval' });
  if (config?.activationRequiresBenchmark !== true) authorizationBlockers.push({ code: 'invalid-activation-policy', message: 'PES must require a benchmark before activation' });

  return {
    planId: plan.id,
    objectiveId: plan.objectiveId,
    eligible: blockers.length === 0,
    activationReady,
    authorized: activationReady && authorizationBlockers.length === 0,
    blockers,
    authorizationBlockers,
    topology,
    estimate,
    benchmark: benchmarkResult,
    planHash: stableHash(plan)
  };
}

export class JsonExecutionBenchmarkStore {
  constructor(filePath) {
    invariant(typeof filePath === 'string' && filePath, 'Benchmark store path is required');
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  loadAll() {
    if (!fs.existsSync(this.filePath)) return { schemaVersion: 1, records: [] };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    invariant(parsed?.schemaVersion === 1 && Array.isArray(parsed.records), 'Invalid execution benchmark store');
    return parsed;
  }

  append(record) {
    invariant(record && typeof record.id === 'string' && record.id, 'Benchmark record id is required');
    return this.withLock(() => {
      const state = this.loadAll();
      invariant(!state.records.some(item => item.id === record.id), `Duplicate benchmark record id: ${record.id}`);
      state.records.push(clone(record));
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.filePath);
      return clone(record);
    });
  }

  withLock(fn) {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    let fd;
    let acquired = false;
    try {
      fd = fs.openSync(this.lockPath, 'wx');
      acquired = true;
      return fn();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (acquired && fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);
    }
  }
}

function detectCycle(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    invariant(!visiting.has(id), `Dependency cycle detected at ${id}`);
    visiting.add(id);
    for (const dep of byId.get(id).dependsOn) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

function writeSetsOverlap(a, b) {
  return overlappingPaths(a, b).length > 0;
}

function overlappingPaths(a, b) {
  const left = new Set(a);
  return [...new Set(b.filter(path => left.has(path)))];
}

function validateBenchmarkSample(sample, mode) {
  invariant(sample && typeof sample === 'object', `${mode} benchmark sample is required`);
  for (const key of ['quality','coverage','wallClockMinutes','cost','failureRate']) {
    invariant(Number.isFinite(sample[key]), `${mode} benchmark sample has invalid ${key}`);
  }
  invariant(sample.wallClockMinutes >= 0 && sample.cost >= 0, `${mode} benchmark duration and cost must be non-negative`);
  invariant(sample.failureRate >= 0 && sample.failureRate <= 1, `${mode} failureRate must be between 0 and 1`);
}

function aggregateSamples(samples) {
  const avg = key => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
  return {
    samples: samples.length,
    quality: avg('quality'),
    coverage: avg('coverage'),
    wallClockMinutes: avg('wallClockMinutes'),
    cost: avg('cost'),
    failureRate: avg('failureRate')
  };
}

function percentageChange(baseline, candidate) {
  if (baseline === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((candidate - baseline) / Math.abs(baseline)) * 100;
}

function improvementPercent(baseline, candidate) {
  if (baseline === 0) return candidate === 0 ? 0 : Number.NEGATIVE_INFINITY;
  return ((baseline - candidate) / Math.abs(baseline)) * 100;
}

function estimatePlanUsage(plan, topology) {
  return {
    modelCalls: plan.tasks.reduce((sum, task) => sum + (task.estimatedModelCalls ?? 0), 0),
    tokens: plan.tasks.reduce((sum, task) => sum + (task.estimatedTokens ?? 0), 0),
    financialCost: plan.tasks.reduce((sum, task) => sum + (task.estimatedCost ?? 0), 0),
    maxConcurrentWorkers: topology.maxParallelWidth
  };
}

export { stableHash };
