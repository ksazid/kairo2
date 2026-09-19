import { describe, expect, it } from "vitest";
import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  AgentRuntimeResult,
} from "@kairo/agent-contracts";
import type { CarouselPlan } from "@kairo/domain/creative-formats";
import {
  evaluateMarketingShadowPair,
  MARKETING_SHADOW_QUALITY_EVALUATOR_INSTRUCTION,
  validateMarketingShadowPairQualityEvaluation,
} from "./marketing-shadow-quality-evaluator";
import type { MarketingShadowBenchmarkCase } from "./marketing-shadow";

const benchmarkCase: MarketingShadowBenchmarkCase = {
  datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
  dataClassification: "synthetic",
  caseId: "motorcycle-carousel-01",
  workspaceId: "workspace-marketing-lab",
  brandId: "brand-motorcycle-synth",
  capability: "carousel-strategy",
  format: "carousel",
  objective: "Structure a buyer comparison around actual use case rather than declaring one engine class universally best.",
  audience: "enthusiast buyers",
  claims: [
    { id: "mc-c1", statement: "Motorcycle purchase decisions can involve comfort, price, intended use and performance preferences.", evidenceRefs: ["fixture://mc-c1"] },
    { id: "mc-c2", statement: "A comparison should distinguish rider needs instead of assuming a universal winner.", evidenceRefs: ["fixture://mc-c2"] },
  ],
  requiredClaimIds: ["mc-c1", "mc-c2"],
  prohibitedPatterns: ["guaranteed result"],
};

const candidateA: CarouselPlan = {
  format: "carousel",
  coverHook: "Choose for your riding needs",
  slides: [
    { headline: "Comfort", body: "Compare comfort preferences.", supportingClaimIds: ["mc-c1"] },
    { headline: "Use", body: "Match the bike to intended use.", supportingClaimIds: ["mc-c1"] },
    { headline: "Trade-offs", body: "Different rider needs can lead to different choices.", supportingClaimIds: ["mc-c2"] },
  ],
  caption: "Compare comfort, use and preferences without assuming one universal winner.",
  cta: "Save your shortlist criteria.",
  supportingClaimIds: ["mc-c1", "mc-c2"],
};

const candidateB: CarouselPlan = {
  format: "carousel",
  coverHook: "Start with your actual use case",
  slides: [
    { headline: "Your priorities", body: "Comfort, price and performance preferences can differ.", supportingClaimIds: ["mc-c1"] },
    { headline: "Your use", body: "Intended use can shape the comparison.", supportingClaimIds: ["mc-c1"] },
    { headline: "No universal winner", body: "Distinguish rider needs before choosing.", supportingClaimIds: ["mc-c2"] },
  ],
  caption: "Use rider needs and intended use to structure the comparison.",
  cta: "Compare your priorities.",
  supportingClaimIds: ["mc-c1", "mc-c2"],
};

const validEvaluation = {
  candidateA: {
    truthPassed: true,
    scores: { brandFit: 82, hookQuality: 78, originality: 70, formatQuality: 84, criticScore: 80 },
    reasons: ["Grounded in the supplied comparison Claims."],
  },
  candidateB: {
    truthPassed: false,
    scores: { brandFit: 80, hookQuality: 84, originality: 75, formatQuality: 86, criticScore: 72 },
    reasons: ["Includes an unsupported technical detail not entailed by the supplied Claims."],
  },
};

class CapturingRuntime implements AgentRuntimePort {
  requests: AgentInvocationRequest[] = [];
  constructor(private readonly output: unknown = validEvaluation) {}
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.requests.push(request);
    return {
      output: this.output as TOutput,
      metadata: {
        runtime: "direct-model",
        provider: "groq",
        model: "openai/gpt-oss-120b",
        inputTokens: 500,
        outputTokens: 250,
        costUsd: 0.0002,
        pricingVersion: "test-pricing",
        latencyMs: 850,
      },
    };
  }
}

describe("VS-65 Marketing Lab quality evaluator", () => {
  it("uses a blind zero-tool critic request with the same rubric for A and B", async () => {
    const runtime = new CapturingRuntime();
    const result = await evaluateMarketingShadowPair(runtime, { benchmarkCase, candidateA, candidateB });
    const request = runtime.requests[0]!;

    expect(request.role).toBe("critic");
    expect(request.scope).toEqual({ visibility: "global-public" });
    expect(request.capabilities).toEqual([]);
    expect(request.budget).toEqual({ maxOutputTokens: 1800, maxToolCalls: 0, maxCostUsd: 0.03, timeoutMs: 30000 });
    expect(request.outputSchema).toEqual({ name: "marketing-pair-quality-evaluation", version: "1" });
    expect(request.task.instruction).toBe(MARKETING_SHADOW_QUALITY_EVALUATOR_INSTRUCTION);

    const serializedContext = JSON.stringify(request.task.context);
    expect(serializedContext).toContain("candidateA");
    expect(serializedContext).toContain("candidateB");
    expect(serializedContext).not.toContain("kairo-native-carousel");
    expect(serializedContext).not.toContain("corey-social-shadow");
    expect(serializedContext).not.toContain("candidateSkillId");

    expect(result.candidateA.truthPassed).toBe(true);
    expect(result.candidateB.truthPassed).toBe(false);
    expect(result.provenance).toMatchObject({
      runtime: "direct-model",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      costUsd: 0.0002,
      latencyMs: 850,
    });
  });

  it("makes unsupported factual details an explicit Truth failure rule", () => {
    expect(MARKETING_SHADOW_QUALITY_EVALUATOR_INSTRUCTION).toContain("truthPassed MUST be false");
    expect(MARKETING_SHADOW_QUALITY_EVALUATOR_INSTRUCTION).toContain("not directly entailed by the supplied benchmark Claims");
    expect(MARKETING_SHADOW_QUALITY_EVALUATOR_INSTRUCTION).toContain("exact same 0-100 rubric");
  });

  it("fails closed on missing or out-of-range quality evidence", () => {
    expect(() => validateMarketingShadowPairQualityEvaluation({
      ...validEvaluation,
      candidateA: {
        ...validEvaluation.candidateA,
        scores: { ...validEvaluation.candidateA.scores, originality: 101 },
      },
    })).toThrow(/between 0 and 100/);

    expect(() => validateMarketingShadowPairQualityEvaluation({
      ...validEvaluation,
      candidateB: { ...validEvaluation.candidateB, reasons: [] },
    })).toThrow(/reasons/);
  });

  it("refuses candidate outputs that escaped benchmark Claim lineage", async () => {
    const runtime = new CapturingRuntime();
    const invalid = { ...candidateA, supportingClaimIds: ["mc-c1", "mc-c2", "outside-claim"] } as CarouselPlan;
    await expect(evaluateMarketingShadowPair(runtime, { benchmarkCase, candidateA: invalid, candidateB }))
      .rejects.toThrow(/outside the benchmark case/);
    expect(runtime.requests).toHaveLength(0);
  });

  it("rejects malformed evaluator metadata instead of weakening provenance", async () => {
    const runtime: AgentRuntimePort = {
      async invoke<TOutput>() {
        return { output: validEvaluation as TOutput, metadata: { runtime: "direct-model", latencyMs: -1 } };
      },
    };
    await expect(evaluateMarketingShadowPair(runtime, { benchmarkCase, candidateA, candidateB }))
      .rejects.toThrow(/latency metadata/);
  });
});
