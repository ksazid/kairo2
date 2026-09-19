import { describe, expect, it, vi } from "vitest";
import {
  enqueueInstagramMetricJobs,
  InstagramMetricCollectionRunner,
  type MetricCollectionJobStore,
} from "./instagram-metric-runner";
import { PerformanceCollectionWorker } from "@kairo/worker/performance";
describe("Instagram metric durability", () => {
  it("enqueues the bounded 1h/24h/7d windows idempotently", async () => {
    const query = vi.fn().mockResolvedValue({});
    await enqueueInstagramMetricJobs(
      { query } as any,
      "post-1",
      "2026-08-22T00:00:00Z",
    );
    expect(query).toHaveBeenCalledOnce();
    const [sql, args] = query.mock.calls[0]!;
    expect(sql).toContain("values('1h'");
    expect(sql).toContain("'24h'");
    expect(sql).toContain("'7d'");
    expect(sql).toContain("on conflict");
    expect(args).toEqual(["post-1", "2026-08-22T00:00:00Z"]);
  });
  it("records delayed collection freshness without changing provider metrics", async () => {
    let settled: any;
    const claimed = {
      job: {
        id: "j",
        workspaceId: "w",
        brandId: "b",
        publishedPostId: "p",
        provider: "instagram" as const,
        accountRef: "1",
        externalPostId: "2",
        credentialRef: "c",
        attempt: 1,
        scheduledFor: "2026-08-22T00:00:00Z",
        collectionWindow: "1h" as const,
      },
      post: {
        id: "p",
        workspaceId: "w",
        brandId: "b",
        campaignId: "c",
        assetId: "a",
        versionId: "v",
        publishCommandId: "pc",
        channel: "instagram",
        accountRef: "1",
        externalPostId: "2",
        publishedAt: "2026-08-21T23:00:00Z",
      },
    };
    const store: MetricCollectionJobStore = {
      async seedInstagram() {},
      async claim() {
        return claimed;
      },
      async settle(...args) {
        settled = args;
      },
    };
    const worker = new PerformanceCollectionWorker([
      {
        provider: "instagram",
        supports: () => true,
        collect: async () => ({ status: "collected", raw: { reach: 2 } }),
      },
    ]);
    const runner = new InstagramMetricCollectionRunner(
      store,
      worker,
      "owner",
      90,
      () => new Date("2026-08-22T00:20:00Z"),
      () => "snapshot",
    );
    expect(await runner.runOnce()).toBe(true);
    expect(settled[3].raw._kairoCollection).toMatchObject({
      window: "1h",
      delaySeconds: 1200,
      freshness: "delayed",
    });
  });
});
