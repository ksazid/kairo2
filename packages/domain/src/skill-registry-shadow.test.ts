import { describe, expect, it } from "vitest";
import { canExecuteMarketingSkill, canRunMarketingSkillInBenchmark, type MarketingSkillManifest } from "./skill-registry";

function sandboxedShadowCandidate(): MarketingSkillManifest {
  return {
    id: "future-shadow-candidate",
    version: "2.0.0",
    name: "Future Shadow Candidate",
    capabilities: ["reel-strategy"],
    source: { kind: "future", provider: "benchmark-lab", version: "2.0.0" },
    executionMode: "sandboxed",
    permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
    status: "evaluation",
    benchmarkStatus: "shadow",
  };
}

describe("VS-14 benchmark execution boundary", () => {
  it("separates sandboxed benchmark execution from production Brand execution", () => {
    const candidate = sandboxedShadowCandidate();
    expect(canRunMarketingSkillInBenchmark(candidate, "shadow")).toBe(true);
    expect(canExecuteMarketingSkill(candidate)).toBe(false);
  });

  it("does not let a shadow-stage candidate run as a live benchmark candidate", () => {
    expect(canRunMarketingSkillInBenchmark(sandboxedShadowCandidate(), "live")).toBe(false);
  });
});
