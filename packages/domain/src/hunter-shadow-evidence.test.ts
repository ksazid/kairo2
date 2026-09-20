import { describe, expect, it } from "vitest";
import {
  HUNTER_SHADOW_EVIDENCE_SCHEMA_VERSION,
  prepareHunterShadowEvidence,
  type HunterShadowEvidencePair,
} from "./hunter-shadow-evidence";

function sample(overrides: Partial<HunterShadowEvidencePair> = {}): HunterShadowEvidencePair {
  return {
    schemaVersion: HUNTER_SHADOW_EVIDENCE_SCHEMA_VERSION,
    comparisonId: "shadow-001",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    control: {
      workspaceId: "workspace-1",
      brandId: "brand-1",
      qualityScore: 0.78,
      latencyMs: 1000,
      costUsd: 0.08,
    },
    candidate: {
      workspaceId: "workspace-1",
      brandId: "brand-1",
      qualityScore: 0.84,
      latencyMs: 1200,
      costUsd: 0.1,
      retrievalExpected: 10,
      retrievalCovered: 9,
      failed: false,
      explorationRecommendations: 1,
      totalRecommendations: 10,
      recommendationTopics: [
        "agents", "agents", "cloud", "security", "architecture",
        "startups", "cloud", "career", "platform", "ai",
      ],
      tenantIsolationVerified: true,
      manipulationSafetyVerified: true,
      provenanceComplete: true,
      persistenceAttempted: false,
      productionGuardIntact: true,
    },
    ...overrides,
  };
}

describe("Hunter shadow evidence", () => {
  it("derives the rollout observation deterministically from paired control and candidate evidence", () => {
    const result = prepareHunterShadowEvidence(sample());

    expect(result.observation).toMatchObject({
      runId: "shadow-001",
      brandId: "brand-1",
      v1QualityScore: 0.78,
      v2QualityScore: 0.84,
      retrievalCoverage: 0.9,
      v1LatencyMs: 1000,
      v2LatencyMs: 1200,
      v1CostUsd: 0.08,
      v2CostUsd: 0.1,
      v2Failure: false,
      explorationShare: 0.1,
      maximumTopicShare: 0.2,
    });
    expect(result.observation.criticalViolations).toBeUndefined();
  });

  it("fails closed by translating authority, safety and provenance failures into critical violations", () => {
    const value = sample({
      candidate: {
        ...sample().candidate,
        workspaceId: "other-workspace",
        tenantIsolationVerified: false,
        manipulationSafetyVerified: false,
        provenanceComplete: false,
        persistenceAttempted: true,
        productionGuardIntact: false,
      },
    });

    const result = prepareHunterShadowEvidence(value);
    expect(result.observation.criticalViolations).toEqual([
      "evidence-provenance",
      "manipulation-safety",
      "persistence-authority",
      "production-guard-bypass",
      "tenant-isolation",
    ]);
  });

  it("computes concentration from the actual recommendation topics", () => {
    const value = sample({
      candidate: {
        ...sample().candidate,
        explorationRecommendations: 2,
        totalRecommendations: 4,
        recommendationTopics: ["ai", "ai", "ai", "cloud"],
      },
    });

    const result = prepareHunterShadowEvidence(value);
    expect(result.observation.explorationShare).toBe(0.5);
    expect(result.observation.maximumTopicShare).toBe(0.75);
  });

  it("keeps empty recommendation output measurable and rollout-blocking rather than fabricating success", () => {
    const value = sample({
      candidate: {
        ...sample().candidate,
        totalRecommendations: 0,
        explorationRecommendations: 0,
        recommendationTopics: [],
      },
    });

    const result = prepareHunterShadowEvidence(value);
    expect(result.observation.explorationShare).toBe(0);
    expect(result.observation.maximumTopicShare).toBe(0);
  });

  it("rejects impossible retrieval and recommendation counts", () => {
    expect(() => prepareHunterShadowEvidence(sample({
      candidate: {
        ...sample().candidate,
        retrievalExpected: 4,
        retrievalCovered: 5,
      },
    }))).toThrow(/retrievalCovered/);

    expect(() => prepareHunterShadowEvidence(sample({
      candidate: {
        ...sample().candidate,
        totalRecommendations: 2,
        explorationRecommendations: 3,
        recommendationTopics: ["ai", "cloud"],
      },
    }))).toThrow(/explorationRecommendations/);
  });
});
