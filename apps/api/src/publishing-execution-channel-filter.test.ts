import { describe, expect, it } from "vitest";
import { PgPublishingExecutionStore } from "./publishing-execution-postgres-store";

function fakePool() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("select c.*")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } };
}

describe("PgPublishingExecutionStore channel filter", () => {
  it("restricts the production publisher claim to Instagram", async () => {
    const { pool, calls } = fakePool();
    const store = new PgPublishingExecutionStore(pool as never, { channels: ["instagram"] });
    await store.claimNext("2026-08-17T00:00:00.000Z", "publisher-1", 120);
    const claim = calls.find((call) => call.sql.includes("select c.*"));
    expect(claim?.sql).toContain("c.channel = any($2::text[])");
    expect(claim?.params).toEqual(["2026-08-17T00:00:00.000Z", ["instagram"]]);
  });

  it("preserves the existing all-channel behavior by default", async () => {
    const { pool, calls } = fakePool();
    const store = new PgPublishingExecutionStore(pool as never);
    await store.claimNext("2026-08-17T00:00:00.000Z", "publisher-1", 120);
    const claim = calls.find((call) => call.sql.includes("select c.*"));
    expect(claim?.sql).not.toContain("c.channel = any");
    expect(claim?.params).toEqual(["2026-08-17T00:00:00.000Z"]);
  });

  it("rejects manual or duplicate channel filters", () => {
    const { pool } = fakePool();
    expect(() => new PgPublishingExecutionStore(pool as never, { channels: ["manual" as never] })).toThrow("Publishing execution channel filter is invalid");
    expect(() => new PgPublishingExecutionStore(pool as never, { channels: ["instagram", "instagram"] })).toThrow("Publishing execution channel filter is invalid");
  });
});
