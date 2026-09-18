import fs from 'node:fs';
import { assessMultiAgentExecution, JsonExecutionBenchmarkStore } from '../src/multi-agent-engine.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const command = process.argv[2];
const planPath = process.argv[3];
const benchmarkPath = process.argv[4];

if (!['assess', 'record'].includes(command) || !planPath || !benchmarkPath) usage();

const config = read('.engineering/pes-v2.json');
const governance = read('delivery/governance.json');
const policy = read(config.multiAgent.policyFile);
const graph = read('state/graph.json');
const plan = read(planPath);
const benchmark = read(benchmarkPath);

const result = assessMultiAgentExecution({
  plan,
  benchmark,
  policy,
  governance,
  config: config.multiAgent,
  budget: config.budgets,
  graph
});

if (command === 'record') {
  const id = process.argv[5];
  if (!id) usage();
  const store = new JsonExecutionBenchmarkStore(config.multiAgent.benchmarkStoreFile);
  store.append({
    id,
    planId: plan.id,
    objectiveId: plan.objectiveId,
    planHash: result.planHash,
    benchmarkHash: result.benchmark?.benchmarkHash ?? null,
    eligible: result.eligible,
    activationReady: result.activationReady,
    authorized: result.authorized,
    benchmark: result.benchmark,
    recordedAt: new Date().toISOString()
  });
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.activationReady ? 0 : 1;

function usage() {
  console.error('Usage:');
  console.error('  npm run multi-agent -- assess <plan.json> <benchmark.json>');
  console.error('  npm run multi-agent -- record <plan.json> <benchmark.json> <benchmark-id>');
  process.exit(2);
}
