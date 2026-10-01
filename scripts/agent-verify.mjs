import { spawnSync } from 'node:child_process';
import { compactFailureOutput } from '../src/agent-efficiency.mjs';

const continueOnFailure = process.argv.includes('--continue-on-failure');
const checks = [
  { id: 'pes-validate', command: ['npm', ['run', 'pes:validate']] },
  { id: 'root-tests', command: ['npm', ['test']] },
  { id: 'runtime-verify', command: ['npm', ['run', 'runtime:verify']] }
];

const results = [];

for (const check of checks) {
  const [bin, commandArgs] = check.command;
  const started = Date.now();
  const run = spawnSync(bin, commandArgs, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  const success = run.status === 0 && !run.error;
  const item = {
    id: check.id,
    success,
    exitCode: run.status ?? null,
    durationMs: Date.now() - started
  };

  if (!success) {
    item.failure = compactFailureOutput([
      run.error?.message ?? '',
      run.stdout ?? '',
      run.stderr ?? ''
    ].filter(Boolean).join('\n'));
  }

  results.push(item);
  if (!success && !continueOnFailure) break;
}

const success = results.length === checks.length && results.every(result => result.success);
const executed = new Set(results.map(result => result.id));
const output = {
  schemaVersion: 1,
  kind: 'kairo-agent-verification',
  success,
  failFast: !continueOnFailure,
  checks: results,
  skipped: checks.filter(check => !executed.has(check.id)).map(check => check.id)
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exit(success ? 0 : 1);
