import {
  attachArtifact,
  beginAttempt,
  createRatchetRun,
  evaluateAttempt,
  finalizeAttempt,
  summarizeRun
} from '../src/ratchet-engine.mjs';

const budget = {
  maxModelCalls: 8, maxSubAgents: 0, maxConcurrentWorkers: 1, maxToolCalls: 40,
  maxTokens: 120000, maxFinancialCost: 10, maxWallClockMinutes: 45, maxRetries: 2,
  maxGraphWrites: 100, minEvidenceItems: 1
};

const evaluator = {
  id: 'EVAL-quality-v1',
  type: 'deterministic',
  metric: 'quality',
  direction: 'higher',
  rubricId: 'RUBRIC-quality-v1',
  minEvidenceItems: 1
};

let run = createRatchetRun({ id: 'RUN-fixture', objectiveId: 'OBJ-fixture', baselineScore: 0.60, evaluator, budget, maxAttempts: 4 });

const candidates = [
  { id: 'ATT-01', score: 0.55, digest: 'sha256:bad' },
  { id: 'ATT-02', score: 0.72, digest: 'sha256:good' },
  { id: 'ATT-03', score: 0.70, digest: 'sha256:regression' }
];

for (const candidate of candidates) {
  run = beginAttempt(run, { id: candidate.id, hypothesis: `Try candidate score ${candidate.score}`, checkpointBefore: `checkpoint-${candidate.id}` });
  run = attachArtifact(run, candidate.id, { id: `ART-${candidate.id}`, version: 1, path: `fixture/${candidate.id}.txt`, digest: candidate.digest });
  const evaluated = evaluateAttempt(run, candidate.id, {
    id: `EV-${candidate.id}`,
    rubricId: evaluator.rubricId,
    score: candidate.score,
    evidence: [{ type: 'fixture-score', value: candidate.score }]
  });
  run = finalizeAttempt(evaluated.run, candidate.id, { checkpointAfter: evaluated.result.decision === 'keep' ? `accepted-${candidate.id}` : null });
}

process.stdout.write(`${JSON.stringify({ summary: summarizeRun(run), attempts: run.attempts }, null, 2)}\n`);
