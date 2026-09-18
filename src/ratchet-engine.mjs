import { invariant, ratchetDecision, validateBudget, validateRunUsage } from './core.mjs';

const EVALUATOR_TYPES = new Set(['deterministic', 'model', 'human']);
const ATTEMPT_TERMINAL = new Set(['kept', 'reverted', 'recovered-reverted']);

const clone = value => structuredClone(value);
const now = () => new Date().toISOString();

export function validateEvaluatorContract(contract) {
  invariant(contract && typeof contract === 'object', 'Evaluator contract is required');
  invariant(typeof contract.id === 'string' && contract.id, 'Evaluator id is required');
  invariant(EVALUATOR_TYPES.has(contract.type), `Unsupported evaluator type: ${contract.type}`);
  invariant(typeof contract.metric === 'string' && contract.metric, 'Evaluator metric is required');
  invariant(contract.direction === 'higher' || contract.direction === 'lower', 'Evaluator direction must be higher or lower');
  invariant(typeof contract.rubricId === 'string' && contract.rubricId, 'Evaluator rubricId is required');
  invariant(Number.isInteger(contract.minEvidenceItems) && contract.minEvidenceItems >= 0, 'Evaluator minEvidenceItems must be a non-negative integer');
  return true;
}

export function createRatchetRun({ id, objectiveId, baselineScore, evaluator, budget, maxAttempts = 5, startedAt = now() }) {
  invariant(typeof id === 'string' && id, 'Run id is required');
  invariant(typeof objectiveId === 'string' && objectiveId, 'objectiveId is required');
  invariant(Number.isFinite(baselineScore), 'baselineScore must be numeric');
  validateEvaluatorContract(evaluator);
  validateBudget(budget);
  invariant(Number.isInteger(maxAttempts) && maxAttempts > 0, 'maxAttempts must be a positive integer');

  return {
    schemaVersion: 1,
    id,
    objectiveId,
    status: 'running',
    evaluator: clone(evaluator),
    budget: clone(budget),
    usage: {},
    maxAttempts,
    baselineScore,
    currentScore: baselineScore,
    acceptedArtifactId: null,
    acceptedAttemptId: null,
    attempts: [],
    startedAt,
    updatedAt: startedAt,
    stopReason: null
  };
}

export function beginAttempt(run, { id, hypothesis, checkpointBefore, workspaceRef = null, parentAttemptId = null, startedAt = now() }) {
  const next = clone(run);
  invariant(next.status === 'running', `Run ${next.id} is not running`);
  invariant(next.attempts.length < next.maxAttempts, `Run ${next.id} exhausted maxAttempts`);
  invariant(typeof id === 'string' && id, 'Attempt id is required');
  invariant(!next.attempts.some(a => a.id === id), `Duplicate attempt id: ${id}`);
  invariant(typeof hypothesis === 'string' && hypothesis.trim(), 'Attempt hypothesis is required');
  invariant(typeof checkpointBefore === 'string' && checkpointBefore, 'checkpointBefore is required');
  invariant(!next.attempts.some(a => !ATTEMPT_TERMINAL.has(a.status)), 'A prior attempt is still active');

  const inferredParent = parentAttemptId ?? next.attempts.at(-1)?.id ?? null;
  if (inferredParent) invariant(next.attempts.some(a => a.id === inferredParent), `Unknown parent attempt: ${inferredParent}`);

  next.attempts.push({
    id,
    parentAttemptId: inferredParent,
    hypothesis: hypothesis.trim(),
    status: 'running',
    baselineScore: next.currentScore,
    checkpointBefore,
    workspaceRef,
    checkpointAfter: null,
    artifact: null,
    evaluation: null,
    decision: null,
    recovery: null,
    startedAt,
    endedAt: null
  });
  next.updatedAt = startedAt;
  return next;
}

