import type { Pool } from "pg";
import type { MarketingShadowEvidenceRun } from "@kairo/worker/marketing-shadow-evidence-runner";
import { runMarketingShadowPairedEvidence } from "@kairo/worker/marketing-shadow-evidence-runner";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const FAILURE_KIND_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

export interface MarketingShadowEvidenceRequest {
  runId: string;
  releaseSha: string;
}

export type MarketingShadowEvidenceRunStatus = "started" | "completed" | "failed";
export type MarketingShadowEvidenceAttemptStatus =
  | "authorized"
  | MarketingShadowEvidenceRunStatus
  | "not-authorized";

export interface MarketingShadowEvidenceClaim {
  claimed: boolean;
  status: MarketingShadowEvidenceAttemptStatus;
}

export interface MarketingShadowEvidenceRunStore {
  status(runId: string, releaseSha: string): Promise<MarketingShadowEvidenceAttemptStatus>;
  claim(runId: string, releaseSha: string): Promise<MarketingShadowEvidenceClaim>;
  complete(runId: string, evidence: MarketingShadowEvidenceRun): Promise<void>;
  fail(runId: string, failureKind: string): Promise<void>;
}

export class PgMarketingShadowEvidenceRunStore implements MarketingShadowEvidenceRunStore {
  constructor(private readonly pool: Pool) {}

  async status(runId: string, releaseSha: string): Promise<MarketingShadowEvidenceAttemptStatus> {
    const existing = await this.pool.query<{ release_sha: string; status: MarketingShadowEvidenceRunStatus }>(
      `select release_sha,status from marketing_shadow_evidence_runs where run_id=$1`,
      [runId],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (prior.release_sha !== releaseSha) {
        throw new Error("Marketing shadow evidence run ID is already bound to a different release SHA");
      }
      return prior.status;
    }

    const authorization = await this.pool.query<{ release_sha: string }>(
      `select release_sha from marketing_shadow_evidence_authorizations where run_id=$1`,
      [runId],
    );
    const approved = authorization.rows[0];
    if (!approved) return "not-authorized";
    if (approved.release_sha !== releaseSha) {
      throw new Error("Marketing shadow evidence authorization is bound to a different release SHA");
    }
    return "authorized";
  }

  async claim(runId: string, releaseSha: string): Promise<MarketingShadowEvidenceClaim> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const existing = await client.query<{ release_sha: string; status: MarketingShadowEvidenceRunStatus }>(
        `select release_sha,status from marketing_shadow_evidence_runs where run_id=$1`,
        [runId],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.release_sha !== releaseSha) {
          throw new Error("Marketing shadow evidence run ID is already bound to a different release SHA");
        }
        await client.query("commit");
        return { claimed: false, status: prior.status };
      }

      const consumed = await client.query(
        `delete from marketing_shadow_evidence_authorizations
         where run_id=$1 and release_sha=$2
         returning run_id`,
        [runId, releaseSha],
      );
      if (consumed.rowCount !== 1) {
        const authorization = await client.query<{ release_sha: string }>(
          `select release_sha from marketing_shadow_evidence_authorizations where run_id=$1`,
          [runId],
        );
        if (authorization.rows[0] && authorization.rows[0].release_sha !== releaseSha) {
          throw new Error("Marketing shadow evidence authorization is bound to a different release SHA");
        }

        const raced = await client.query<{ release_sha: string; status: MarketingShadowEvidenceRunStatus }>(
          `select release_sha,status from marketing_shadow_evidence_runs where run_id=$1`,
          [runId],
        );
        const racedPrior = raced.rows[0];
        if (racedPrior && racedPrior.release_sha !== releaseSha) {
          throw new Error("Marketing shadow evidence run ID is already bound to a different release SHA");
        }
        await client.query("commit");
        return { claimed: false, status: racedPrior?.status ?? "not-authorized" };
      }

      await client.query(
        `insert into marketing_shadow_evidence_runs(run_id,release_sha,status)
         values($1,$2,'started')`,
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

  async complete(runId: string, evidence: MarketingShadowEvidenceRun): Promise<void> {
    const result = await this.pool.query(
      `update marketing_shadow_evidence_runs
       set status='completed',evidence=$2::jsonb,failure_kind=null,finished_at=now()
       where run_id=$1 and status='started'`,
      [runId, JSON.stringify(evidence)],
    );
    if (result.rowCount === 1) return;

    const prior = await this.pool.query<{ status: MarketingShadowEvidenceRunStatus }>(
      `select status from marketing_shadow_evidence_runs where run_id=$1`,
      [runId],
    );
    if (prior.rows[0]?.status === "completed") return;
    throw new Error("Marketing shadow evidence run is not in a completable state");
  }

  async fail(runId: string, failureKind: string): Promise<void> {
    const result = await this.pool.query(
      `update marketing_shadow_evidence_runs
       set status='failed',evidence=null,failure_kind=$2,finished_at=now()
       where run_id=$1 and status='started'`,
      [runId, failureKind],
    );
    if (result.rowCount === 1) return;

    const prior = await this.pool.query<{ status: MarketingShadowEvidenceRunStatus }>(
      `select status from marketing_shadow_evidence_runs where run_id=$1`,
      [runId],
    );
    if (prior.rows[0]?.status === "failed") return;
    throw new Error("Marketing shadow evidence run is not in a failable state");
  }
}

export function marketingShadowEvidenceRequestFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MarketingShadowEvidenceRequest | null {
  if (env.KAIRO_MARKETING_SHADOW_EVIDENCE_RUN?.trim() !== "1") return null;
  const runId = env.KAIRO_MARKETING_SHADOW_EVIDENCE_RUN_ID?.trim() ?? "";
  const releaseSha = env.KAIRO_RELEASE_SHA?.trim() ?? "";
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("KAIRO_MARKETING_SHADOW_EVIDENCE_RUN_ID is required and must be a safe 1-128 character run ID");
  }
  if (!RELEASE_SHA_PATTERN.test(releaseSha)) {
    throw new Error("KAIRO_RELEASE_SHA must be an exact lowercase 40-character commit SHA for shadow evidence");
  }
  if (env.RENDER?.trim() === "true") {
    const deployedSha = env.RENDER_GIT_COMMIT?.trim() ?? "";
    if (!RELEASE_SHA_PATTERN.test(deployedSha)) {
      throw new Error("RENDER_GIT_COMMIT must identify the exact deployed commit before shadow evidence can run");
    }
    if (deployedSha !== releaseSha) {
      throw new Error("KAIRO_RELEASE_SHA does not match the actual Render deployed commit");
    }
  }
  return { runId, releaseSha };
}

export type MarketingShadowEvidenceAttemptResult =
  | { kind: "completed"; evidence: MarketingShadowEvidenceRun }
  | { kind: "skipped"; priorStatus: Exclude<MarketingShadowEvidenceAttemptStatus, "authorized"> };

export async function executeMarketingShadowEvidenceAttempt(
  store: MarketingShadowEvidenceRunStore,
  runtime: Parameters<typeof runMarketingShadowPairedEvidence>[0],
  request: MarketingShadowEvidenceRequest,
  run: typeof runMarketingShadowPairedEvidence = runMarketingShadowPairedEvidence,
): Promise<MarketingShadowEvidenceAttemptResult> {
  const initialStatus = await store.status(request.runId, request.releaseSha);
  if (initialStatus !== "authorized") return { kind: "skipped", priorStatus: initialStatus };

  const claim = await store.claim(request.runId, request.releaseSha);
  if (!claim.claimed) {
    return {
      kind: "skipped",
      priorStatus: claim.status === "authorized" ? "not-authorized" : claim.status,
    };
  }

  let evidence: MarketingShadowEvidenceRun;
  try {
    evidence = await run(runtime);
  } catch (error) {
    await retryPersistence(() => store.fail(request.runId, safeFailureKind(error))).catch(() => undefined);
    throw error;
  }

  await retryPersistence(() => store.complete(request.runId, evidence));
  return { kind: "completed", evidence };
}

export function safeFailureKind(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (FAILURE_KIND_PATTERN.test(code)) return code;
  }
  if (error instanceof Error) {
    const candidate = error.name.trim();
    if (FAILURE_KIND_PATTERN.test(candidate)) return candidate;
  }
  return "unknown-error";
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
