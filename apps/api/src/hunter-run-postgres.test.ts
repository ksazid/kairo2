import { describe, expect, it, vi } from "vitest";
import { PgHunterRunRepository } from "./hunter-run-postgres";

describe("PgHunterRunRepository", () => {
  it("finalizes a Hunter run with contiguous PostgreSQL parameters", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "begin" || sql === "commit") return { rows: [], rowCount: 0 };
      if (sql.includes("select 1 from hunter_run_records")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes("update hunter_run_records")) {
        expect(sql).toContain("status=$2");
        expect(sql).toContain("where run_id=$1");
        expect(sql).not.toContain("status=$3");
        expect(params).toEqual([
          "run-1",
          "succeeded",
          "2026-09-06T00:30:00.000Z",
          1500,
          8,
          5,
          3,
          JSON.stringify(["website"]),
          JSON.stringify([]),
          null,
          null,
        ]);
        return {
          rowCount: 1,
          rows: [{
            run_id: "run-1",
            schema_version: "1",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            snapshot_version: "snapshot-1",
            plan_version: "plan-1",
            trigger: "manual",
            status: "succeeded",
            started_at: "2026-09-06T00:29:58.500Z",
            completed_at: "2026-09-06T00:30:00.000Z",
            duration_ms: 1500,
            evidence_count: 8,
            candidate_count: 5,
            opportunity_count: 3,
            sources_scanned: ["website"],
            degraded_sources: [],
            failure_code: null,
            failure_message: null,
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const pool = { connect: vi.fn(async () => ({ query, release })) } as any;

    const result = await new PgHunterRunRepository(pool).complete("account-1", "run-1", {
      completedAt: "2026-09-06T00:30:00.000Z",
      durationMs: 1500,
      evidenceCount: 8,
      candidateCount: 5,
      opportunityCount: 3,
      sourcesScanned: ["website"],
      degradedSources: [],
    });

    expect(result).toEqual(expect.objectContaining({ runId: "run-1", status: "succeeded", opportunityCount: 3 }));
    expect(release).toHaveBeenCalledOnce();
  });
});
