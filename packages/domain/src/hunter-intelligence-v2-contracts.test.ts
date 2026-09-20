import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import { prepareBrandPreferenceState } from "./brand-preference-state";
import { evaluateManipulationRisk, prepareEEIPolicy } from "./eei";
import { prepareOpportunityValueScores } from "./hunter-ranking";
import {
  prepareOpportunityFeedbackEventV2,
  prepareOpportunityIntelligence,
} from "./opportunity-intelligence";
import { prepareTrendIntelligence, summarizeTrendIntelligence } from "./trend-intelligence";

const ranking = prepareOpportunityValueScores({
  brandFit: 0.9,
  audienceNeed: 0.8,
  evidenceStrength: 0.85,
  trendMomentum: 0.7,
  originality: 0.82,
  actionability: 0.91,
  expectedBrandPerformance: 0.6,
  freshness: 0.8,
  authority: 0.75,
  learningValue: 0.65,
  duplicationPenalty: 0.05,
  saturationPenalty: 0.1,
  weakProvenancePenalty: 0.05,
  manipulationRiskPenalty: 0,
  brandBoundaryRiskPenalty: 0,
  overexposurePenalty: 0.05,
  lowConfidencePenalty: 0.05,
  recentRejectionSimilarityPenalty: 0,
  overall: 0.84,
  rankingVersion: "hunter-v2-deterministic-1",
});

const trend = prepareTrendIntelligence({
  trendId: "trend-1",
  topic: "EV battery health",
  stage: "rising",
  velocity: 0.72,
  acceleration: 0.66,
  crossSourceSpread: 0.8,
  crossPlatformSpread: 0.7,
  creatorOutlier: 0.6,
  categoryOutlier: 0.64,
  saturation: 0.25,
  freshness: 0.9,
  evidenceConfidence: 0.86,
  firstObservedAt: "2026-09-18T10:00:00Z",
  lastObservedAt: "2026-09-20T10:00:00Z",
  supportingSignalIds: ["signal-1", "signal-2"],
});

