import fs from 'node:fs';
import { validateBudget, invariant } from '../src/core.mjs';
import { certificationBundleHash, validateCertificationPolicy, verifyCertifiedBundle } from '../src/certification-engine.mjs';
import { validateContextPolicy } from '../src/context-engine.mjs';
import { validateGatePolicy } from '../src/gate-engine.mjs';
import { validateGraphMemoryState } from '../src/graph-memory.mjs';
import { validateMultiAgentPolicy } from '../src/multi-agent-engine.mjs';
import { validateEvaluatorContract } from '../src/ratchet-engine.mjs';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const config = read('.engineering/pes-v2.json');
const governance = read('delivery/governance.json');
const gates = read('delivery/gates.json');
const certificationPolicy = read('delivery/certification-policy.json');
const multiAgentPolicy = read('delivery/multi-agent-policy.json');
const certifications = read('state/certifications.json');
const executionBenchmarks = read('state/execution-benchmarks.json');
const current = read('delivery/current-slice.json');
const graph = read('state/graph.json');
const ratchetRuns = read('state/ratchet-runs.json');

invariant(config.version === 2, 'PES configuration must be version 2');
invariant(['lite','standard','enterprise'].includes(config.mode), 'Unsupported PES mode');
validateBudget(config.budgets);
validateContextPolicy(config.context);

invariant(config.context.maxTokens <= config.budgets.maxTokens, 'Context token budget cannot exceed run token budget');
invariant(config.ratchet.requireEvaluationBeforeKeep === true, 'PES v2 requires evaluation before keep');
invariant(config.ratchet.revertOnRegression === true, 'PES v2 requires revert on regression');
invariant(Number.isInteger(config.ratchet.maxAttemptsPerRun) && config.ratchet.maxAttemptsPerRun > 0, 'ratchet.maxAttemptsPerRun must be positive');

invariant(config.graph.enabled === true, 'PES v2 graph memory must be enabled');
invariant(config.graph.appendOnly === true, 'PES v2 graph memory must be append-only');
invariant(config.graph.requireWriteProvenance === true, 'PES v2 graph memory requires write provenance');
invariant(config.graph.rejectConflictingIds === true, 'PES v2 graph memory must reject conflicting ids');
invariant(config.graph.immutableSupersession === true, 'PES v2 requires immutable supersession');
validateGraphMemoryState(graph, { requireObjectProvenance: config.graph.requireWriteProvenance });

invariant(config.gates?.enabled === true, 'PES v2 transition gates must be enabled');
invariant(config.gates.policyFile === 'delivery/gates.json', 'PES gate policy file must be delivery/gates.json');
invariant(config.gates.enforceLifecycleOrder === true, 'PES v2 must enforce lifecycle order');
invariant(config.gates.requireBoundedContext === true, 'PES v2 gates require bounded context');
invariant(config.gates.requireLinkedEvidence === true, 'PES v2 gates require linked evidence');
invariant(config.gates.blockStaleContext === true, 'PES v2 gates must block stale context');
validateGatePolicy(gates, governance);

invariant(config.certification?.enabled === true, 'PES v2 exact-SHA certification must be enabled');
invariant(config.certification.policyFile === 'delivery/certification-policy.json', 'Certification policy file must be delivery/certification-policy.json');
invariant(config.certification.storeFile === 'state/certifications.json', 'Certification store file must be state/certifications.json');
invariant(config.certification.exactShaRequired === true, 'Certification must require exact SHA');
invariant(config.certification.candidateHashRequired === true, 'Certification must require candidate hash binding');
invariant(config.certification.humanFinalApprovalRequired === true, 'Certification must require human final approval');
invariant(config.certification.immutableBundles === true, 'Certification bundles must be immutable');
validateCertificationPolicy(certificationPolicy, governance);

invariant(certifications.schemaVersion === 1 && Array.isArray(certifications.records), 'Invalid certification store');
const certificationIds = new Set();
const certifiedSliceShas = new Set();
for (const bundle of certifications.records) {
  invariant(bundle?.status === 'certified', 'Certification store may contain only certified bundles');
  invariant(/^[0-9a-f]{40}$/i.test(bundle.commitSha ?? ''), `Invalid certification SHA: ${bundle.bundleId ?? 'unknown'}`);
  invariant(!certificationIds.has(bundle.bundleId), `Duplicate certification bundle id: ${bundle.bundleId}`);
  certificationIds.add(bundle.bundleId);
  const key = `${bundle.sliceId}:${bundle.commitSha}`;
  invariant(!certifiedSliceShas.has(key), `Duplicate certified slice SHA: ${key}`);
  certifiedSliceShas.add(key);
  invariant(bundle.certifiedHash === certificationBundleHash(bundle), `Certification bundle hash mismatch: ${bundle.bundleId}`);
  const verification = verifyCertifiedBundle(bundle, { graph, governance, policy: certificationPolicy, authority: config.authority });
  invariant(verification.ok, `Stored certification ${bundle.bundleId} failed verification: ${verification.blockers.map(item => item.code).join(', ')}`);
}

