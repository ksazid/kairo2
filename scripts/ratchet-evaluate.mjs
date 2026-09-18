import { ratchetDecision } from '../src/core.mjs';

const [baselineRaw, candidateRaw, direction = 'higher'] = process.argv.slice(2);
const baseline = Number(baselineRaw);
const candidate = Number(candidateRaw);

if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) {
  console.error('Usage: npm run ratchet:evaluate -- <baseline> <candidate> [higher|lower]');
  process.exit(2);
}

const result = ratchetDecision({ baseline, candidate, direction });
process.stdout.write(JSON.stringify({ baseline, candidate, direction, ...result }, null, 2) + '\n');
process.exitCode = result.decision === 'keep' ? 0 : 3;
