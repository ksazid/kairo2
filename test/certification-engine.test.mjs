import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCertificationCandidate,
  certificationBundleHash,
  finalizeCertification,
  JsonCertificationStore,
  validateCertificationPolicy,
  verifyCertificationCandidate,
  verifyCertifiedBundle
} from '../src/certification-engine.mjs';
import { appendGraphUpdate } from '../src/graph-memory.mjs';

const governance = {
  approvalTypes: ['scope', 'policy', 'implementation', 'certification', 'release', 'production-enable'],
  riskLevels: ['low', 'medium', 'high']
};

const authority = {
  humanApprovalRequired: ['scope', 'policy', 'certification', 'release', 'production-enable'],
  agentMaySelfApprove: false
};

const policy = {
  version: 1,
  requiredPreCertificationApprovals: ['scope', 'policy', 'implementation'],
  finalApprovalType: 'certification',
  minimumArtifacts: 1,
  minimumEvaluations: 1,
  minimumEvidenceByRisk: { low: 1, medium: 2, high: 3 },
  acceptedGraphStatuses: ['verified', 'approved', 'active'],
  maxTraceHops: 4,
  blockUnresolvedRiskLevels: ['high', 'critical'],
  requireCurrentGraphRevision: true,
  requireContextHash: true,
  requireNoContextContradictions: true,
  requireAllowedCertificationGate: true,
  requireHumanFinalApproval: true,
  storeFile: 'state/certifications.json'
};

const commitSha = 'a'.repeat(40);

function graph() {
  return {
    schemaVersion: 1,
    version: 2,
    revision: 0,
    nodes: [
      { id: 'OBJ-1', type: 'Objective', status: 'active' },
      { id: 'ART-1', type: 'Artifact', status: 'verified', runId: 'RUN-1', version: 1 },
      { id: 'EV-1', type: 'Evaluation', status: 'verified', rubricId: 'RUBRIC-1' },
      { id: 'E-1', type: 'Evidence', status: 'verified' },
      { id: 'E-2', type: 'Evidence', status: 'verified' },
      { id: 'E-3', type: 'Evidence', status: 'verified' },
      { id: 'ART-X', type: 'Artifact', status: 'verified', runId: 'RUN-X', version: 1 }
    ],
    edges: [
      { id: 'OA', type: 'ABOUT', from: 'ART-1', to: 'OBJ-1' },
      { id: 'OV', type: 'ABOUT', from: 'EV-1', to: 'OBJ-1' },
      { id: 'OE1', type: 'ABOUT', from: 'E-1', to: 'OBJ-1' },
      { id: 'OE2', type: 'ABOUT', from: 'E-2', to: 'OBJ-1' },
      { id: 'OE3', type: 'ABOUT', from: 'E-3', to: 'OBJ-1' }
    ],
    events: []
  };
}

function context(overrides = {}) {
  return {
    contextHash: 'ctx-cert-1',
    graphRevision: 0,
    requestedSeeds: ['OBJ-1'],
    resolvedSeeds: ['OBJ-1'],
    contradictions: [],
    ...overrides
  };
}

function gateResult(overrides = {}) {
  return {
    allowed: true,
    sliceId: 'VS-1',
    fromState: 'testing',
    requestedState: 'certification',
    blockers: [],
    warnings: [],
    ...overrides
  };
}

function approval(type, actorType = 'human') {
  return { type, actorType, status: 'approved', scopeId: 'VS-1', recordedAt: '2026-09-01T00:00:00Z' };
}

function baseInput(overrides = {}) {
  return {
    bundleId: 'CERT-VS-1-A',
    slice: { id: 'VS-1', objectiveId: 'OBJ-1', riskLevel: 'low' },
    commitSha,
    graph: graph(),
    context: context(),
    gateResult: gateResult(),
    approvals: [approval('scope'), approval('policy'), approval('implementation', 'system')],
    artifactIds: ['ART-1'],
    evidenceIds: ['E-1'],
    evaluationIds: ['EV-1'],
    unresolvedRisks: [],
    governance,
    policy,
    authority,
    createdAt: '2026-09-01T00:01:00Z',
    ...overrides
  };
}

function certify(currentGraph = graph()) {
  const candidate = buildCertificationCandidate(baseInput({ graph: currentGraph }));
  const finalApproval = {
    type: 'certification', status: 'approved', actorType: 'human', scopeId: 'VS-1',
    commitSha, candidateHash: candidate.candidateHash, approvedAt: '2026-09-01T00:02:00Z'
  };
  return finalizeCertification(candidate, finalApproval, {
    graph: currentGraph,
    governance,
    policy,
    authority,
    currentCommitSha: commitSha,
    certifiedAt: '2026-09-01T00:03:00Z'
  });
}

test('certification policy validates against governance vocabulary', () => {
  assert.equal(validateCertificationPolicy(policy, governance), true);
});

