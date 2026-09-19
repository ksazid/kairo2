import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import {
  createMarketingSkillRegistry,
  type MarketingSkillManifest,
} from "./skill-registry";
import type { MarketingBenchmarkObservation } from "./marketing-benchmark";
import { createBrandQualificationEvidence, evaluateMarketingLabComparison } from "./marketing-lab";

const native: MarketingSkillManifest = {
  id: "kairo-native-strategy",
  version: "1.0.0",
  name: "Kairo Native Strategy",
  capabilities: ["carousel-strategy"],
  source: { kind: "kairo-native" },
  executionMode: "native",
  permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
  status: "approved",
  benchmarkStatus: "baseline",
};

const corey: MarketingSkillManifest = {
  id: "corey-social-reference",
  version: "7868cb9",
  name: "Corey Social Reference",
  capabilities: ["carousel-strategy"],
  source: {
    kind: "github",
    repository: "coreyhaines31/marketingskills",
    commitSha: "7868cb9251fad80a73d26e488a5ad5f6c4a9f335",
    path: "skills/social/SKILL.md",
    contentHash: "ab1dc1c34cb5b09a2bfb70b318a64eaab596af43",
    license: "MIT",
  },
  executionMode: "reference-only",
  permissions: { network: false, secrets: false, brandPrivateContext: false, publishing: false },
  status: "evaluation",
  benchmarkStatus: "pending",
};

function observations(stage: "offline" | "shadow" | "live" = "offline", challenger = corey): MarketingBenchmarkObservation[] {
  return Array.from({ length: 4 }, (_, index) => {
    const caseId = `case-${index}`;
    const common = {
      caseId,
      inputFingerprint: `fingerprint-${index}`,
      workspaceId: "ws-1",
      brandId: "brand-1",
      capability: "carousel-strategy" as const,
      format: "carousel" as const,
      stage,
      truthPassed: true,
    };
    return [
      {
        ...common,
        candidateSkillId: native.id,
        candidateSkillVersion: native.version,
        scores: { brandFit: 80, hookQuality: 80, originality: 80, formatQuality: 80, criticScore: 80 },
        humanPreferenceScore: stage === "offline" ? undefined : 45,
        editDistancePercent: stage === "offline" ? undefined : 20,
        latencyMs: 1_000,
        costUsd: 0.04,
        ...(stage === "live" ? { realWorldPerformance: { normalizedScore: 70, sampleSize: 12 } } : {}),
      },
      {
        ...common,
        candidateSkillId: challenger.id,
        candidateSkillVersion: challenger.version,
        scores: { brandFit: 90, hookQuality: 90, originality: 90, formatQuality: 90, criticScore: 90 },
        humanPreferenceScore: stage === "offline" ? undefined : 70,
        editDistancePercent: stage === "offline" ? undefined : 8,
        latencyMs: 1_100,
        costUsd: 0.045,
        ...(stage === "live" ? { realWorldPerformance: { normalizedScore: 82, sampleSize: 12 } } : {}),
      },
    ];
  }).flat();
}

describe("VS-14 Kairo Marketing Lab", () => {
  it("allows a pinned reference challenger in offline comparison but only advances it to shadow eligibility", () => {
    const result = evaluateMarketingLabComparison({
      registry: createMarketingSkillRegistry([native, corey]),
      baseline: { id: native.id, version: native.version },
      challenger: { id: corey.id, version: corey.version },
      observations: observations(),
    });
    expect(result.verdict).toBe("advance-to-shadow");
  });

  it("refuses to execute a reference-only challenger in shadow", () => {
    expect(() => evaluateMarketingLabComparison({
      registry: createMarketingSkillRegistry([native, corey]),
      baseline: { id: native.id, version: native.version },
      challenger: { id: corey.id, version: corey.version },
      observations: observations("shadow"),
    })).toThrow(DomainValidationError);
  });

  it("allows a separately sandbox-approved shadow candidate without making it production executable", () => {
    const shadow: MarketingSkillManifest = {
      ...corey,
      id: "corey-social-shadow",
      version: "7868cb9-shadow-1",
      executionMode: "sandboxed",
      permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
      benchmarkStatus: "shadow",
    };
    const result = evaluateMarketingLabComparison({
      registry: createMarketingSkillRegistry([native, shadow]),
      baseline: { id: native.id, version: native.version },
      challenger: { id: shadow.id, version: shadow.version },
      observations: observations("shadow", shadow),
    });
    expect(result.verdict).toBe("advance-to-live");
  });

  it("rejects unregistered challengers and capability mismatches", () => {
    expect(() => evaluateMarketingLabComparison({
      registry: createMarketingSkillRegistry([native]),
      baseline: { id: native.id, version: native.version },
      challenger: { id: corey.id, version: corey.version },
      observations: observations(),
    })).toThrow(DomainValidationError);

    const wrongCapability: MarketingSkillManifest = { ...corey, capabilities: ["copy-editing"] };
    expect(() => evaluateMarketingLabComparison({
      registry: createMarketingSkillRegistry([native, wrongCapability]),
      baseline: { id: native.id, version: native.version },
      challenger: { id: wrongCapability.id, version: wrongCapability.version },
      observations: observations(),
    })).toThrow(DomainValidationError);
  });

  it("emits Brand qualification evidence only from a fully qualified live benchmark result", () => {
    const liveCandidate: MarketingSkillManifest = {
      ...corey,
      id: "corey-social-live",
      version: "7868cb9-live-1",
      executionMode: "sandboxed",
      permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
      benchmarkStatus: "live",
    };
    const result = evaluateMarketingLabComparison({
      registry: createMarketingSkillRegistry([native, liveCandidate]),
      baseline: { id: native.id, version: native.version },
      challenger: { id: liveCandidate.id, version: liveCandidate.version },
      observations: observations("live", liveCandidate),
    });
    expect(result.verdict).toBe("qualified-for-brand");
    expect(createBrandQualificationEvidence(result)).toEqual({
      verdict: "qualified-for-brand",
      workspaceId: "ws-1",
      brandId: "brand-1",
      capability: "carousel-strategy",
      format: "carousel",
      challengerSkillId: "corey-social-live",
      challengerSkillVersion: "7868cb9-live-1",
    });

    const offline = evaluateMarketingLabComparison({
      registry: createMarketingSkillRegistry([native, corey]),
      baseline: { id: native.id, version: native.version },
      challenger: { id: corey.id, version: corey.version },
      observations: observations(),
    });
    expect(() => createBrandQualificationEvidence(offline)).toThrow(DomainValidationError);
  });
});
