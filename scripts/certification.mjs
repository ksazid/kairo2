import fs from 'node:fs';
import {
  buildCertificationCandidate,
  finalizeCertification,
  JsonCertificationStore,
  verifyCertifiedBundle
} from '../src/certification-engine.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeStdout = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const command = process.argv[2];
const config = read('.engineering/pes-v2.json');
const governance = read('delivery/governance.json');
const policy = read(config.certification.policyFile);
const graph = read('state/graph.json');

if (command === 'candidate') {
  const inputPath = process.argv[3];
  if (!inputPath) usage();
  const input = read(inputPath);
  const candidate = buildCertificationCandidate({
    ...input,
    graph,
    governance,
    policy,
    authority: config.authority
  });
  writeStdout(candidate);
} else if (command === 'finalize') {
  const candidatePath = process.argv[3];
  const approvalPath = process.argv[4];
  const currentCommitSha = process.argv[5];
  if (!candidatePath || !approvalPath || !currentCommitSha) usage();
  const candidate = read(candidatePath);
  const approval = read(approvalPath);
  const certified = finalizeCertification(candidate, approval, {
    graph,
    governance,
    policy,
    authority: config.authority,
    currentCommitSha
  });
  writeStdout(certified);
} else if (command === 'verify') {
  const bundlePath = process.argv[3];
  const currentCommitSha = process.argv[4] ?? null;
  if (!bundlePath) usage();
  const bundle = read(bundlePath);
  const result = verifyCertifiedBundle(bundle, {
    graph,
    governance,
    policy,
    authority: config.authority,
    currentCommitSha
  });
  writeStdout(result);
  process.exitCode = result.ok ? 0 : 1;
} else if (command === 'store') {
  const bundlePath = process.argv[3];
  if (!bundlePath) usage();
  const bundle = read(bundlePath);
  const verification = verifyCertifiedBundle(bundle, {
    graph,
    governance,
    policy,
    authority: config.authority
  });
  if (!verification.ok) {
    writeStdout(verification);
    process.exitCode = 1;
  } else {
    const store = new JsonCertificationStore(policy.storeFile);
    store.append(bundle);
    writeStdout({ stored: true, bundleId: bundle.bundleId, commitSha: bundle.commitSha });
  }
} else {
  usage();
}

function usage() {
  console.error('Usage:');
  console.error('  npm run cert -- candidate <input.json>');
  console.error('  npm run cert -- finalize <candidate.json> <approval.json> <current-commit-sha>');
  console.error('  npm run cert -- verify <bundle.json> [current-commit-sha]');
  console.error('  npm run cert -- store <bundle.json>');
  process.exit(2);
}