describe("Hunter Intelligence V2 contracts", () => {
  it("fails closed on out-of-range ranking and trend features", () => {
    expect(() => prepareOpportunityValueScores({ ...ranking, brandFit: 1.1 })).toThrow(DomainValidationError);
    expect(() => prepareTrendIntelligence({
      ...trend,
      firstObservedAt: "2026-09-21T10:00:00Z",
      lastObservedAt: "2026-09-20T10:00:00Z",
    })).toThrow("firstObservedAt cannot be after lastObservedAt");

    expect(() => prepareTrendIntelligence({
      ...trend,
      supportingSignalIds: [],
    })).toThrow("requires supporting signals");

    expect(summarizeTrendIntelligence(trend)).toMatchObject({
      trendId: "trend-1",
      stage: "rising",
      evidenceConfidence: 0.86,
    });
  });

  it("keeps Brand Preference State bounded, versioned and duplicate-safe", () => {
    const state = prepareBrandPreferenceState({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      snapshotVersion: "snapshot-7",
      longTerm: {
        topicWeights: [{ key: "EV ownership", weight: 0.9, evidenceCount: 4 }],
        audienceWeights: [{ key: "First-time EV buyers", weight: 0.85 }],
        formatWeights: [{ key: "carousel", weight: 0.8 }],
        channelWeights: [{ key: "instagram", weight: 0.8 }],
        mechanismWeights: [{ key: "diagnostic checklist", weight: 0.75 }],
      },
      shortTerm: {
        activeTopics: [{ key: "battery health", weight: 0.9 }],
        activeCampaignIds: ["campaign-1"],
        currentGoal: "Educate first-time EV buyers",
        currentChannel: "instagram",
        updatedAt: "2026-09-20T09:00:00Z",
      },
      negatives: {
        topics: [{ key: "politics", strength: 1, lastObservedAt: "2026-09-19T10:00:00Z" }],
        audiences: [],
        mechanisms: [],
        sourceClasses: [],
      },
      performanceMemory: [{
        key: "diagnostic carousel",
        dimension: "mechanism",
        weight: 0.8,
        confidence: 0.72,
        learningId: "learning-1",
      }],
      explorationBudget: 0.12,
      updatedAt: "2026-09-20T10:00:00Z",
    });

    expect(state).toMatchObject({
      schemaVersion: "1",
      brandId: "brand-1",
      explorationBudget: 0.12,
    });

    expect(() => prepareBrandPreferenceState({
      ...state,
      longTerm: {
        ...state.longTerm,
        topicWeights: [
          { key: "EV ownership", weight: 0.9 },
          { key: "ev ownership", weight: 0.8 },
        ],
      },
    })).toThrow("contains duplicate keys");

    expect(() => prepareBrandPreferenceState({ ...state, explorationBudget: 1.2 })).toThrow(DomainValidationError);
  });

  it("permits user-value objectives while rejecting manipulative engagement objectives", () => {
    const policy = prepareEEIPolicy({
      version: "eei-v1",
      optimizationObjectives: ["save", "develop", "publish", "brand-relative-performance-lift"],
      diversityFloor: 0.4,
      maximumTopicShare: 0.4,
      explorationMin: 0.05,
      explorationMax: 0.15,
      manipulationRiskBlockThreshold: 0.5,
    });

    expect(policy.optimizationObjectives).toContain("publish");
    expect(() => prepareEEIPolicy({
      ...policy,
      optimizationObjectives: ["publish", "time-in-app"],
    })).toThrow("EEI optimization objective is not allowed");

    expect(evaluateManipulationRisk({ sensitiveTraitTargeting: true }, 0.5)).toMatchObject({
      blocked: true,
      reasons: ["sensitiveTraitTargeting"],
    });

    expect(evaluateManipulationRisk({}, 0.5)).toEqual({ score: 0, blocked: false, reasons: [] });
  });

  it("requires evidence, calibrated confidence and complete ranking lineage for Opportunity Intelligence", () => {
    const opportunity = prepareOpportunityIntelligence({
      id: "opportunity-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      title: "Battery-health checks are becoming a purchase concern",
      sanitizedSummary: "Public discussion is rising around practical battery-health checks for used EV buyers.",
      whyNow: "The topic is rising across several recent sources.",
      brandReason: "The Brand teaches practical EV ownership decisions.",
      audienceReason: "The target audience includes first-time EV buyers.",
      trend: summarizeTrendIntelligence(trend),
      mechanism: {
        hookType: "diagnostic checklist",
        structure: "checklist",
        proofType: ["demonstration"],
        confidence: 0.8,
      },
      proposedAngle: "Explain five checks a buyer can perform before purchasing a used EV.",
      recommendedFormat: "carousel",
      recommendedChannel: "instagram",
      evidence: {
        signalIds: ["signal-1", "signal-2"],
        sourceCount: 2,
        independentPublisherCount: 2,
        sourceClasses: ["industry-news", "video"],
        confidence: 0.86,
        confidenceLabel: "High",
      },
      scores: ranking,
      explanation: {
        whyRecommended: "The topic aligns with Brand authority and is currently rising.",
        evidenceSummary: "Two independent public signals support the opportunity.",
        brandFitReason: "The Brand covers practical EV ownership.",
        uncertainty: "Public engagement metrics are incomplete.",
        userControl: "Dismiss or mark the recommendation irrelevant to adjust future ranking.",
      },
      provenance: {
        snapshotVersion: "snapshot-7",
        planVersion: "snapshot-7:discovery:2",
        hunterRunId: "hunter-run-1",
        rankingVersion: "hunter-v2-deterministic-1",
        eeiVersion: "eei-v1",
      },
      createdAt: "2026-09-20T10:00:00Z",
    });

    expect(opportunity).toMatchObject({
      schemaVersion: "2",
      evidence: { confidenceLabel: "High", sourceCount: 2 },
      provenance: { eeiVersion: "eei-v1" },
    });

    expect(() => prepareOpportunityIntelligence({
      ...opportunity,
      evidence: { ...opportunity.evidence, signalIds: [] },
    })).toThrow("requires supporting signals");

    expect(() => prepareOpportunityIntelligence({
      ...opportunity,
      evidence: { ...opportunity.evidence, confidence: 0.6, confidenceLabel: "High" },
    })).toThrow("confidenceLabel must be Medium");

    expect(() => prepareOpportunityIntelligence({
      ...opportunity,
      provenance: { ...opportunity.provenance, rankingVersion: "other-ranker" },
    })).toThrow("rankingVersion must match");
  });

  it("accepts only the versioned Hunter V2 feedback vocabulary", () => {
    expect(prepareOpportunityFeedbackEventV2({
      id: "feedback-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      opportunityId: "opportunity-1",
      accountId: "account-1",
      action: "not_relevant",
      surface: "discover",
      rankingVersion: "hunter-v2-deterministic-1",
      occurredAt: "2026-09-20T10:05:00Z",
      position: 2,
      reason: "Too generic",
      idempotencyKey: "feedback-1:not_relevant",
    })).toMatchObject({ schemaVersion: "2", action: "not_relevant" });

    expect(() => prepareOpportunityFeedbackEventV2({
      id: "feedback-2",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      opportunityId: "opportunity-1",
      accountId: "account-1",
      action: "keep_scrolling",
      surface: "discover",
      rankingVersion: "hunter-v2-deterministic-1",
      occurredAt: "2026-09-20T10:05:00Z",
      idempotencyKey: "feedback-2:keep_scrolling",
    })).toThrow("feedback action is not supported");
  });
});
