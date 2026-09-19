import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MarketingShadowEvidenceRun } from "@kairo/worker/marketing-shadow-evidence-runner";
import { PgMarketingShadowEvidenceRunStore } from "./marketing-shadow-evidence-run";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("PostgreSQL marketing shadow evidence run store", () => {
  const pool = new Pool({ connectionString: url });
  const store = new PgMarketingShadowEvidenceRunStore(pool);
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

  async function authorize(runId: string, sha = releaseSha): Promise<void> {
    await pool.query(
      "insert into marketing_shadow_evidence_authorizations(run_id,release_sha) values($1,$2)",
      [runId, sha],
    );
  }

  it("rejects an unapproved run before it can claim model execution", async () => {
    await expect(store.status("vs23-stale-run", releaseSha)).resolves.toBe("not-authorized");
    await expect(store.claim("vs23-stale-run", releaseSha)).resolves.toEqual({
      claimed: false,
      status: "not-authorized",
    });
    const rows = await pool.query("select run_id from marketing_shadow_evidence_runs");
    expect(rows.rowCount).toBe(0);
  });

  it("permits only one outstanding benchmark authorization globally", async () => {
    await authorize("vs23-run-a");
    await expect(authorize("vs23-run-b")).rejects.toThrow();
    await expect(store.status("vs23-run-a", releaseSha)).resolves.toBe("authorized");
    await expect(store.status("vs23-run-b", releaseSha)).resolves.toBe("not-authorized");
  });

  it("atomically consumes one authorization and allows exactly one concurrent claim", async () => {
    await authorize("vs23-run-a");
    const claims = await Promise.all([
      store.claim("vs23-run-a", releaseSha),
      store.claim("vs23-run-a", releaseSha),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.claimed)).toHaveLength(1);
    expect(claims.find((claim) => !claim.claimed)?.status).toBe("started");
    await expect(store.status("vs23-run-a", releaseSha)).resolves.toBe("started");

    const authorization = await pool.query(
      "select run_id from marketing_shadow_evidence_authorizations where run_id=$1",
      ["vs23-run-a"],
    );
    expect(authorization.rowCount).toBe(0);
  });

  it("fails closed when an authorization or prior run is bound to another release SHA", async () => {
    await authorize("vs23-bound-run");
    await expect(store.status("vs23-bound-run", "b".repeat(40))).rejects.toThrow(/different release SHA/);
    await expect(store.claim("vs23-bound-run", "b".repeat(40))).rejects.toThrow(/different release SHA/);

    await expect(store.claim("vs23-bound-run", releaseSha)).resolves.toEqual({ claimed: true, status: "started" });
    await expect(store.status("vs23-bound-run", "b".repeat(40))).rejects.toThrow(/different release SHA/);
  });

  it("persists completed synthetic evidence idempotently for later blind scoring", async () => {
    const evidence = {
      schemaVersion: 1,
      evidenceKind: "vs23-shadow-qualification-paired-execution",
      datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
      challengerSource: {
        repository: "coreyhaines31/marketingskills",
        commitSha: "b".repeat(40),
        path: "skills/social/SKILL.md",
        blobSha: "c".repeat(40),
      },
      runtimeRoute: {
        runtime: "direct-model",
        provider: "test-provider",
        model: "test-model",
        pricingVersion: "test-pricing",
      },
      pairs: [],
    } satisfies MarketingShadowEvidenceRun;

    await authorize("vs23-run-complete");
    await store.claim("vs23-run-complete", releaseSha);
    await store.complete("vs23-run-complete", evidence);
    await expect(store.complete("vs23-run-complete", evidence)).resolves.toBeUndefined();

    const row = await pool.query<{ status: string; evidence: MarketingShadowEvidenceRun; failure_kind: string | null }>(
      "select status,evidence,failure_kind from marketing_shadow_evidence_runs where run_id=$1",
      ["vs23-run-complete"],
    );
    expect(row.rows[0]).toMatchObject({ status: "completed", evidence, failure_kind: null });
    await expect(store.status("vs23-run-complete", releaseSha)).resolves.toBe("completed");
  });

  it("persists only a safe failure category and consumes the failed attempt idempotently", async () => {
    await authorize("vs23-run-failed");
    await store.claim("vs23-run-failed", releaseSha);
    await store.fail("vs23-run-failed", "agent_runtime_error");
    await expect(store.fail("vs23-run-failed", "agent_runtime_error")).resolves.toBeUndefined();

    const row = await pool.query<{ status: string; evidence: unknown; failure_kind: string }>(
      "select status,evidence,failure_kind from marketing_shadow_evidence_runs where run_id=$1",
      ["vs23-run-failed"],
    );
    expect(row.rows[0]).toEqual({ status: "failed", evidence: null, failure_kind: "agent_runtime_error" });
    await expect(store.status("vs23-run-failed", releaseSha)).resolves.toBe("failed");
  });
});
