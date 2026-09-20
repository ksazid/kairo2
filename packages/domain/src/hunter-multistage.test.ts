import { describe, expect, it } from "vitest";
import {
  HUNTER_DEEP_INTELLIGENCE_VERSION,
  prepareHunterDeepAnalysisResult,
  scoreHunterPreRank,
} from "./hunter-multistage";

describe("Hunter multi-stage contracts", () => {
  it("renormalizes positive weights when optional signals are unknown", () => {
    const withoutOptional = scoreHunterPreRank("trend-1", {
      topicFit: 0.8,
      evidenceStrength: 0.8,
      freshness: 0.8,
      trendMomentum: 0.8,
      sourceDiversity: 0.8,
      saturationPenalty: 0,
    });
    const withEquivalentOptional = scoreHunterPreRank("trend-1", {
      brandSemanticSimilarity: 0.8,
      topicFit: 0.8,
      evidenceStrength: 0.8,
      freshness: 0.8,
      trendMomentum: 0.8,
      sourceDiversity: 0.8,
      preferenceAffinity: 0.8,
      saturationPenalty: 0,
      duplicationPenalty: 0,
      hardNegativeSimilarity: 0,
    });

    expect(withoutOptional.positiveScore).toBeCloseTo(0.8, 8);
    expect(withEquivalentOptional.positiveScore).toBeCloseTo(0.8, 8);
    expect(withoutOptional.unknownFeatures).toEqual([
      "brandSemanticSimilarity",
      "preferenceAffinity",
      "duplicationPenalty",
      "hardNegativeSimilarity",
    ]);
  });

  it("applies explicit penalties without renormalizing them upward", () => {
    const clean = scoreHunterPreRank("trend-1", {
      brandSemanticSimilarity: 1,
      topicFit: 1,
      evidenceStrength: 1,
      freshness: 1,
      trendMomentum: 1,
      sourceDiversity: 1,
      preferenceAffinity: 1,
      saturationPenalty: 0,
      duplicationPenalty: 0,
      hardNegativeSimilarity: 0,
    });
    const risky = scoreHunterPreRank("trend-1", {
      brandSemanticSimilarity: 1,
      topicFit: 1,
      evidenceStrength: 1,
      freshness: 1,
      trendMomentum: 1,
      sourceDiversity: 1,
      preferenceAffinity: 1,
      saturationPenalty: 1,
      duplicationPenalty: 1,
      hardNegativeSimilarity: 1,
    });

    expect(clean.overall).toBe(1);
    expect(risky.penaltyScore).toBeCloseTo(0.38, 8);
    expect(risky.overall).toBeCloseTo(0.62, 8);
  });

  it("validates deep intelligence output", () => {
    const result = prepareHunterDeepAnalysisResult({
      version: HUNTER_DEEP_INTELLIGENCE_VERSION,
      candidateId: "trend-1",
      mechanism: {
        hookType: "diagnostic checklist",
        structure: "checklist",
        confidence: 0.8,
      },
      brandReason: "The topic is directly inside the Brand's approved authority area.",
      audienceReason: "The target audience repeatedly needs a practical pre-purchase check.",
      whyNow: "Several independent sources are discussing the issue this week.",
      contentGap: "Most sources describe the problem without a concise buyer checklist.",
      proposedAngle: "A five-step battery-health check before buying a used EV.",
      originality: 0.75,
      actionability: 0.9,
      confidence: 0.82,
    });

    expect(result.mechanism?.hookType).toBe("diagnostic checklist");
    expect(result.actionability).toBe(0.9);
  });
});
