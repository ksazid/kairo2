import { describe, expect, it } from "vitest";
import { createMarketingSkillRegistry, canExecuteMarketingSkill, type MarketingSkillManifest } from "@kairo/domain/skill-registry";
import { DEFAULT_MARKETING_BENCHMARK_POLICY, type MarketingBenchmarkObservation } from "@kairo/domain/marketing-benchmark";
import { evaluateMarketingShadowComparison } from "./marketing-shadow-comparison";

const baseline: MarketingSkillManifest = {
  id: "kairo-native-carousel",
  version: "1",
  name: "Kairo Native Carousel",
  capabilities: ["carousel-strategy"],
  source: { kind: "kairo-native" },
  executionMode: "native",
  permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
  status: "approved",
  benchmarkStatus: "baseline",
};
const challenger: MarketingSkillManifest = {
  id: "corey-social-shadow",
  version: "2.2.0+7868cb9",
  name: "Corey Social Strategy Shadow",
  capabilities: ["carousel-strategy"],
  source: { kind: "github", repository: "coreyhaines31/marketingskills", commitSha: "7868cb9251fad80a73d26e488a5ad5f6c4a9f335", path: "skills/social/SKILL.md", contentHash: "ab1d083ef4a9dd2a91c1eaedfb5cb745c3055d24", license: "MIT" },
  executionMode: "sandboxed",
  permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
  status: "evaluation",
  benchmarkStatus: "shadow",
};
const registry = createMarketingSkillRegistry([baseline, challenger]);
const policy = { ...DEFAULT_MARKETING_BENCHMARK_POLICY, minPairedCases: 1 };

function observation(skill: MarketingSkillManifest, quality: number, human: number, edit: number, truthPassed = true): MarketingBenchmarkObservation {
  return {
    caseId: "fixture-carousel-01",
    inputFingerprint: "same-input-fingerprint",
    workspaceId: "workspace-marketing-lab",
    brandId: "brand-fixture-synth",
    capability: "carousel-strategy",
    format: "carousel",
    stage: "shadow",
    candidateSkillId: skill.id,
    candidateSkillVersion: skill.version,
    truthPassed,
    scores: { brandFit: quality, hookQuality: quality, originality: quality, formatQuality: quality, criticScore: quality },
    humanPreferenceScore: human,
    editDistancePercent: edit,
    latencyMs: skill.id === baseline.id ? 500 : 550,
    costUsd: skill.id === baseline.id ? 0.01 : 0.012,
  };
}

describe("VS-19 paired shadow comparison", () => {
  it("can advance a materially better shadow challenger only to live eligibility", () => {
    const result = evaluateMarketingShadowComparison({
      registry,
      baseline: { id: baseline.id, version: baseline.version },
      challenger: { id: challenger.id, version: challenger.version },
      observations: [observation(baseline, 70, 70, 20), observation(challenger, 82, 82, 18)],
      policy,
    });
    expect(result.verdict).toBe("advance-to-live");
    expect(canExecuteMarketingSkill(challenger)).toBe(false);
  });

  it("rejects the challenger on a truth failure regardless of marketing quality", () => {
    const result = evaluateMarketingShadowComparison({
      registry,
      baseline: { id: baseline.id, version: baseline.version },
      challenger: { id: challenger.id, version: challenger.version },
      observations: [observation(baseline, 70, 70, 20), observation(challenger, 95, 95, 10, false)],
      policy,
    });
    expect(result.verdict).toBe("reject-challenger");
  });

  it("refuses live or mixed-stage evidence in the VS-19 shadow path", () => {
    const live = { ...observation(challenger, 82, 82, 18), stage: "live" as const };
    expect(() => evaluateMarketingShadowComparison({
      registry,
      baseline: { id: baseline.id, version: baseline.version },
      challenger: { id: challenger.id, version: challenger.version },
      observations: [observation(baseline, 70, 70, 20), live],
      policy,
    })).toThrow(/shadow/i);
  });
});
