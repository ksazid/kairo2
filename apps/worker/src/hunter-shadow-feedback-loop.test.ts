import { describe, expect, it } from "vitest";
import { projectFeedbackPreferenceStateV2 } from "@kairo/domain/feedback-learning-v2";
import type { OpportunityFeedbackEventV2 } from "@kairo/domain/opportunity-intelligence";
import type { ShadowPreRankedTrend } from "./hunter-shadow-multistage-intelligence";
import { runShadowPreferenceAwareEEI } from "./hunter-shadow-eei-v2";

function feedback(action: OpportunityFeedbackEventV2["action"], at: string): OpportunityFeedbackEventV2 {
  return {
    schemaVersion: "2",
    id: "fb-" + action + "-" + at,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    opportunityId: "opp-1",
    accountId: "account-1",
    action,
    surface: "discover",
    rankingVersion: "hunter-eei-v2-shadow",
    occurredAt: at,
    idempotencyKey: "key-" + action + "-" + at,
  };
}

function candidate(id: string, topic: string, topicFit: number): ShadowPreRankedTrend {
  return {
    candidateId: id,
    cluster: {
      intelligence: {
        schemaVersion: "1",
        trendId: id,
        topic,
        stage: "rising",
        velocity: 0.7,
        acceleration: 0.7,
        crossSourceSpread: 0.8,
        crossPlatformSpread: 0.8,
        creatorOutlier: 0.5,
        categoryOutlier: 0.5,
        saturation: 0.2,
        freshness: 0.9,
        evidenceConfidence: 0.85,
        firstObservedAt: "2026-09-19T08:00:00Z",
        lastObservedAt: "2026-09-20T07:00:00Z",
        supportingSignalIds: [id + ":a"],
      },
      features: {
        featureVersion: "hunter-trend-v1",
        signalCount: 1,
        independentPublisherCount: 1,
        uniqueSourceCount: 1,
        uniquePlatformCount: 1,
        corroboratedSignalCount: 0,
        observationSpanDays: 1,
        unknownFeatures: [],
      },
      sourceKeys: ["rss"],
      platformKeys: ["web"],
      publisherKeys: ["publisher"],
    },
    topicFit,
    sourceClasses: ["Industry news"],
    preRank: {
      schemaVersion: "1",
      candidateId: id,
      preRankVersion: "hunter-prerank-v1",
      features: {
        topicFit,
        evidenceStrength: 0.85,
        freshness: 0.9,
        trendMomentum: 0.8,
        sourceDiversity: 0.8,
        saturationPenalty: 0.2,
      },
      unknownFeatures: ["brandSemanticSimilarity", "preferenceAffinity", "duplicationPenalty", "hardNegativeSimilarity"],
      positiveScore: 0.84,
      penaltyScore: 0.016,
      overall: 0.824,
    },
  };
}

describe("Feedback V2 -> shadow EEI loop", () => {
  it("raises affinity for explicitly successful exploration without removing exploration budget", () => {
    const projected = projectFeedbackPreferenceStateV2(undefined, [
      {
        event: feedback("saved", "2026-09-20T08:00:00Z"),
        topic: "agent observability",
        selectionBucket: "exploration",
      },
      {
        event: feedback("developed", "2026-09-20T09:00:00Z"),
        topic: "agent observability",
        selectionBucket: "exploration",
      },
    ]);

    const run = runShadowPreferenceAwareEEI({
      preRanked: [
        candidate("learned", "agent observability", 0.3),
        candidate("novel", "unrelated emerging topic", 0.1),
      ],
      preferenceState: projected.state,
      options: { maxCandidates: 2, adjacentShare: 0.2 },
    });

    const learned = run.selected.find((item) => item.candidateId === "learned");
    expect(learned?.preferenceAffinity).toBeGreaterThan(0);
    expect(run.diagnostics.explorationBudget).toBeGreaterThanOrEqual(0.12);
  });
});