export function attachArtifact(run, attemptId, artifact) {
  const next = clone(run);
  const attempt = getAttempt(next, attemptId);
  invariant(attempt.status === 'running', `Attempt ${attemptId} is not accepting artifacts`);
  invariant(artifact && typeof artifact.id === 'string' && artifact.id, 'Artifact id is required');
  invariant(artifact.version !== undefined && artifact.version !== null, 'Artifact version is required');
  invariant(typeof artifact.path === 'string' && artifact.path, 'Artifact path is required');
  invariant(typeof artifact.digest === 'string' && artifact.digest, 'Artifact digest is required');

  attempt.artifact = {
    ...clone(artifact),
    runId: attemptId,
    status: 'candidate'
  };
  next.updatedAt = now();
  return next;
}

export function evaluateAttempt(run, attemptId, evaluation) {
  const next = clone(run);
  const attempt = getAttempt(next, attemptId);
  validateEvaluatorContract(next.evaluator);
  invariant(attempt.status === 'running', `Attempt ${attemptId} is not ready for evaluation`);
  invariant(evaluation && typeof evaluation.id === 'string' && evaluation.id, 'Evaluation id is required');
  invariant(evaluation.rubricId === next.evaluator.rubricId, `Evaluation rubric must be ${next.evaluator.rubricId}`);

  const evidence = Array.isArray(evaluation.evidence) ? evaluation.evidence : [];
  invariant(evidence.length >= next.evaluator.minEvidenceItems, `Evaluation requires at least ${next.evaluator.minEvidenceItems} evidence item(s)`);

  const crashed = evaluation.crashed === true;
  if (!crashed) invariant(Number.isFinite(evaluation.score), 'Evaluation score must be numeric unless crashed=true');

  const result = ratchetDecision({
    baseline: attempt.baselineScore,
    candidate: evaluation.score,
    direction: next.evaluator.direction,
    crashed
  });

  attempt.evaluation = {
    id: evaluation.id,
    rubricId: evaluation.rubricId,
    metric: next.evaluator.metric,
    score: Number.isFinite(evaluation.score) ? evaluation.score : null,
    crashed,
    evidence: clone(evidence),
    notes: evaluation.notes ?? null,
    evaluatedAt: evaluation.evaluatedAt ?? now(),
    decision: result.decision,
    reason: result.reason
  };
  attempt.decision = result.decision;
  attempt.status = 'evaluated';
  next.updatedAt = attempt.evaluation.evaluatedAt;
  return { run: next, result };
}

export function finalizeAttempt(run, attemptId, { checkpointAfter = null, endedAt = now() } = {}) {
  const next = clone(run);
  const attempt = getAttempt(next, attemptId);
  invariant(attempt.status === 'evaluated', `Attempt ${attemptId} must be evaluated before finalization`);

  if (attempt.decision === 'keep') {
    invariant(attempt.artifact, `Kept attempt ${attemptId} requires an artifact`);
    invariant(typeof checkpointAfter === 'string' && checkpointAfter, `Kept attempt ${attemptId} requires checkpointAfter`);
    attempt.status = 'kept';
    attempt.checkpointAfter = checkpointAfter;
    attempt.artifact.status = 'accepted';
    next.currentScore = attempt.evaluation.score;
    next.acceptedArtifactId = attempt.artifact.id;
    next.acceptedAttemptId = attempt.id;
  } else {
    attempt.status = 'reverted';
    if (attempt.artifact) attempt.artifact.status = 'rejected';
  }

  attempt.endedAt = endedAt;
  next.updatedAt = endedAt;
  if (next.attempts.length >= next.maxAttempts) {
    next.status = 'stopped';
    next.stopReason = 'max-attempts-exhausted';
  }
  return next;
}

export function updateRunUsage(run, usagePatch) {
  const next = clone(run);
  next.usage = { ...next.usage, ...usagePatch };
  const validation = validateRunUsage(next.usage, next.budget);
  if (!validation.ok) {
    next.status = 'stopped';
    next.stopReason = 'budget-exceeded';
    next.budgetExceeded = validation.exceeded;
  }
  next.updatedAt = now();
  return next;
}

