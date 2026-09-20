import { describe, expect, it, vi } from "vitest";
import type { BrandDiscoveryPlan } from "@kairo/domain/brand-discovery-plan";
import type { BrandPreferenceState } from "@kairo/domain/brand-preference-state";
import { HUNTER_DEEP_INTELLIGENCE_VERSION } from "@kairo/domain/hunter-multistage";
import type { ShadowTrendCluster } from "./hunter-shadow-trend-intelligence";
import { runShadowMultiStageIntelligence } from "./hunter-shadow-multistage-intelligence";

const plan: BrandDiscoveryPlan = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  revision: 1,
  planVersion: "snapshot-1:discovery:1",
  snapshotVersion: "snapshot-1",
  state: "customized",
  topics: [
    {
      id: "ev-battery-health",
      name: "EV battery health",
      priority: "High",
      audience: "Used EV buyers",
      entities: ["battery diagnostics", "used EV battery"],
      sourceClasses: ["Official sources", "Industry news"],
    },
    {
      id: "ev-charging",
      name: "EV charging",
      priority: "Medium",
      audience: "EV owners",
      entities: ["charging etiquette"],
      sourceClasses: ["Industry news"],
    },
  ],
  excludedTopics: [],
  updatedAt: "2026-09-20T08:00:00Z",
};

const preference: BrandPreferenceState = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  snapshotVersion: "snapshot-1",
  longTerm: {
    topicWeights: [{ key: "battery diagnostics", weight: 0.9 }],
    audienceWeights: [{ key: "used EV buyers", weight: 0.8 }],
    formatWeights: [],
    channelWeights: [],
    mechanismWeights: [],
  },
  shortTerm: {
    activeTopics: [{ key: "EV battery health", weight: 0.85 }],
    activeCampaignIds: [],
    updatedAt: "2026-09-20T08:00:00Z",
  },
  negatives: { topics: [], audiences: [], mechanisms: [], sourceClasses: [] },
  performanceMemory: [],
  explorationBudget: 0.1,
  updatedAt: "2026-09-20T08:00:00Z",
};

function cluster(id: string, topic: string, overrides: Partial<ShadowTrendCluster["intelligence"]> = {}): ShadowTrendCluster {
  return {
    intelligence: {
      schemaVersion: "1",
      trendId: id,
      topic,
      stage: "rising",
      velocity: 0.7,
      acceleration: 0.65,
      crossSourceSpread: 0.8,
      crossPlatformSpread: 0.7,
      creatorOutlier: 0.5,
      categoryOutlier: 0.5,
      saturation: 0.25,
      freshness: 0.9,
      evidenceConfidence: 0.85,
      firstObservedAt: "2026-09-18T08:00:00Z",
      lastObservedAt: "2026-09-20T07:00:00Z",
      supportingSignalIds: [id + ":a", id + ":b"],
      ...overrides,
    },
    features: {
      featureVersion: "hunter-trend-v1",
      signalCount: 2,
      independentPublisherCount: 2,
      uniqueSourceCount: 2,
      uniquePlatformCount: 2,
      corroboratedSignalCount: 2,
      observationSpanDays: 2,
      rawVelocity: 3,
      rawAccelerationRatio: 2,
      rawCreatorOutlierRatio: 1.5,
      rawCategoryOutlierRatio: 1.4,
      unknownFeatures: [],
    },
    sourceKeys: ["rss:web", "youtube:youtube"],
    platformKeys: ["web", "youtube"],
    publisherKeys: ["a", "b"],
    generatorKeys: ["brand-core"],
  };
}

