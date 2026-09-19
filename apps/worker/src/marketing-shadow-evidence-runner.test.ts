import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort } from "@kairo/agent-contracts";
import type { CarouselPlan } from "@kairo/domain/creative-formats";
import {
  createMarketingEvidenceLanePacer,
  MARKETING_EVIDENCE_HERMES_READY_DEADLINE_MS,
  MARKETING_EVIDENCE_HERMES_READY_POLL_DELAY_MS,
  MARKETING_EVIDENCE_INTER_LANE_DELAY_MS,
  marketingEvidenceFailureCode,
  marketingEvidenceRuntimeRoute,
  runMarketingShadowPairedEvidence,
  waitForMarketingEvidenceHermesReady,
} from "./marketing-shadow-evidence-runner";

let runtimeCalls = 0;
const runtime: AgentRuntimePort = {
  async invoke<TOutput>(request: AgentInvocationRequest) {
    runtimeCalls += 1;
    const benchmarkCase = request.task.context.benchmarkCase as {
      claims: Array<{ id: string }>;
      requiredClaimIds: string[];
    };
    const ids = benchmarkCase.requiredClaimIds;
    const output: CarouselPlan = {
      format: "carousel",
      coverHook: "Choose for your use case",
      slides: [
        { headline: "Start with your needs", body: "Compare the trade-offs that matter to you.", supportingClaimIds: ids },
        { headline: "Avoid universal winners", body: "Different riders can prioritize different things.", supportingClaimIds: ids },
        { headline: "Save your checklist", body: "Use the supplied considerations before deciding.", supportingClaimIds: ids },
      ],
      caption: "A claim-linked comparison checklist.",
      cta: "Save this for your comparison.",
      supportingClaimIds: ids,
    };
    return {
      output: output as TOutput,
      metadata: {
        runtime: "direct-model",
        provider: "test-provider",
        model: "test-model",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.001,
        pricingVersion: "test-pricing",
        latencyMs: 5,
      },
    };
  },
};

describe("VS-23 paired shadow evidence runner", () => {
  it("fails closed on a tampered Corey snapshot before any paced model lane with bounded provenance", async () => {
    runtimeCalls = 0;
    const pauses: number[] = [];
    const fakeFetch: typeof fetch = async () => new Response("tampered skill", { status: 200 });
    const failure = await runMarketingShadowPairedEvidence(runtime, fakeFetch, async (ms) => { pauses.push(ms); })
      .then(() => undefined, (error) => error as { code?: string });
    expect(failure?.code).toBe("run.corey.snapshot.marketing_shadow_execution_error");
    expect(runtimeCalls).toBe(0);
    expect(pauses).toEqual([]);
  });

  it("fails closed when the pinned Corey source cannot be fetched and records only the HTTP class", async () => {
    const fakeFetch: typeof fetch = async () => new Response("missing", { status: 503 });
    const failure = await runMarketingShadowPairedEvidence(runtime, fakeFetch)
      .then(() => undefined, (error) => error as { code?: string });
    expect(failure?.code).toBe("run.corey.snapshot.http_503");
  });

  it("produces bounded case/lane/stage codes without raw exception messages", () => {
    const error = Object.assign(new Error("provider body must never be persisted"), { code: "marketing_shadow_execution_error" });
    expect(marketingEvidenceFailureCode("motorcycle-carousel-02", "corey", "execute", error))
      .toBe("mc02.corey.execute.marketing_shadow_execution_error");
    expect(marketingEvidenceFailureCode("motorcycle-carousel-04", "native", "metadata", new Error("sensitive detail")))
      .toBe("mc04.native.metadata.error");
  });

  it("keeps probing dormant Hermes readiness utility until a cold runtime becomes ready inside the deadline", async () => {
    let now = 0;
    let calls = 0;
    const pauses: number[] = [];
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return new Response("", { status: calls < 4 ? 502 : 200 });
    };

    await waitForMarketingEvidenceHermesReady(
      "https://hermes.example",
      fakeFetch,
      async (ms) => {
        pauses.push(ms);
        now += ms;
      },
      () => now,
    );

    expect(calls).toBe(4);
    expect(pauses).toEqual(Array(3).fill(MARKETING_EVIDENCE_HERMES_READY_POLL_DELAY_MS));
  });

  it("keeps the dormant Hermes readiness utility bounded without model execution", async () => {
    let now = 0;
    let calls = 0;
    const pauses: number[] = [];
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return new Response("", { status: 502 });
    };

    await expect(waitForMarketingEvidenceHermesReady(
      "https://hermes.example",
      fakeFetch,
      async (ms) => {
        pauses.push(ms);
        now += ms;
      },
      () => now,
    )).rejects.toThrow(/502/);

    expect(calls).toBeGreaterThan(6);
    expect(pauses.reduce((total, value) => total + value, 0)).toBe(MARKETING_EVIDENCE_HERMES_READY_DEADLINE_MS);
    expect(runtimeCalls).toBe(0);
  });

  it("paces eight sequential qualification lanes with seven fixed provider-window gaps", async () => {
    const pauses: number[] = [];
    const invoke = createMarketingEvidenceLanePacer(async (ms) => { pauses.push(ms); });
    for (let index = 0; index < 8; index += 1) await invoke(async () => index);
    expect(pauses).toEqual(Array(7).fill(MARKETING_EVIDENCE_INTER_LANE_DELAY_MS));
    expect(MARKETING_EVIDENCE_INTER_LANE_DELAY_MS).toBe(65_000);
  });

  it("requires an explicit DirectModel provider/model/pricing route for qualification evidence", () => {
    expect(marketingEvidenceRuntimeRoute({
      runtime: "direct-model",
      provider: "test-provider",
      model: "test-model",
      pricingVersion: "test-pricing",
      latencyMs: 1,
    }, "case:native")).toEqual({
      runtime: "direct-model",
      provider: "test-provider",
      model: "test-model",
      pricingVersion: "test-pricing",
    });

    expect(() => marketingEvidenceRuntimeRoute({
      runtime: "hermes",
      runtimeVersion: "hermes-agent@test",
      provider: "test-provider",
      model: "test-model",
      pricingVersion: "test-pricing",
      latencyMs: 1,
    }, "case:native")).toThrow(/DirectModel runtime evidence/i);

    expect(() => marketingEvidenceRuntimeRoute({
      runtime: "direct-model",
      provider: "test-provider",
      model: "test-model",
      latencyMs: 1,
    }, "case:native")).toThrow(/pricingVersion metadata/i);
  });
});