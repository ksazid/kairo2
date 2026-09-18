import fs from 'node:fs';
import { buildRankedContext, serializeContext } from '../src/context-engine.mjs';

const graph = JSON.parse(fs.readFileSync('state/graph.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('.engineering/pes-v2.json', 'utf8'));
const args = process.argv.slice(2);

let priorHash = null;
const seeds = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--prior-hash') {
    priorHash = args[i + 1] ?? null;
    i += 1;
  } else {
    seeds.push(args[i]);
  }
}

if (!seeds.length) {
  console.error('Usage: npm run context:build -- <NODE-ID> [NODE-ID...] [--prior-hash <HASH>]');
  process.exit(2);
}

const result = buildRankedContext(graph, seeds, config.context);
const output = {
  ...result,
  unchanged: priorHash ? result.unchangedFrom(priorHash) : null
};
delete output.unchangedFrom;
process.stdout.write(`${serializeContext(output, { pretty: true })}\n`);
