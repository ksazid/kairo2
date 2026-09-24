import { describe, expect, it } from "vitest";
import type { BrandPreferenceState } from "@kairo/domain/brand-preference-state";
import type { ShadowPreRankedTrend } from "./hunter-shadow-multistage-intelligence";
import { runShadowPreferenceAwareEEI } from "./hunter-shadow-eei-v2";

const preferenceState: BrandPreferenceState = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  snapshotVersion: "snapshot-1",
  longTerm: {
    topicWeights: [{ key: "core topic", weight: 0.9 }],
    audienceWeights: [],
    formatWeights: [],
    channelWeights: [],
    mechanismWeights: [],
  },
  shortTerm: {
    activeTopics: [],
    activeCampaignIds: [],
    updatedAt: "2026-09-20T08:00:00Z",
  },
  negatives: {
    topics: [{ key: "crypto speculation", strength: 1, lastObservedAt: "2026-09-20T08:00:00Z" }],
    audiences: [],
    mechanisms: [],
    sourceClasses: [],
  },
  performanceMemory: [],
  explorationBudget: 0.2,
  updatedAt: "2026-09-20T08:00:00Z",
};

function item(
  id: string,
  topic: string,
  topicFit: number,
  source: string,
  saturation = 0.2,
  duplicationPenalty = 0,
  explorationEligible = topicFit < 0.32,
  subject = topic,
): ShadowPreRankedTrend {
  return {
    candidateId: id,
    cluster: {
      subject,
      intelligence: {
        schemaVersion: "1",
        trendId: id,
        topic,
        stage: "rising",
        velocity: 0.7,
        acceleration: 0.6,
        crossSourceSpread: 0.8,
        crossPlatformSpread: 0.8,
        creatorOutlier: 0.5,
        categoryOutlier: 0.5,
        saturation,
        freshness: 0.9,
        evidenceConfidence: 0.82,
        firstObservedAt: "2026-09-19T08:00:00Z",
        lastObservedAt: "2026-09-20T07:00:00Z",
        supportingSignalIds: [id + ":a", id + ":b"],
      },
      features: {
        featureVersion: "hunter-trend-v1",
        signalCount: 2,
        independentPublisherCount: 2,
        uniqueSourceCount: 2,
        uniquePlatformCount: 2,
        corroboratedSignalCount: 2,
        observationSpanDays: 1,
        unknownFeatures: [],
      },
      sourceKeys: [source],
      platformKeys: ["web"],
      publisherKeys: [source + "-publisher"],
      generatorKeys: explorationEligible ? ["adjacent-exploration"] : ["brand-core"],
    },
    topicFit,
    sourceClasses: ["Industry news"],
    explorationEligible,
    preRank: {
      schemaVersion: "1",
      candidateId: id,
      preRankVersion: "hunter-prerank-v1",
      features: {
        topicFit,
        evidenceStrength: 0.82,
        freshness: 0.9,
        trendMomentum: 0.75,
        sourceDiversity: 0.8,
        saturationPenalty: saturation,
        duplicationPenalty,
      },
      unknownFeatures: ["brandSemanticSimilarity", "preferenceAffinity", "hardNegativeSimilarity"],
      positiveScore: 0.82,
      penaltyScore: duplicationPenalty * 0.12,
      overall: Math.max(0, 0.82 - duplicationPenalty * 0.12),
    },
  };
}

