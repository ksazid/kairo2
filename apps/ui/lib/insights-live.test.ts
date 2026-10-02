import { describe, expect, it } from "vitest";
import type { ContentItem } from "./content";
import { buildLiveInsights, hasSufficientLiveMetrics, type LiveMetricRow } from "./insights-live";

const base = (overrides: Partial<LiveMetricRow>): LiveMetricRow => ({
  publishedPostId: "post-1",
  campaignId: "campaign-1",
  assetId: "asset-1",
  channel: "instagram",
  name: "reach",
  capturedAt: "2026-10-01T12:00:00Z",
  status: "available",
  value: 1000,
  ...overrides,
});

describe("live Insights adapter", () => {
  it("requires exposure plus at least one additional available metric", () => {
    expect(hasSufficientLiveMetrics([base({})])).toBe(false);
    expect(hasSufficientLiveMetrics([base({}), base({ name: "likes", value: 50 })])).toBe(true);
  });

  it("uses latest cumulative value per post instead of double-counting snapshots", () => {
    const rows = [
      base({ capturedAt: "2026-09-30T12:00:00Z", value: 800 }),
      base({ capturedAt: "2026-10-01T12:00:00Z", value: 1000 }),
      base({ name: "likes", capturedAt: "2026-10-01T12:00:00Z", value: 80 }),
      base({ name: "comments", capturedAt: "2026-10-01T12:00:00Z", value: 20 }),
      base({ name: "saves", capturedAt: "2026-10-01T12:00:00Z", value: 50 }),
    ];
    const view = buildLiveInsights(rows, { channel: "all", range: "30", items: [] });
    expect(view.ready).toBe(true);
    expect(view.metrics.find((item) => item.id === "reach")?.value).toBe("1K");
    expect(view.metrics.find((item) => item.id === "engagement")?.value).toBe("15.0%");
    expect(view.metrics.find((item) => item.id === "saves")?.value).toBe("50");
  });

  it("builds channel, campaign and audience evidence from lineage", () => {
    const items: ContentItem[] = [{
      id: "asset-1", campaignId: "campaign-1", campaignName: "Launch", title: "Post", summary: "", caption: "",
      channel: "Instagram", format: "image", formatLabel: "Post", status: "published", statusLabel: "Published",
      updatedAt: "2026-10-01T00:00:00Z", image: "/x", media: ["/x"], audience: "Operators", objective: "Educate",
      cta: "Read", currentVersion: 1, rawChannel: "instagram", rawContent: "",
    }];
    const rows = [
      base({ value: 1000 }),
      base({ name: "likes", value: 100 }),
      base({ name: "saves", value: 25 }),
    ];
    const view = buildLiveInsights(rows, { channel: "all", range: "30", items: [...items] });
    expect(view.channels[0]).toMatchObject({ label: "Instagram", value: 100 });
    expect(view.topCampaign).toMatchObject({ campaignId: "campaign-1", reach: 1000 });
    expect(view.topAudience).toMatchObject({ audience: "Operators", reach: 1000 });
    expect(view.topContent[0]).toMatchObject({ assetId: "asset-1", reach: 1000, saves: 25 });
  });

  it("filters live aggregation by channel", () => {
    const rows = [
      base({ value: 1000 }),
      base({ name: "likes", value: 100 }),
      base({ publishedPostId: "post-2", assetId: "asset-2", campaignId: "campaign-2", channel: "linkedin", value: 500 }),
      base({ publishedPostId: "post-2", assetId: "asset-2", campaignId: "campaign-2", channel: "linkedin", name: "likes", value: 20 }),
    ];
    const view = buildLiveInsights(rows, { channel: "LinkedIn", range: "30", items: [] });
    expect(view.metrics.find((item) => item.id === "reach")?.value).toBe("500");
    expect(view.channels).toEqual([{ label: "LinkedIn", value: 100, detail: "500 reach" }]);
  });
});
