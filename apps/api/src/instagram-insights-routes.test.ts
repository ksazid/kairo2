import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PgInstagramInsightsStatusStore } from "./instagram-insights-routes";

describe("Insights live metric lineage store", () => {
  it("returns Brand-scoped normalized metrics with publish lineage", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("select b.workspace_id")) return { rows: [{ workspace_id: "ws-1" }] };
        return {
          rows: [{
            published_post_id: "post-1",
            campaign_id: "campaign-1",
            asset_id: "asset-1",
            channel: "instagram",
            name: "reach",
            captured_at: "2026-10-01T12:00:00Z",
            status: "available",
            value: 1200,
            unavailable_reason: null,
          }],
        };
      },
      release() {},
    };
    const pool = { async connect() { return client; } } as unknown as Pool;
    const store = new PgInstagramInsightsStatusStore(pool);

    await expect(store.metrics("acct-1", "brand-1")).resolves.toEqual([{
      publishedPostId: "post-1",
      campaignId: "campaign-1",
      assetId: "asset-1",
      channel: "instagram",
      name: "reach",
      capturedAt: "2026-10-01T12:00:00.000Z",
      status: "available",
      value: 1200,
    }]);

    expect(queries[0]?.values).toEqual(["acct-1", "brand-1"]);
    expect(queries[1]?.values).toEqual(["ws-1", "brand-1"]);
    expect(queries[1]?.text).toContain("join metric_snapshots");
  });
});
