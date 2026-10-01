import fs from 'node:fs';
import { buildAgentBrief } from '../src/agent-efficiency.mjs';

const graph = JSON.parse(fs.readFileSync('state/graph.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('.engineering/pes-v2.json', 'utf8'));
const args = process.argv.slice(2);

let objective = null;
let priorHash = null;
const seeds = [];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--objective') {
    objective = args[i + 1] ?? null;
    i += 1;
  } else if (args[i] === '--prior-hash') {
    priorHash = args[i + 1] ?? null;
    i += 1;
  } else {
    seeds.push(args[i]);
  }
}

if (!seeds.length) {
  console.error('Usage: npm run agent:brief -- <NODE-ID> [NODE-ID...] [--objective "task"] [--prior-hash <HASH>]');
  process.exit(2);
}

const result = buildAgentBrief(graph, seeds, config.context, { objective, priorHash });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
