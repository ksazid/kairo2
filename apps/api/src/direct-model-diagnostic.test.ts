import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort } from "@kairo/agent-contracts";
import {
  directModelProviderDiagnosticRequested,
  runDirectModelProviderDiagnostic,
} from "./direct-model-diagnostic";

describe("DirectModelRuntime provider diagnostic", () => {
  it("is disabled unless the one-shot flag is exactly 1", () => {
    expect(directModelProviderDiagnosticRequested({})).toBe(false);
    expect(directModelProviderDiagnosticRequested({ KAIRO_DIRECT_MODEL_PROVIDER_DIAGNOSTIC_RUN: "0" })).toBe(false);
    expect(directModelProviderDiagnosticRequested({ KAIRO_DIRECT_MODEL_PROVIDER_DIAGNOSTIC_RUN: "1" })).toBe(true);
  });

  it("uses one synthetic global-public zero-tool invocation and returns safe metadata only", async () => {
    let captured: AgentInvocationRequest | undefined;
    let invocationCount = 0;
    const runtime: AgentRuntimePort = {
      async invoke<TOutput>(request: AgentInvocationRequest) {
        invocationCount += 1;
        captured = request;
        return {
          output: { ok: true } as TOutput,
          metadata: {
            runtime: "direct-model",
            provider: "groq",
            model: "openai/gpt-oss-120b",
            inputTokens: 12,
            outputTokens: 6,
            costUsd: 0.00001,
            pricingVersion: "test-pricing",
            latencyMs: 120,
          },
        };
      },
    };

    const metadata = await runDirectModelProviderDiagnostic(runtime);

    expect(invocationCount).toBe(1);
    expect(captured).toEqual({
      role: "judge",
      scope: { visibility: "global-public" },
      approvedContextVersion: "direct-model-provider-diagnostic@1",
      capabilities: [],
      task: {
        instruction: "Return exactly one JSON object with exactly one field named ok set to true. Do not add any other fields or commentary.",
        context: { purpose: "direct-model-provider-diagnostic" },
      },
      outputSchema: { name: "direct-model-diagnostic", version: "1" },
      budget: { maxOutputTokens: 128, maxToolCalls: 0, maxCostUsd: 0.01, timeoutMs: 30_000 },
    });
    expect(metadata).toEqual({
      runtime: "direct-model",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      inputTokens: 12,
      outputTokens: 6,
      costUsd: 0.00001,
      pricingVersion: "test-pricing",
      latencyMs: 120,
    });
    expect(metadata).not.toHaveProperty("output");
  });

  it("fails closed if the invocation did not execute through DirectModelRuntime", async () => {
    const runtime: AgentRuntimePort = {
      async invoke<TOutput>() {
        return {
          output: { ok: true } as TOutput,
          metadata: { runtime: "hermes", latencyMs: 5 },
        };
      },
    };

    await expect(runDirectModelProviderDiagnostic(runtime)).rejects.toThrow(/DirectModelRuntime/i);
  });
});
