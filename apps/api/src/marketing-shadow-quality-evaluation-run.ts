import type { Pool } from "pg";
import type { AgentRuntimePort } from "@kairo/agent-contracts";
import type { MarketingCreativePlan } from "@kairo/domain/creative-formats";
import type { MarketingShadowEvidenceRun } from "@kairo/worker/marketing-shadow-evidence-runner";
import {
  evaluateMarketingShadowPair,
  type MarketingShadowPairQualityEvaluation,
} from "@kairo/worker/marketing-shadow-quality-evaluator";
import {
  toMotorcycleCarouselQualificationCase,
  type MotorcycleCarouselFixture,
} from "@kairo/worker/marketing-shadow-qualification";
import { marketingShadowInputFingerprint } from "@kairo/worker/marketing-shadow";
import benchmarkData from "../../../evaluation/marketing-lab/benchmark-cases.json";
import { safeFailureKind } from "./marketing-shadow-evidence-run";

export const MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID = "vs65-quality-evaluation-20260820-b";
export const MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID = "vs23-qualification-20260820-d";
export const MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA = "5492f8ffc9273317ddd4e6b3e8f4a30f4a8df5e2";
export const MARKETING_SHADOW_QUALITY_INTER_PAIR_DELAY_MS = 65_000;

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CASE_IDS = new Set([
  "motorcycle-carousel-01",
  "motorcycle-carousel-02",
  "motorcycle-carousel-03",
  "motorcycle-carousel-04",
]);

export interface MarketingShadowQualityEvaluationRequest {
  runId: string;
  releaseSha: string;
}

export type MarketingShadowQualityEvaluationRunStatus = "started" | "completed" | "failed";
export type MarketingShadowQualityEvaluationAttemptStatus =
  | "authorized"
  | MarketingShadowQualityEvaluationRunStatus
  | "not-authorized";

export interface MarketingShadowQualityEvaluationClaim {
  claimed: boolean;
  status: MarketingShadowQualityEvaluationAttemptStatus;
}

export interface MarketingShadowQualityEvaluationEvidencePair {
  caseId: string;
  inputFingerprint: string;
  candidateA: MarketingShadowPairQualityEvaluation["candidateA"];
  candidateB: MarketingShadowPairQualityEvaluation["candidateB"];
  provenance: MarketingShadowPairQualityEvaluation["provenance"];
}

export interface MarketingShadowQualityEvaluationEvidence {
  schemaVersion: 1;
  evidenceKind: "vs65-marketing-quality-evaluation";
  sourceRunId: typeof MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID;
  sourceReleaseSha: typeof MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA;
  evaluatorReleaseSha: string;
  datasetId: "marketing-lab-cross-sector-synthetic-fixtures";
  candidateMapping: {
    candidateA: { id: "kairo-native-carousel"; version: "1" };
    candidateB: { id: "corey-social-shadow"; version: "2.2.0+7868cb9" };
  };
  pairs: MarketingShadowQualityEvaluationEvidencePair[];
}

export interface MarketingShadowQualityEvaluationRunStore {
  status(runId: string, releaseSha: string): Promise<MarketingShadowQualityEvaluationAttemptStatus>;
  claim(runId: string, releaseSha: string): Promise<MarketingShadowQualityEvaluationClaim>;
  complete(runId: string, evidence: MarketingShadowQualityEvaluationEvidence): Promise<void>;
  fail(runId: string, failureKind: string): Promise<void>;
}

export class PgMarketingShadowQualityEvaluationRunStore implements MarketingShadowQualityEvaluationRunStore {
  constructor(private readonly pool: Pool) {}

  async status(runId: string, releaseSha: string): Promise<MarketingShadowQualityEvaluationAttemptStatus> {
    const existing = await this.pool.query<{ release_sha: string; status: MarketingShadowQualityEvaluationRunStatus }>(
      "select release_sha,status from marketing_shadow_evidence_runs where run_id=$1",
      [runId],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (prior.release_sha !== releaseSha) throw new Error("Marketing quality evaluation run ID is already bound to a different release SHA");
      return prior.status;
    }

    const authorization = await this.pool.query<{ release_sha: string }>(
      "select release_sha from marketing_shadow_evidence_authorizations where run_id=$1",
      [runId],
    );
    const approved = authorization.rows[0];
    if (!approved) return "not-authorized";
    if (approved.release_sha !== releaseSha) throw new Error("Marketing quality evaluation authorization is bound to a different release SHA");
    return "authorized";
  }

