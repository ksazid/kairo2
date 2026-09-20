import { describe, expect, it } from "vitest";
import type { NormalizedMetric } from "./analytics";
import {
  buildHunterOutcomeAttribution,
  type OutcomeAttributionLineage,
  type OutcomeMetricBaseline,
} from "./hunter-outcome-attribution";

const lineage: OutcomeAttributionLineage = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  opportunityId: "opp-1",
  ideaId: "idea-1",
  contentId: "content-1",
  publishedPostId: "post-1",
  channel: "instagram",
  publishedAt: "2026-09-18T08:00:00Z",
  directOpportunityLineage: true,
  topic: "AI agents",
  audience: "technical founders",
  mechanismKeys: ["diagnostic checklist", "proof-led hook"],
};

function metric(
  name: NormalizedMetric["name"],
  value: number,
  capturedAt = "2026-09-20T08:00:00Z",
  overrides: Partial<NormalizedMetric> = {},
): NormalizedMetric {
  return {
    id: "m-" + name + "-" + capturedAt,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    publishedPostId: "post-1",
    name,
    capturedAt,
    status: "available",
    value,
    sourceSnapshotId: "snapshot-1",
    sourceField: name,
    transformationVersion: "instagram-v1",
    ...overrides,
  };
}

function baseline(
  name: OutcomeMetricBaseline["name"],
  value: number,
  sampleCount = 20,
  overrides: Partial<OutcomeMetricBaseline> = {},
): OutcomeMetricBaseline {
  return {
    workspaceId: "workspace-1",
    brandId: "brand-1",
    name,
    value,
    sampleCount,
    capturedThrough: "2026-09-18T07:00:00Z",
    scope: "brand-channel",
    channel: "instagram",
    ...overrides,
  };
}

describe("Hunter outcome attribution", () => {
  it("computes positive Brand-relative lift and emits gated positive performance memory", () => {
    const result = buildHunterOutcomeAttribution({
      lineage,
      metrics: [
        metric("saves", 50),
        metric("shares", 40),
        metric("comments", 30),
        metric("reach", 1000),
      ],
      baselines: [
        baseline("saves", 20),
        baseline("shares", 20),
        baseline("comments", 15),
        baseline("reach", 700),
      ],
      asOf: "2026-09-20T09:00:00Z",
      format: "carousel",
    });

    expect(result.causalClaim).toBe(false);
    expect(result.association).toBe("positive");
    expect(result.brandRelativeLift).toBeGreaterThan(0.15);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.performanceMemoryProposals.map((item) => item.dimension)).toEqual(
      expect.arrayContaining(["topic", "audience", "mechanism"]),
    );
    expect(result.limitations[0]).toContain("association, not causation");
  });

  it("uses the latest metric and the most specific compatible Brand baseline", () => {
    const result = buildHunterOutcomeAttribution({
      lineage,
      metrics: [
        metric("saves", 10, "2026-09-19T08:00:00Z"),
        metric("saves", 30, "2026-09-20T08:00:00Z"),
      ],
      baselines: [
        baseline("saves", 25, 50, { scope: "brand-all", channel: undefined }),
        baseline("saves", 20, 15),
        baseline("saves", 15, 8, { scope: "brand-format", channel: undefined, format: "carousel" }),
      ],
      asOf: "2026-09-20T09:00:00Z",
      format: "carousel",
    });

    expect(result.comparisons[0]).toMatchObject({
      name: "saves",
      currentValue: 30,
      baselineValue: 15,
      baselineScope: "brand-format",
    });
  });

  it("reports negative association without turning it into negative user preference memory", () => {
    const result = buildHunterOutcomeAttribution({
      lineage,
      metrics: [
        metric("saves", 5),
        metric("shares", 4),
        metric("comments", 3),
      ],
      baselines: [
        baseline("saves", 20),
        baseline("shares", 20),
        baseline("comments", 15),
      ],
      asOf: "2026-09-20T09:00:00Z",
    });

    expect(result.association).toBe("negative");
    expect(result.brandRelativeLift).toBeLessThan(-0.15);
    expect(result.performanceMemoryProposals).toEqual([]);
  });

  it("keeps unavailable metrics unknown and returns insufficient-data when no compatible outcome exists", () => {
    const unavailable: NormalizedMetric = {
      ...metric("saves", 0),
      status: "unavailable",
      value: undefined,
      reason: "provider-did-not-return",
    };

    const result = buildHunterOutcomeAttribution({
      lineage,
      metrics: [unavailable],
      baselines: [baseline("saves", 20)],
      asOf: "2026-09-20T09:00:00Z",
    });

    expect(result.association).toBe("insufficient-data");
    expect(result.confidence).toBe(0);
    expect(result.unknownMetrics).toContain("saves");
    expect(result.performanceMemoryProposals).toEqual([]);
  });

  it("reduces confidence for indirect lineage instead of claiming direct attribution", () => {
    const direct = buildHunterOutcomeAttribution({
      lineage,
      metrics: [metric("saves", 30), metric("shares", 25)],
      baselines: [baseline("saves", 20), baseline("shares", 20)],
      asOf: "2026-09-20T09:00:00Z",
    });
    const indirect = buildHunterOutcomeAttribution({
      lineage: { ...lineage, directOpportunityLineage: false },
      metrics: [metric("saves", 30), metric("shares", 25)],
      baselines: [baseline("saves", 20), baseline("shares", 20)],
      asOf: "2026-09-20T09:00:00Z",
    });

    expect(indirect.confidence).toBeLessThan(direct.confidence);
    expect(indirect.limitations.join(" ")).toContain("indirect");
  });

  it("rejects metrics or baselines outside the lineage Brand", () => {
    expect(() => buildHunterOutcomeAttribution({
      lineage,
      metrics: [metric("saves", 30, undefined, { brandId: "other-brand" })],
      baselines: [baseline("saves", 20)],
      asOf: "2026-09-20T09:00:00Z",
    })).toThrow("outside attribution workspace or Brand");

    expect(() => buildHunterOutcomeAttribution({
      lineage,
      metrics: [metric("saves", 30)],
      baselines: [baseline("saves", 20, 20, { workspaceId: "other-workspace" })],
      asOf: "2026-09-20T09:00:00Z",
    })).toThrow("outside attribution workspace or Brand");
  });
});
