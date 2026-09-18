import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, validateGatePolicy } from '../src/gate-engine.mjs';

const governance = {
  approvalTypes: ['scope', 'policy', 'implementation', 'certification', 'release', 'production-enable'],
  approvalStatuses: ['pending', 'approved', 'rejected', 'changes-requested', 'revoked', 'not-required'],
  lifecycle: ['proposed', 'discovery', 'decision-pending', 'approved', 'ready-for-implementation', 'implementing', 'testing', 'certification', 'certified', 'release-pending', 'released', 'observed', 'validated'],
  exceptionStates: ['blocked', 'rejected', 'deferred', 'superseded', 'rolled-back'],
  implementationPermissions: ['specification-only', 'contracts-only', 'runtime-disabled', 'runtime-enabled', 'production-enabled'],
  riskLevels: ['low', 'medium', 'high']
};

const authority = {
  humanApprovalRequired: ['scope', 'policy', 'certification', 'release', 'production-enable'],
  agentMaySelfApprove: false
};

const policy = {
  version: 1,
  requireContextFrom: ['ready-for-implementation', 'implementing', 'testing', 'certification', 'certified', 'release-pending', 'released'],
  requireEvidenceFrom: ['testing', 'certification', 'certified', 'release-pending', 'released'],
  maxEvidenceHops: 3,
  minEvidenceByRisk: { low: 1, medium: 2, high: 3 },
  approvalsByState: {
    'ready-for-implementation': ['scope', 'policy'],
    implementing: ['scope', 'policy'],
    testing: ['scope', 'policy', 'implementation'],
    certification: ['scope', 'policy', 'implementation'],
    certified: ['certification'],
    'release-pending': ['certification'],
    released: ['release', 'production-enable']
  },
  minimumPermissionByState: {
    'ready-for-implementation': 'contracts-only',
    implementing: 'runtime-disabled',
    testing: 'runtime-enabled',
    certification: 'runtime-enabled',
    certified: 'runtime-enabled',
    'release-pending': 'runtime-enabled',
    released: 'production-enabled'
  },
  blockContradictionsFrom: ['certification', 'certified', 'release-pending', 'released'],
  protectedPaths: [
    { pattern: '.engineering/', approval: 'policy', deliveryGraph: true },
    { pattern: 'delivery/governance.json', approval: 'policy', deliveryGraph: true },
    { pattern: 'infra/', approval: 'implementation', deliveryGraph: true }
  ],
  deliveryGraph: {
    triggerRiskLevels: ['high'],
    triggerSignals: ['crossModule', 'securitySensitive'],
    repeatedFailureThreshold: 2,
    requiredFromStates: ['implementing', 'testing', 'certification', 'certified', 'release-pending', 'released']
  }
};

function graph() {
  return {
    schemaVersion: 1,
    version: 2,
    revision: 0,
    nodes: [
      { id: 'OBJ-1', type: 'Objective', status: 'active' },
      { id: 'E-1', type: 'Evidence', status: 'verified' },
      { id: 'E-2', type: 'Evidence', status: 'verified' },
      { id: 'E-3', type: 'Evidence', status: 'verified' },
      { id: 'E-X', type: 'Evidence', status: 'verified' }
    ],
    edges: [
      { id: 'OE1', type: 'ABOUT', from: 'E-1', to: 'OBJ-1' },
      { id: 'OE2', type: 'ABOUT', from: 'E-2', to: 'OBJ-1' },
      { id: 'OE3', type: 'ABOUT', from: 'E-3', to: 'OBJ-1' }
    ],
    events: []
  };
}

function context(overrides = {}) {
  return {
    contextHash: 'ctx-1',
    graphRevision: 0,
    requestedSeeds: ['OBJ-1'],
    resolvedSeeds: ['OBJ-1'],
    contradictions: [],
    ...overrides
  };
}

function approval(type, actorType = 'human', status = 'approved') {
  return { type, actorType, status, scopeId: 'VS-1', recordedAt: '2026-09-01T00:00:00Z' };
}

function slice(overrides = {}) {
  return {
    id: 'VS-1',
    objectiveId: 'OBJ-1',
    state: 'approved',
    riskLevel: 'low',
    implementationPermission: 'contracts-only',
    repeatedFailureCount: 0,
    ...overrides
  };
}