  async claim(runId: string, releaseSha: string): Promise<MarketingShadowQualityEvaluationClaim> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<{ release_sha: string; status: MarketingShadowQualityEvaluationRunStatus }>(
        "select release_sha,status from marketing_shadow_evidence_runs where run_id=$1",
        [runId],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.release_sha !== releaseSha) throw new Error("Marketing quality evaluation run ID is already bound to a different release SHA");
        await client.query("commit");
        return { claimed: false, status: prior.status };
      }

      const consumed = await client.query(
        "delete from marketing_shadow_evidence_authorizations where run_id=$1 and release_sha=$2 returning run_id",
        [runId, releaseSha],
      );
      if (consumed.rowCount !== 1) {
        const outstanding = await client.query<{ release_sha: string }>(
          "select release_sha from marketing_shadow_evidence_authorizations where run_id=$1",
          [runId],
        );
        if (outstanding.rows[0] && outstanding.rows[0].release_sha !== releaseSha) {
          throw new Error("Marketing quality evaluation authorization is bound to a different release SHA");
        }
        const raced = await client.query<{ release_sha: string; status: MarketingShadowQualityEvaluationRunStatus }>(
          "select release_sha,status from marketing_shadow_evidence_runs where run_id=$1",
          [runId],
        );
        const racedPrior = raced.rows[0];
        if (racedPrior && racedPrior.release_sha !== releaseSha) {
          throw new Error("Marketing quality evaluation run ID is already bound to a different release SHA");
        }
        await client.query("commit");
        return { claimed: false, status: racedPrior?.status ?? "not-authorized" };
      }

      await client.query(
        "insert into marketing_shadow_evidence_runs(run_id,release_sha,status) values($1,$2,'started')",
        [runId, releaseSha],
      );
      await client.query("commit");
      return { claimed: true, status: "started" };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(runId: string, evidence: MarketingShadowQualityEvaluationEvidence): Promise<void> {
    const result = await this.pool.query(
      "update marketing_shadow_evidence_runs set status='completed',evidence=$2::jsonb,failure_kind=null,finished_at=now() where run_id=$1 and status='started'",
      [runId, JSON.stringify(evidence)],
    );
    if (result.rowCount === 1) return;
    const prior = await this.pool.query<{ status: MarketingShadowQualityEvaluationRunStatus }>(
      "select status from marketing_shadow_evidence_runs where run_id=$1",
      [runId],
    );
    if (prior.rows[0]?.status === "completed") return;
    throw new Error("Marketing quality evaluation run is not in a completable state");
  }

  async fail(runId: string, failureKind: string): Promise<void> {
    const result = await this.pool.query(
      "update marketing_shadow_evidence_runs set status='failed',evidence=null,failure_kind=$2,finished_at=now() where run_id=$1 and status='started'",
      [runId, failureKind],
    );
    if (result.rowCount === 1) return;
    const prior = await this.pool.query<{ status: MarketingShadowQualityEvaluationRunStatus }>(
      "select status from marketing_shadow_evidence_runs where run_id=$1",
      [runId],
    );
    if (prior.rows[0]?.status === "failed") return;
    throw new Error("Marketing quality evaluation run is not in a failable state");
  }
}

export function marketingShadowQualityEvaluationRequestFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MarketingShadowQualityEvaluationRequest | null {
  if (env.KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN?.trim() !== "1") return null;
  const runId = env.KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID?.trim() ?? "";
  const releaseSha = env.KAIRO_RELEASE_SHA?.trim() ?? "";
  if (runId !== MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID) {
    throw new Error("KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID is not the approved one-shot VS-65 run ID");
  }
  if (!RELEASE_SHA_PATTERN.test(releaseSha)) {
    throw new Error("KAIRO_RELEASE_SHA must be an exact lowercase 40-character commit SHA for quality evaluation");
  }
  if (env.RENDER?.trim() === "true") {
    const deployedSha = env.RENDER_GIT_COMMIT?.trim() ?? "";
    if (!RELEASE_SHA_PATTERN.test(deployedSha)) {
      throw new Error("RENDER_GIT_COMMIT must identify the exact deployed commit before quality evaluation can run");
    }
    if (deployedSha !== releaseSha) throw new Error("KAIRO_RELEASE_SHA does not match the actual Render deployed commit");
  }
  return { runId, releaseSha };
}

export type MarketingShadowQualityEvaluationAttemptResult =
  | { kind: "completed"; evidence: MarketingShadowQualityEvaluationEvidence }
  | { kind: "skipped"; priorStatus: Exclude<MarketingShadowQualityEvaluationAttemptStatus, "authorized"> };

