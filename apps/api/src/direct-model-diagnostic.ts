import type { AgentInvocationMetadata, AgentRuntimePort } from "@kairo/agent-contracts";

export interface DirectModelProviderDiagnosticMetadata {
  runtime: "direct-model";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  pricingVersion: string;
  latencyMs: number;
}

export function directModelProviderDiagnosticRequested(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.KAIRO_DIRECT_MODEL_PROVIDER_DIAGNOSTIC_RUN?.trim() === "1";
}

export async function runDirectModelProviderDiagnostic(
  runtime: AgentRuntimePort,
): Promise<DirectModelProviderDiagnosticMetadata> {
  const result = await runtime.invoke<{ ok: true }>({
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

  if (result.metadata.runtime !== "direct-model") {
    throw new Error("DirectModelRuntime provider diagnostic did not execute through DirectModelRuntime");
  }
  if (!result.output || result.output.ok !== true || Object.keys(result.output).length !== 1) {
    throw new Error("DirectModelRuntime provider diagnostic returned an invalid diagnostic output");
  }

  return safeMetadata(result.metadata);
}

function safeMetadata(metadata: AgentInvocationMetadata): DirectModelProviderDiagnosticMetadata {
  const provider = requiredText(metadata.provider, "provider");
  const model = requiredText(metadata.model, "model");
  const pricingVersion = requiredText(metadata.pricingVersion, "pricingVersion");
  const inputTokens = nonNegativeInteger(metadata.inputTokens, "inputTokens");
  const outputTokens = nonNegativeInteger(metadata.outputTokens, "outputTokens");
  const costUsd = nonNegativeNumber(metadata.costUsd, "costUsd");
  const latencyMs = nonNegativeNumber(metadata.latencyMs, "latencyMs");
  if (costUsd > 0.01) throw new Error("DirectModelRuntime provider diagnostic exceeded its $0.01 cost ceiling");
  return {
    runtime: "direct-model",
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd,
    pricingVersion,
    latencyMs,
  };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`DirectModelRuntime provider diagnostic requires ${field} metadata`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`DirectModelRuntime provider diagnostic requires non-negative integer ${field} metadata`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`DirectModelRuntime provider diagnostic requires non-negative ${field} metadata`);
  }
  return value;
}