describe("runShadowMultiStageIntelligence", () => {
  it("pre-ranks deterministically and favors Brand/topic evidence without requiring optional semantic scores", async () => {
    const run = await runShadowMultiStageIntelligence({
      clusters: [
        cluster("trend-battery", "EV battery health"),
        cluster("trend-charging", "EV charging", { evidenceConfidence: 0.55, freshness: 0.5 }),
        cluster("trend-unrelated", "Restaurant delivery margins", { evidenceConfidence: 0.95 }),
      ],
      plan,
      preferenceState: preference,
      options: { preRankLimit: 3, deepLimit: 0 },
    });

    expect(run.preRanked[0]!.candidateId).toBe("trend-battery");
    expect(run.preRanked[0]!.matchedTopicId).toBe("ev-battery-health");
    expect(run.preRanked[0]!.preRank.unknownFeatures).toContain("brandSemanticSimilarity");
    expect(run.diagnostics.deepRequestedCount).toBe(0);
  });

  it("marks exploration-only retrieval clusters as bounded exploration candidates", async () => {
    const explorationCluster = cluster("trend-explore", "EV battery health");
    explorationCluster.generatorKeys = ["adjacent-exploration"];

    const run = await runShadowMultiStageIntelligence({
      clusters: [explorationCluster],
      plan,
      preferenceState: preference,
      options: { preRankLimit: 1, deepLimit: 0 },
    });

    expect(run.preRanked).toHaveLength(1);
    expect(run.preRanked[0]!.explorationEligible).toBe(true);
    expect(run.preRanked[0]!.topicFit).toBeLessThanOrEqual(0.25);
  });

  it("bounds deep analysis to the configured top set and validates outputs", async () => {
    const analyze = vi.fn(async (request: any) => ({
      version: HUNTER_DEEP_INTELLIGENCE_VERSION,
      candidateId: request.candidateId,
      mechanism: { hookType: "diagnostic checklist", structure: "checklist", confidence: 0.8 },
      brandReason: "Strong Brand-topic alignment.",
      audienceReason: "The audience can take a concrete action.",
      whyNow: "The supporting cluster is recent and corroborated.",
      contentGap: "Existing coverage lacks a concise actionable checklist.",
      proposedAngle: "Turn the evidence into a practical five-step diagnostic.",
      originality: 0.7,
      actionability: 0.9,
      confidence: 0.82,
    }));

    const run = await runShadowMultiStageIntelligence({
      clusters: [
        cluster("t1", "EV battery health"),
        cluster("t2", "EV charging"),
        cluster("t3", "EV battery diagnostics"),
        cluster("t4", "Used EV battery"),
      ],
      plan,
      preferenceState: preference,
      deepAnalysis: { analyze },
      options: {
        preRankLimit: 4,
        deepLimit: 2,
        brandSemanticSimilarityByCandidateId: { t1: 0.95, t2: 0.6, t3: 0.9, t4: 0.8 },
        duplicationPenaltyByCandidateId: { t1: 0, t2: 0, t3: 0.1, t4: 0.2 },
        hardNegativeSimilarityByCandidateId: { t1: 0, t2: 0, t3: 0, t4: 0 },
      },
    });

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(run.deepIntelligence).toHaveLength(2);
    expect(run.diagnostics.deepRequestedCount).toBe(2);
    expect(run.diagnostics.deepSucceededCount).toBe(2);
    expect(run.diagnostics.deepSkippedCount).toBe(2);
  });

  it("executes bounded deep-analysis requests concurrently while preserving output order", async () => {
    let active = 0;
    let maxActive = 0;
    const analyze = vi.fn(async (request: any) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, request.candidateId === "t1" ? 8 : 2));
      active -= 1;
      return {
        version: HUNTER_DEEP_INTELLIGENCE_VERSION,
        candidateId: request.candidateId,
        brandReason: "Relevant.",
        audienceReason: "Useful.",
        whyNow: "Recent.",
        contentGap: "Gap.",
        proposedAngle: "Angle.",
        originality: 0.6,
        actionability: 0.7,
        confidence: 0.7,
      };
    });

    const run = await runShadowMultiStageIntelligence({
      clusters: [cluster("t1", "EV battery health"), cluster("t2", "EV charging")],
      plan,
      deepAnalysis: { analyze },
      options: { preRankLimit: 2, deepLimit: 2 },
    });

    expect(maxActive).toBe(2);
    expect(run.deepIntelligence.map((item) => item.candidateId)).toEqual(
      run.preRanked.slice(0, 2).map((item) => item.candidateId),
    );
  });

  it("isolates deep-analysis failures without changing the deterministic pre-rank", async () => {
    const analyze = vi.fn(async (request: any) => {
      if (request.candidateId === "t1") throw new Error("provider unavailable");
      return {
        version: HUNTER_DEEP_INTELLIGENCE_VERSION,
        candidateId: request.candidateId,
        brandReason: "Relevant.",
        audienceReason: "Useful.",
        whyNow: "Recent.",
        contentGap: "Gap.",
        proposedAngle: "Angle.",
        originality: 0.6,
        actionability: 0.7,
        confidence: 0.7,
      };
    });

    const run = await runShadowMultiStageIntelligence({
      clusters: [cluster("t1", "EV battery health"), cluster("t2", "EV charging")],
      plan,
      deepAnalysis: { analyze },
      options: { preRankLimit: 2, deepLimit: 2 },
    });

    expect(run.preRanked).toHaveLength(2);
    expect(run.diagnostics.deepFailedCount).toBe(1);
    expect(run.diagnostics.deepSucceededCount).toBe(1);
  });
});