export async function executeMarketingShadowQualityEvaluationAttempt(
  store: MarketingShadowQualityEvaluationRunStore,
  pool: Pool,
  runtime: AgentRuntimePort,
  request: MarketingShadowQualityEvaluationRequest,
  run: typeof runMarketingShadowQualityEvaluation = runMarketingShadowQualityEvaluation,
): Promise<MarketingShadowQualityEvaluationAttemptResult> {
  const initialStatus = await store.status(request.runId, request.releaseSha);
  if (initialStatus !== "authorized") return { kind: "skipped", priorStatus: initialStatus };

  const claim = await store.claim(request.runId, request.releaseSha);
  if (!claim.claimed) {
    return { kind: "skipped", priorStatus: claim.status === "authorized" ? "not-authorized" : claim.status };
  }

  let evidence: MarketingShadowQualityEvaluationEvidence;
  try {
    evidence = await run(pool, runtime, request.releaseSha);
  } catch (error) {
    await retryPersistence(() => store.fail(request.runId, safeFailureKind(error))).catch(() => undefined);
    throw error;
  }
  await retryPersistence(() => store.complete(request.runId, evidence));
  return { kind: "completed", evidence };
}

export async function runMarketingShadowQualityEvaluation(
  pool: Pool,
  runtime: AgentRuntimePort,
  evaluatorReleaseSha: string,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<MarketingShadowQualityEvaluationEvidence> {
  if (!RELEASE_SHA_PATTERN.test(evaluatorReleaseSha)) throw new Error("Evaluator release SHA is invalid");
  const source = await loadSourceEvidence(pool);
  const fixtures = benchmarkData.cases
    .filter((candidate) => CASE_IDS.has(candidate.id))
    .map((candidate) => candidate as MotorcycleCarouselFixture);
  if (fixtures.length !== 4) throw new Error("Exactly four approved motorcycle carousel fixtures are required for quality evaluation");
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  if (source.pairs.length !== 4) throw new Error("Approved source evidence must contain exactly four pairs");

  const seen = new Set<string>();
  const pairs: MarketingShadowQualityEvaluationEvidencePair[] = [];
  for (let index = 0; index < source.pairs.length; index += 1) {
    const pair = source.pairs[index]!;
    if (!CASE_IDS.has(pair.caseId) || seen.has(pair.caseId)) throw new Error("Approved source evidence contains an unexpected or duplicate case");
    seen.add(pair.caseId);
    const fixture = fixtureById.get(pair.caseId);
    if (!fixture) throw new Error(`Approved fixture is missing for ${pair.caseId}`);
    const benchmarkCase = toMotorcycleCarouselQualificationCase(fixture);
    const expectedFingerprint = marketingShadowInputFingerprint(benchmarkCase);
    if (pair.inputFingerprint !== expectedFingerprint) throw new Error(`Approved source input fingerprint mismatch for ${pair.caseId}`);
    if (index > 0) await pause(MARKETING_SHADOW_QUALITY_INTER_PAIR_DELAY_MS);
    const evaluation = await evaluateMarketingShadowPair(runtime, {
      benchmarkCase,
      candidateA: pair.native.output as MarketingCreativePlan,
      candidateB: pair.corey.output as MarketingCreativePlan,
    });
    if (evaluation.inputFingerprint !== pair.inputFingerprint) throw new Error(`Evaluator input fingerprint mismatch for ${pair.caseId}`);
    pairs.push({
      caseId: pair.caseId,
      inputFingerprint: pair.inputFingerprint,
      candidateA: evaluation.candidateA,
      candidateB: evaluation.candidateB,
      provenance: evaluation.provenance,
    });
  }

  return {
    schemaVersion: 1,
    evidenceKind: "vs65-marketing-quality-evaluation",
    sourceRunId: MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID,
    sourceReleaseSha: MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA,
    evaluatorReleaseSha,
    datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
    candidateMapping: {
      candidateA: { id: "kairo-native-carousel", version: "1" },
      candidateB: { id: "corey-social-shadow", version: "2.2.0+7868cb9" },
    },
    pairs,
  };
}

async function loadSourceEvidence(pool: Pool): Promise<MarketingShadowEvidenceRun> {
  const result = await pool.query<{
    release_sha: string;
    status: string;
    evidence: MarketingShadowEvidenceRun | null;
    failure_kind: string | null;
  }>(
    "select release_sha,status,evidence,failure_kind from marketing_shadow_evidence_runs where run_id=$1",
    [MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Approved source evidence was not found");
  if (row.release_sha !== MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA) throw new Error("Approved source evidence is bound to an unexpected release SHA");
  if (row.status !== "completed" || row.failure_kind) throw new Error("Approved source evidence is not in a completed clean state");
  const evidence = row.evidence;
  if (!evidence || evidence.schemaVersion !== 1 || evidence.evidenceKind !== "vs23-shadow-qualification-paired-execution") {
    throw new Error("Approved source evidence has an unexpected schema or evidence kind");
  }
  if (evidence.datasetId !== "marketing-lab-cross-sector-synthetic-fixtures") throw new Error("Approved source evidence dataset is not approved");
  return evidence;
}

async function retryPersistence(operation: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError;
}