function run(overrides = {}) {
  return evaluateGate({
    slice: slice(overrides.slice),
    requestedState: overrides.requestedState ?? 'ready-for-implementation',
    governance,
    policy,
    graph: graph(),
    context: overrides.context ?? context(),
    approvals: overrides.approvals ?? [approval('scope'), approval('policy')],
    evidenceIds: overrides.evidenceIds ?? [],
    changedPaths: overrides.changedPaths ?? [],
    deliveryGraph: overrides.deliveryGraph ?? null,
    authority
  });
}

test('gate policy validates against PES governance vocabulary', () => {
  assert.equal(validateGatePolicy(policy, governance), true);
});

test('low-risk approved slice can enter ready-for-implementation with valid human approvals and bounded context', () => {
  const result = run();
  assert.equal(result.allowed, true);
  assert.equal(result.deliveryGraph.required, false);
});

test('agent cannot satisfy human policy approval', () => {
  const result = run({ approvals: [approval('scope'), approval('policy', 'agent')] });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some(item => item.code === 'missing-required-approval' && item.details.type === 'policy'));
});

test('protected governance path triggers delivery graph and blocks implementation until graph is ready', () => {
  const result = run({
    slice: { state: 'ready-for-implementation', implementationPermission: 'runtime-disabled' },
    requestedState: 'implementing',
    changedPaths: ['.engineering/pes-v2.json']
  });
  assert.equal(result.deliveryGraph.required, true);
  assert.ok(result.deliveryGraph.reasons.includes('protected-path'));
  assert.ok(result.blockers.some(item => item.code === 'delivery-graph-not-ready'));
});

test('ready delivery graph satisfies high-risk execution trigger but evidence floor still applies at testing', () => {
  const result = run({
    slice: { state: 'implementing', riskLevel: 'high', implementationPermission: 'runtime-enabled' },
    requestedState: 'testing',
    approvals: [approval('scope'), approval('policy'), approval('implementation', 'system')],
    evidenceIds: ['E-1', 'E-2'],
    deliveryGraph: { status: 'ready' }
  });
  assert.equal(result.deliveryGraph.required, true);
  assert.ok(result.blockers.some(item => item.code === 'insufficient-linked-evidence'));
});

test('unlinked graph evidence does not satisfy evidence floor', () => {
  const result = run({
    slice: { state: 'implementing', riskLevel: 'medium', implementationPermission: 'runtime-enabled' },
    requestedState: 'testing',
    approvals: [approval('scope'), approval('policy'), approval('implementation', 'system')],
    evidenceIds: ['E-1', 'E-X']
  });
  assert.equal(result.evidence.accepted.length, 1);
  assert.ok(result.evidence.rejected.some(item => item.id === 'E-X' && item.reason === 'not-linked-to-objective'));
  assert.ok(result.blockers.some(item => item.code === 'insufficient-linked-evidence'));
});

test('certification is blocked when bounded context exposes unresolved contradictions', () => {
  const result = run({
    slice: { state: 'testing', implementationPermission: 'runtime-enabled' },
    requestedState: 'certification',
    approvals: [approval('scope'), approval('policy'), approval('implementation', 'system')],
    evidenceIds: ['E-1'],
    context: context({ contradictions: [{ id: 'C-1', from: 'A', to: 'B' }] })
  });
  assert.ok(result.blockers.some(item => item.code === 'unresolved-context-contradictions'));
});

test('stale context blocks governed transition', () => {
  const result = run({ context: context({ graphRevision: 99 }) });
  assert.ok(result.blockers.some(item => item.code === 'stale-context'));
});

test('lifecycle skipping is blocked even when approvals exist', () => {
  const result = run({
    requestedState: 'testing',
    slice: { implementationPermission: 'runtime-enabled' },
    approvals: [approval('scope'), approval('policy'), approval('implementation', 'system')],
    evidenceIds: ['E-1']
  });
  assert.ok(result.blockers.some(item => item.code === 'invalid-lifecycle-transition'));
});

test('released state requires human release and production-enable approvals plus production permission', () => {
  const result = run({
    slice: { state: 'release-pending', implementationPermission: 'production-enabled' },
    requestedState: 'released',
    approvals: [approval('release'), approval('production-enable')],
    evidenceIds: ['E-1']
  });
  assert.equal(result.allowed, true);
});

test('release is blocked when production enable approval is missing', () => {
  const result = run({
    slice: { state: 'release-pending', implementationPermission: 'production-enabled' },
    requestedState: 'released',
    approvals: [approval('release')],
    evidenceIds: ['E-1']
  });
  assert.ok(result.blockers.some(item => item.code === 'missing-required-approval' && item.details.type === 'production-enable'));
});