invariant(config.multiAgent?.available === true, 'PES v2 measured multi-agent capability must be available for assessment');
invariant(config.multiAgent.defaultEnabled === false, 'Multi-agent execution must not be enabled by default');
invariant(config.multiAgent.activationRequiresBenchmark === true, 'Multi-agent activation must require a measured benchmark');
invariant(config.multiAgent.policyFile === 'delivery/multi-agent-policy.json', 'Multi-agent policy file must be delivery/multi-agent-policy.json');
invariant(config.multiAgent.benchmarkStoreFile === 'state/execution-benchmarks.json', 'Benchmark store file must be state/execution-benchmarks.json');
validateMultiAgentPolicy(multiAgentPolicy, governance);
if (config.mode === 'lite') {
  invariant(config.multiAgent.enabled === false, 'Lite mode must keep multi-agent execution disabled');
  invariant(config.budgets.maxSubAgents === 0, 'Lite mode must not allocate sub-agents');
  invariant(config.budgets.maxConcurrentWorkers === 1, 'Lite mode must remain single-worker');
}

invariant(executionBenchmarks.schemaVersion === 1 && Array.isArray(executionBenchmarks.records), 'Invalid execution benchmark store');
const benchmarkIds = new Set();
for (const record of executionBenchmarks.records) {
  invariant(typeof record.id === 'string' && record.id, 'Benchmark record requires id');
  invariant(!benchmarkIds.has(record.id), `Duplicate benchmark record id: ${record.id}`);
  benchmarkIds.add(record.id);
  invariant(typeof record.planId === 'string' && record.planId, `Benchmark ${record.id} requires planId`);
  invariant(typeof record.planHash === 'string' && record.planHash.length === 64, `Benchmark ${record.id} requires planHash`);
  invariant(typeof record.benchmarkHash === 'string' && record.benchmarkHash.length === 64, `Benchmark ${record.id} requires benchmarkHash`);
  invariant(typeof record.activationReady === 'boolean', `Benchmark ${record.id} requires activationReady`);
}

invariant(ratchetRuns.schemaVersion === 1 && Array.isArray(ratchetRuns.runs), 'Invalid ratchet run store');
for (const run of ratchetRuns.runs) {
  invariant(typeof run.id === 'string' && run.id, 'Stored ratchet run requires id');
  validateEvaluatorContract(run.evaluator);
  validateBudget(run.budget);
  invariant(Array.isArray(run.attempts), `Stored ratchet run ${run.id} requires attempts`);
}

for (const required of ['scope','policy','implementation','certification','release','production-enable']) {
  invariant(governance.approvalTypes.includes(required), `Missing approval type: ${required}`);
}

if (current.activeSlice) {
  invariant(typeof current.activeSlice.id === 'string' && current.activeSlice.id, 'Active slice requires id');
  invariant(typeof current.activeSlice.objectiveId === 'string' && current.activeSlice.objectiveId, 'Active slice requires objectiveId');
  invariant(governance.lifecycle.includes(current.activeSlice.state) || governance.exceptionStates.includes(current.activeSlice.state), `Invalid active slice state: ${current.activeSlice.state}`);
  invariant(governance.riskLevels.includes(current.activeSlice.riskLevel), `Invalid active slice risk: ${current.activeSlice.riskLevel}`);
  invariant(governance.implementationPermissions.includes(current.activeSlice.implementationPermission), `Invalid implementation permission: ${current.activeSlice.implementationPermission}`);
}

console.log(`PES v2 validation passed: graph revision=${graph.revision}, ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.events.length} graph event(s), ${ratchetRuns.runs.length} ratchet run(s), ${certifications.records.length} certification(s), ${executionBenchmarks.records.length} execution benchmark(s), multiAgent=${config.multiAgent.enabled ? 'enabled' : 'disabled'}, mode=${config.mode}`);