export function recoverInterruptedRun(run, workspaceAdapter, { recoveredAt = now() } = {}) {
  const next = clone(run);
  const attempt = [...next.attempts].reverse().find(a => !ATTEMPT_TERMINAL.has(a.status));
  if (!attempt) return next;

  invariant(workspaceAdapter && typeof workspaceAdapter.restore === 'function', 'workspaceAdapter.restore is required');
  workspaceAdapter.restore(attempt.checkpointBefore, attempt.workspaceRef);

  if (attempt.artifact) attempt.artifact.status = 'rejected';
  attempt.status = 'recovered-reverted';
  attempt.decision = 'revert';
  attempt.recovery = {
    restoredCheckpoint: attempt.checkpointBefore,
    reason: 'interrupted-before-safe-finalization',
    recoveredAt
  };
  attempt.endedAt = recoveredAt;
  next.status = 'running';
  next.stopReason = null;
  next.updatedAt = recoveredAt;
  return next;
}

export function toGraphUpdate(run, attemptId) {
  const attempt = getAttempt(run, attemptId);
  invariant(ATTEMPT_TERMINAL.has(attempt.status), `Attempt ${attemptId} must be finalized before graph publication`);

  const nodes = [{
    id: attempt.id,
    type: 'AgentRun',
    status: attempt.status === 'kept' ? 'verified' : 'failed',
    objectiveId: run.objectiveId,
    hypothesis: attempt.hypothesis,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt
  }];
  const edges = [];

  if (attempt.parentAttemptId) {
    const parent = run.attempts.find(item => item.id === attempt.parentAttemptId);
    invariant(parent, `Missing parent attempt ${attempt.parentAttemptId}`);
    nodes.push({
      id: parent.id,
      type: 'AgentRun',
      status: parent.status === 'kept' ? 'verified' : 'failed',
      objectiveId: run.objectiveId,
      hypothesis: parent.hypothesis,
      startedAt: parent.startedAt,
      endedAt: parent.endedAt
    });
    edges.push({ id: `EDGE-${attempt.parentAttemptId}-${attempt.id}`, type: 'PARENT_OF', from: attempt.parentAttemptId, to: attempt.id });
  }
  if (attempt.artifact) {
    nodes.push({
      id: attempt.artifact.id,
      type: 'Artifact',
      status: attempt.artifact.status === 'accepted' ? 'verified' : 'failed',
      runId: attempt.id,
      version: attempt.artifact.version,
      path: attempt.artifact.path,
      digest: attempt.artifact.digest
    });
    edges.push({ id: `EDGE-${attempt.id}-${attempt.artifact.id}`, type: 'PRODUCED', from: attempt.id, to: attempt.artifact.id });
  }
  if (attempt.evaluation) {
    nodes.push({
      id: attempt.evaluation.id,
      type: 'Evaluation',
      status: 'verified',
      rubricId: attempt.evaluation.rubricId,
      metric: attempt.evaluation.metric,
      score: attempt.evaluation.score,
      decision: attempt.decision
    });
    if (attempt.artifact) {
      edges.push({ id: `EDGE-${attempt.evaluation.id}-${attempt.artifact.id}`, type: 'EVALUATES', from: attempt.evaluation.id, to: attempt.artifact.id });
    }
  }
  return { nodes, edges };
}

export function summarizeRun(run) {
  const kept = run.attempts.filter(a => a.status === 'kept').length;
  const reverted = run.attempts.filter(a => a.status === 'reverted' || a.status === 'recovered-reverted').length;
  return {
    id: run.id,
    status: run.status,
    baselineScore: run.baselineScore,
    currentScore: run.currentScore,
    acceptedAttemptId: run.acceptedAttemptId,
    acceptedArtifactId: run.acceptedArtifactId,
    attempts: run.attempts.length,
    kept,
    reverted,
    stopReason: run.stopReason
  };
}

function getAttempt(run, attemptId) {
  const attempt = run.attempts.find(a => a.id === attemptId);
  invariant(attempt, `Unknown attempt: ${attemptId}`);
  return attempt;
}