describe("shadow Preference-aware EEI V2", () => {
  it("allocates a real exploration quota while preserving core and adjacent recommendations", () => {
    const input = [
      ...Array.from({ length: 6 }, (_, i) => item("core-" + i, "core topic " + i, 0.9, "core-source-" + i)),
      ...Array.from({ length: 2 }, (_, i) => item("adj-" + i, "adjacent topic " + i, 0.5, "adj-source-" + i)),
      ...Array.from({ length: 2 }, (_, i) => item("exp-" + i, "novel exploration " + i, 0.1, "exp-source-" + i)),
    ];

    const run = runShadowPreferenceAwareEEI({
      preRanked: input,
      preferenceState,
      options: { maxCandidates: 10, adjacentShare: 0.2 },
    });

    expect(run.diagnostics.explorationTargetCount).toBe(2);
    expect(run.diagnostics.explorationSelectedCount).toBe(2);
    expect(run.diagnostics.adjacentSelectedCount).toBe(2);
    expect(run.diagnostics.coreSelectedCount).toBe(6);
    expect(run.selected).toHaveLength(10);
    expect(run.selected.filter((value) => value.bucket === "exploration").every((value) =>
      value.explanation.uncertainty?.includes("lower known preference affinity")
    )).toBe(true);
  });


  it("keeps explicit evidence-backed exploration in the exploration bucket even when preferences favor the parent topic", () => {
    const explicitExploration = item(
      "exp-parent",
      "core topic",
      0.9,
      "exp-source",
      0.2,
      0,
      true,
    );

    const run = runShadowPreferenceAwareEEI({
      preRanked: [explicitExploration],
      preferenceState,
      options: { maxCandidates: 1 },
    });

    expect(run.selected).toHaveLength(1);
    expect(run.selected[0]!.bucket).toBe("exploration");
    expect(run.diagnostics.explorationSelectedCount).toBe(1);
  });

  it("does not let fallback selection exceed the certified exploration maximum", () => {
    const input = [
      ...Array.from({ length: 8 }, (_, i) => item("core-cap-" + i, "core cap " + i, 0.9, "core-cap-source-" + i)),
      ...Array.from({ length: 6 }, (_, i) => item("exp-cap-" + i, "explore cap " + i, 0.1, "exp-cap-source-" + i)),
    ];

    const run = runShadowPreferenceAwareEEI({
      preRanked: input,
      preferenceState: { ...preferenceState, explorationBudget: 0.1 },
      options: { maxCandidates: 10, adjacentShare: 0.2 },
    });

    expect(run.selected).toHaveLength(10);
    expect(run.diagnostics.explorationSelectedCount).toBeLessThanOrEqual(2);
    expect(run.diagnostics.explorationSelectedCount / run.selected.length).toBeLessThanOrEqual(0.2);
  });

  it("enforces the certified exploration ceiling against the actual final output size", () => {
    const input = [
      item("core-a", "Core subject A", 0.9, "core-a"),
      item("core-b", "Core subject B", 0.9, "core-b"),
      item("core-c", "Core subject C", 0.9, "core-c"),
      item("exp-a", "Explore subject A", 0.1, "exp-a", 0.2, 0, true),
      item("exp-b", "Explore subject B", 0.1, "exp-b", 0.2, 0, true),
      item("exp-c", "Explore subject C", 0.1, "exp-c", 0.2, 0, true),
    ];

    const run = runShadowPreferenceAwareEEI({
      preRanked: input,
      preferenceState: { ...preferenceState, explorationBudget: 0.1 },
      options: {
        maxCandidates: 6,
        adjacentShare: 0.2,
        enforceFinalExplorationShare: true,
      },
    });

    const explorationShare = run.selected.length
      ? run.diagnostics.explorationSelectedCount / run.selected.length
      : 0;
    expect(explorationShare).toBeLessThanOrEqual(0.2);
    expect(run.diagnostics.maximumObservedTopicShare).toBeLessThanOrEqual(0.34);
  });

  it("blocks manipulation, strong negative preferences and exhausted saturated duplicates", () => {
    const run = runShadowPreferenceAwareEEI({
      preRanked: [
        item("safe", "core topic", 0.9, "safe"),
        item("manipulative", "core topic two", 0.9, "risk"),
        item("negative", "crypto speculation", 0.9, "crypto"),
        item("saturated", "another core topic", 0.9, "dup", 0.95, 1),
      ],
      preferenceState,
      options: {
        maxCandidates: 4,
        engagementRisksByCandidateId: {
          manipulative: { fearOrAnxietyExploitation: true },
        },
      },
    });

    expect(run.selected.map((value) => value.candidateId)).toEqual(["safe"]);
    expect(run.diagnostics.blockedManipulationCount).toBe(1);
    expect(run.diagnostics.blockedNegativePreferenceCount).toBe(1);
    expect(run.diagnostics.blockedSaturationCount).toBe(1);
  });

  it("keeps parent-topic relevance while measuring diversity over distinct evidence subjects", () => {
    const input = [
      item("core-a1", "parent topic a", 0.9, "same", 0.2, 0, false, "Evidence subject A1"),
      item("core-a2", "parent topic a", 0.9, "same", 0.2, 0, false, "Evidence subject A2"),
      item("core-b1", "parent topic b", 0.9, "same", 0.2, 0, false, "Evidence subject B1"),
      item("core-b2", "parent topic b", 0.9, "same", 0.2, 0, false, "Evidence subject B2"),
      item("core-b3", "parent topic b", 0.9, "same", 0.2, 0, false, "Evidence subject B3"),
      item("exp-1", "parent topic c", 0.1, "same", 0.2, 0, true, "Adjacent evidence subject"),
    ];

    const run = runShadowPreferenceAwareEEI({
      preRanked: input,
      preferenceState: { ...preferenceState, explorationBudget: 0.1 },
      options: { maxCandidates: 6, adjacentShare: 0.2 },
    });

    expect(run.selected).toHaveLength(6);
    expect(run.diagnostics.explorationSelectedCount).toBe(1);
    expect(run.diagnostics.explorationSelectedCount / run.selected.length).toBeCloseTo(1 / 6);
    expect(run.diagnostics.maximumObservedTopicShare).toBeLessThanOrEqual(0.34);
    expect(new Set(run.selected.map((value) => value.topic)).size).toBe(6);
  });

  it("enforces topic concentration and dynamically favors source diversity", () => {
    const input = [
      item("a1", "agents", 0.9, "same"),
      item("a2", "agents", 0.9, "same"),
      item("a3", "agents", 0.9, "same"),
      item("b1", "cloud", 0.9, "source-b"),
      item("c1", "testing", 0.9, "source-c"),
      item("d1", "architecture", 0.9, "source-d"),
    ];

    const run = runShadowPreferenceAwareEEI({
      preRanked: input,
      options: { maxCandidates: 6, adjacentShare: 0.2 },
    });

    expect(run.selected.filter((value) => value.topic === "agents").length).toBeLessThanOrEqual(2);
    expect(run.diagnostics.uniqueSelectedSourceCount).toBeGreaterThanOrEqual(4);
    expect(run.diagnostics.maximumObservedTopicShare).toBeLessThanOrEqual(0.34);
  });

  it("does not penalize candidates merely because Preference State is unavailable", () => {
    const run = runShadowPreferenceAwareEEI({
      preRanked: [item("a", "unknown but relevant", 0.8, "source-a")],
      options: { maxCandidates: 1 },
    });

    expect(run.selected).toHaveLength(1);
    expect(run.selected[0]!.preferenceAffinity).toBeUndefined();
    expect(run.selected[0]!.eeiScore).toBeGreaterThan(0.5);
  });
});
