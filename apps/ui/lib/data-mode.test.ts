import { describe, expect, it } from "vitest";
import { resolveDiscoveryDataMode, resolveInsightsDataMode } from "./data-mode";

describe("Kairo unified data mode", () => {
  it("keeps Brand readiness real while showing sample Discover cards before Hunter has real results", () => {
    const result = resolveDiscoveryDataMode({
      authenticated: true,
      brandId: "brand-1",
      realItemCount: 0,
      hunterReady: false,
      readinessScore: 62,
    });
    expect(result.mode).toBe("preview");
    expect(result.usesSampleData).toBe(true);
    expect(result.label).toContain("Brand not ready");
    expect(result.message).toContain("62%");
  });

  it("switches Discover to live when real Hunter opportunities exist", () => {
    const result = resolveDiscoveryDataMode({
      authenticated: true,
      brandId: "brand-1",
      realItemCount: 2,
      hunterReady: true,
      latestRunStatus: "succeeded",
    });
    expect(result).toMatchObject({ mode: "live", usesSampleData: false, isLive: true });
  });

  it("marks Insights as collecting while preserving sample values", () => {
    const result = resolveInsightsDataMode({
      authenticated: true,
      brandId: "brand-1",
      hasLiveMetrics: false,
      statuses: [{ status: "running", permission: "unknown", freshness: "due" }],
    });
    expect(result.mode).toBe("collecting");
    expect(result.usesSampleData).toBe(true);
    expect(result.label).toContain("Sample");
  });

  it("never calls collected provider metrics live until the live metric adapter is enabled", () => {
    const result = resolveInsightsDataMode({
      authenticated: true,
      brandId: "brand-1",
      hasLiveMetrics: false,
      statuses: [{ status: "complete", permission: "granted", freshness: "fresh" }],
    });
    expect(result.mode).toBe("preview");
    expect(result.isLive).toBe(false);
    expect(result.label).toContain("Sample");
  });

  it("allows Insights to switch to live once real aggregated metrics are supplied", () => {
    const result = resolveInsightsDataMode({
      authenticated: true,
      brandId: "brand-1",
      hasLiveMetrics: true,
      statuses: [{ status: "complete", permission: "granted", freshness: "fresh" }],
    });
    expect(result).toMatchObject({ mode: "live", usesSampleData: false, isLive: true });
  });
});
