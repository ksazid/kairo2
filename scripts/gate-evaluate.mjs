import fs from 'node:fs';
import { evaluateGate } from '../src/gate-engine.mjs';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const requestedState = process.argv[2];
const inputPath = process.argv[3] ?? null;

if (!requestedState) {
  console.error('Usage: npm run gate:evaluate -- <requested-state> [gate-input.json]');
  process.exit(2);
}

const config = read('.engineering/pes-v2.json');
const governance = read('delivery/governance.json');
const policy = read(config.gates.policyFile);
const graph = read('state/graph.json');

let input;
if (inputPath) {
  input = read(inputPath);
} else {
  const current = read('delivery/current-slice.json');
  if (!current.activeSlice) {
    console.error('No active slice. Supply a gate input JSON file.');
    process.exit(2);
  }
  input = { slice: current.activeSlice };
}

const result = evaluateGate({
  slice: input.slice,
  requestedState,
  governance,
  policy,
  graph,
  context: input.context ?? null,
  approvals: input.approvals ?? [],
  evidenceIds: input.evidenceIds ?? [],
  changedPaths: input.changedPaths ?? [],
  deliveryGraph: input.deliveryGraph ?? null,
  authority: config.authority
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.allowed ? 0 : 1;
