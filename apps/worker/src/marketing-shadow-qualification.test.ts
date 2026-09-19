import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort, AgentRuntimeResult } from "@kairo/agent-contracts";
import type { CarouselPlan } from "@kairo/domain/creative-formats";
import {
  buildMarketingNativeObservation,
  executeKairoNativeCarouselBaseline,
  MARKETING_NATIVE_BASELINE_INSTRUCTION,
  toMotorcycleCarouselQualificationCase,
  type MotorcycleCarouselFixture,
} from "./marketing-shadow-qualification";
import {
  MARKETING_CLOSED_WORLD_TRUTH_CONTRACT_VERSION,
  MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION,
  MARKETING_SHADOW_INSTRUCTION,
  marketingShadowInputFingerprint,
} from "./marketing-shadow";

const validOutput: CarouselPlan = {
  format: "carousel",
  coverHook: "Choose for your real riding life",
  slides: [
    { headline: "Start with use", body: "Intended use changes which trade-offs matter.", supportingClaimIds: ["mc-c1"] },
    { headline: "Compare the trade-offs", body: "Comfort, price and performance preferences can matter differently.", supportingClaimIds: ["mc-c1"] },
    { headline: "No universal winner", body: "Different rider needs can lead to different choices.", supportingClaimIds: ["mc-c2"] },
  ],
  caption: "Compare the motorcycle to your real use case instead of chasing a universal winner.",
  cta: "Save this before you shortlist your next bike.",
  supportingClaimIds: ["mc-c1", "mc-c2"],
};

class CapturingRuntime implements AgentRuntimePort {
  requests: AgentInvocationRequest[] = [];
  constructor(
    private readonly includeCost = true,
    private readonly costUsd = 0.006,
  ) {}
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.requests.push(request);
    return {
      output: validOutput as TOutput,
      metadata: {
        runtime: "test-native",
        provider: "fixture",
        model: "fixture-model",
        ...(this.includeCost ? { costUsd: this.costUsd } : {}),
        latencyMs: 190,
      },
    };
  }
}

function fixtureById(id: string): MotorcycleCarouselFixture {
  const fixtureSet = JSON.parse(
    readFileSync(new URL("../../../evaluation/marketing-lab/benchmark-cases.json", import.meta.url), "utf8"),
  ) as { cases: MotorcycleCarouselFixture[] };
  return fixtureSet.cases.find((item) => item.id === id)!;
}

function motorcycleFixture(): MotorcycleCarouselFixture {
  return fixtureById("motorcycle-carousel-01");
}

describe("VS-23 qualification baseline harness", () => {
  it("transforms the approved fixture into the fixed synthetic shadow scope", () => {
    const benchmarkCase = toMotorcycleCarouselQualificationCase(motorcycleFixture());
    expect(benchmarkCase.workspaceId).toBe("workspace-marketing-lab");
    expect(benchmarkCase.brandId).toBe("brand-motorcycle-synth");
    expect(benchmarkCase.capability).toBe("carousel-strategy");
    expect(benchmarkCase.format).toBe("carousel");
    expect(benchmarkCase.dataClassification).toBe("synthetic");
    expect(benchmarkCase.requiredClaimIds).toEqual(["mc-c1", "mc-c2"]);
    expect(benchmarkCase.claims.every((claim) => claim.evidenceRefs[0]?.startsWith("fixture://"))).toBe(true);
  });

  it("runs Kairo Native with zero tools and the same benchmark fingerprint contract as shadow", async () => {
    const benchmarkCase = toMotorcycleCarouselQualificationCase(motorcycleFixture());
    const runtime = new CapturingRuntime();
    const execution = await executeKairoNativeCarouselBaseline(runtime, benchmarkCase);
    expect(execution.inputFingerprint).toBe(marketingShadowInputFingerprint(benchmarkCase));
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]!.task.instruction).toBe(MARKETING_NATIVE_BASELINE_INSTRUCTION);
    expect(runtime.requests[0]!.capabilities).toEqual([]);
    expect(runtime.requests[0]!.budget.maxToolCalls).toBe(0);
    expect(runtime.requests[0]!.budget.maxCostUsd).toBe(0.03);
    expect(runtime.requests[0]!.budget.timeoutMs).toBe(30_000);
  });

  it("applies the exact same closed-world Truth contract to Native and Corey lanes", () => {
    expect(MARKETING_CLOSED_WORLD_TRUTH_CONTRACT_VERSION).toBe("closed-world-claims-v1");
    expect(MARKETING_NATIVE_BASELINE_INSTRUCTION).toContain(MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION);
    expect(MARKETING_SHADOW_INSTRUCTION).toContain(MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION);
    expect(MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION).toContain("technical, mechanical, performance");
    expect(MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION).toContain("question, comparison criterion, or thing to verify");
  });

  it("keeps case 03 fixture claims unchanged while applying the new shared fingerprint contract", () => {
    const fixture = fixtureById("motorcycle-carousel-03");
    expect(fixture.claims).toEqual([
      { id: "mc3-c1", text: "Daily commuting can emphasize routine usability, comfort and carrying needs." },
      { id: "mc3-c2", text: "Recreational riding can emphasize different preferences and trade-offs from daily commuting." },
    ]);
    const benchmarkCase = toMotorcycleCarouselQualificationCase(fixture);
    const fingerprint = marketingShadowInputFingerprint(benchmarkCase);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to manufacture cost evidence when the runtime did not measure cost", async () => {
    const benchmarkCase = toMotorcycleCarouselQualificationCase(motorcycleFixture());
    const execution = await executeKairoNativeCarouselBaseline(new CapturingRuntime(false), benchmarkCase);
    expect(() => buildMarketingNativeObservation(execution, {
      truthPassed: true,
      scores: { brandFit: 80, hookQuality: 80, originality: 80, formatQuality: 80, criticScore: 80 },
    })).toThrow(/measured runtime cost/i);
  });

  it("builds a shadow-stage native observation only from supplied evaluation evidence", async () => {
    const benchmarkCase = toMotorcycleCarouselQualificationCase(motorcycleFixture());
    const execution = await executeKairoNativeCarouselBaseline(new CapturingRuntime(true, 0.006), benchmarkCase);
    const observation = buildMarketingNativeObservation(execution, {
      truthPassed: true,
      scores: { brandFit: 80, hookQuality: 76, originality: 72, formatQuality: 84, criticScore: 86 },
      humanPreferenceScore: 74,
      editDistancePercent: 20,
    });
    expect(observation.stage).toBe("shadow");
    expect(observation.candidateSkillId).toBe("kairo-native-carousel");
    expect(observation.candidateSkillVersion).toBe("1");
    expect(observation.costUsd).toBe(0.006);
    expect(observation.latencyMs).toBe(190);
  });
});
