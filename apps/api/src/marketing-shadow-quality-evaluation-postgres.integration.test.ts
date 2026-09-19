import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID,
  MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA,
  MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID,
  PgMarketingShadowQualityEvaluationRunStore,
  type MarketingShadowQualityEvaluationEvidence,
} from "./marketing-shadow-quality-evaluation-run";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("PostgreSQL Marketing Lab quality evaluation store", () => {
  const pool = new Pool({ connectionString: url });
  const store = new PgMarketingShadowQualityEvaluationRunStore(pool);
  const releaseSha = "a".repeat(40);

  beforeAll(async () => {
    const evidenceExists = await pool.query<{ name: string | null }>(
      "select to_regclass('public.marketing_shadow_evidence_runs')::text name",
    );
    if (!evidenceExists.rows[0]?.name) {
      await pool.query(await readFile(new URL("../migrations/0016_marketing_shadow_evidence_runs.sql", import.meta.url), "utf8"));
    }
    const authorizationExists = await pool.query<{ name: string | null }>(
      "select to_regclass('public.marketing_shadow_evidence_authorizations')::text name",
    );
    if (!authorizationExists.rows[0]?.name) {
      await pool.query(await readFile(new URL("../migrations/0022_marketing_shadow_evidence_authorizations.sql", import.meta.url), "utf8"));
    }
  });

  beforeEach(async () => {
    await pool.query("truncate marketing_shadow_evidence_authorizations,marketing_shadow_evidence_runs");
  });
  afterAll(() => pool.end());

  it("allows exactly one concurrent quality claim after authorization", async () => {
    await pool.query(
      "insert into marketing_shadow_evidence_authorizations(run_id,release_sha) values($1,$2)",
      [MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, releaseSha],
    );
    const claims = await Promise.all([
      store.claim(MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, releaseSha),
      store.claim(MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, releaseSha),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.claimed)).toHaveLength(1);
    await expect(store.status(MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, releaseSha)).resolves.toBe("started");
  });

  it("persists quality evidence idempotently without altering source benchmark evidence", async () => {
    const sourceRunId = "vs23-source-fixture";
    const sourceEvidence = { schemaVersion: 1, evidenceKind: "source-fixture" };
    await pool.query(
      "insert into marketing_shadow_evidence_runs(run_id,release_sha,status,evidence,finished_at) values($1,$2,'completed',$3::jsonb,now())",
      [sourceRunId, "b".repeat(40), JSON.stringify(sourceEvidence)],
    );
    await pool.query(
      "insert into marketing_shadow_evidence_authorizations(run_id,release_sha) values($1,$2)",
      [MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, releaseSha],
    );
    await store.claim(MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, releaseSha);
    const evidence: MarketingShadowQualityEvaluationEvidence = {
      schemaVersion: 1,
      evidenceKind: "vs65-marketing-quality-evaluation",
      sourceRunId: MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID,
      sourceReleaseSha: MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA,
      evaluatorReleaseSha: releaseSha,
      datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
      candidateMapping: {
        candidateA: { id: "kairo-native-carousel", version: "1" },
        candidateB: { id: "corey-social-shadow", version: "2.2.0+7868cb9" },
      },
      pairs: [],
    };
    await store.complete(MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, evidence);
    await expect(store.complete(MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, evidence)).resolves.toBeUndefined();

    const quality = await pool.query<{ status: string; evidence: MarketingShadowQualityEvaluationEvidence }>(
      "select status,evidence from marketing_shadow_evidence_runs where run_id=$1",
      [MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID],
    );
    expect(quality.rows[0]).toMatchObject({ status: "completed", evidence });
    const source = await pool.query<{ evidence: unknown }>(
      "select evidence from marketing_shadow_evidence_runs where run_id=$1",
      [sourceRunId],
    );
    expect(source.rows[0]?.evidence).toEqual(sourceEvidence);
  });
});