test('candidate creation rejects non-exact commit identifiers', () => {
  assert.throws(() => buildCertificationCandidate(baseInput({ commitSha: 'main' })), /exact 40-character commit SHA/);
});

test('builds deterministic candidate tied to exact SHA, context, gate and graph trace', () => {
  const candidate = buildCertificationCandidate(baseInput());
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.commitSha, commitSha);
  assert.equal(candidate.contextHash, 'ctx-cert-1');
  assert.equal(candidate.contextSnapshot.contextHash, 'ctx-cert-1');
  assert.equal(candidate.gateSnapshot.requestedState, 'certification');
  assert.equal(candidate.trace.length, 3);
  assert.ok(candidate.trace.every(item => item.nodeHash?.length === 64));
  assert.equal(candidate.candidateHash.length, 64);
});

test('candidate verification fails when exact SHA changes', () => {
  const candidate = buildCertificationCandidate(baseInput());
  const result = verifyCertificationCandidate(candidate, {
    graph: graph(), context: context(), gateResult: gateResult(), governance, policy, authority,
    currentCommitSha: 'b'.repeat(40)
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some(item => item.code === 'sha-mismatch'));
});

test('high-risk certification enforces larger linked evidence floor', () => {
  assert.throws(() => buildCertificationCandidate(baseInput({
    slice: { id: 'VS-1', objectiveId: 'OBJ-1', riskLevel: 'high' },
    evidenceIds: ['E-1', 'E-2']
  })), /insufficient-certification-evidence/);
});

test('unlinked artifact cannot enter certification trace', () => {
  assert.throws(() => buildCertificationCandidate(baseInput({ artifactIds: ['ART-X'] })), /insufficient-artifacts/);
});

test('stale or contradictory context blocks candidate creation', () => {
  assert.throws(() => buildCertificationCandidate(baseInput({ context: context({ graphRevision: 9 }) })), /stale-context/);
  assert.throws(() => buildCertificationCandidate(baseInput({ context: context({ contradictions: [{ id: 'C-1' }] }) })), /unresolved-context-contradictions/);
});

test('blocking unresolved risk prevents certification', () => {
  assert.throws(() => buildCertificationCandidate(baseInput({ unresolvedRisks: [{ id: 'R-1', level: 'high', summary: 'Known regression' }] })), /blocking-unresolved-risk/);
});

test('final certification approval must be human and bind exact SHA plus candidate hash', () => {
  const candidate = buildCertificationCandidate(baseInput());
  const bad = {
    type: 'certification', status: 'approved', actorType: 'agent', scopeId: 'VS-1',
    commitSha, candidateHash: candidate.candidateHash, approvedAt: '2026-09-01T00:02:00Z'
  };
  assert.throws(() => finalizeCertification(candidate, bad, {
    graph: graph(), context: context(), gateResult: gateResult(), governance, policy, authority, currentCommitSha: commitSha
  }), /must be human/);

  const good = { ...bad, actorType: 'human' };
  const certified = finalizeCertification(candidate, good, {
    graph: graph(), context: context(), gateResult: gateResult(), governance, policy, authority,
    currentCommitSha: commitSha, certifiedAt: '2026-09-01T00:03:00Z'
  });
  assert.equal(certified.status, 'certified');
  assert.equal(certified.certifiedHash, certificationBundleHash(certified));
});

test('certified bundle verification detects tampering', () => {
  const certified = certify();
  const tampered = { ...certified, unresolvedRisks: [{ id: 'R', level: 'high' }] };
  const result = verifyCertifiedBundle(tampered, {
    graph: graph(), governance, policy, authority, currentCommitSha: commitSha
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some(item => item.code === 'certified-hash-mismatch' || item.code === 'blocking-unresolved-risk'));
});

test('certified bundle remains verifiable after unrelated append-only graph revisions', () => {
  const originalGraph = graph();
  const certified = certify(originalGraph);
  const laterGraph = appendGraphUpdate(originalGraph, {
    nodes: [{ id: 'DEC-LATER', type: 'Decision', status: 'verified', title: 'Later unrelated decision' }],
    edges: []
  }, {
    actorId: 'test',
    reason: 'append unrelated state after certification',
    eventId: 'GM-000001',
    recordedAt: '2026-09-01T01:00:00Z'
  }).state;
  const result = verifyCertifiedBundle(certified, { graph: laterGraph, governance, policy, authority });
  assert.equal(result.ok, true);
});

test('certification store is append-only and rejects duplicate bundle identity', () => {
  const certified = certify();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pes-cert-store-'));
  const store = new JsonCertificationStore(path.join(dir, 'certifications.json'));
  store.append(certified);
  assert.equal(store.findByCommit(commitSha).length, 1);
  assert.throws(() => store.append(certified), /Duplicate certification bundle id/);
});
