import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleModelGateway, openAICompatibleGatewayFromEnv } from "./model-gateway";

const request = {
  role: "hunter" as const,
  scope: { visibility: "global-public" as const },
  policy: {
    qualityTier: "balanced" as const,
    privacyClass: "global-public" as const,
    maxCostUsd: 0.05,
    maxOutputTokens: 500,
    allowedProviders: ["openai"],
  },
  input: "Rank these public signals.",
  outputSchema: { name: "hunter-ranking", version: "1" },
};

const pricing = {
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 8,
  version: "provider-pricing-2026-08-15",
};

function successResponse() {
  return new Response(JSON.stringify({
    model: "test-model-2026-08-01",
    choices: [{ message: { content: JSON.stringify({ accepted: true }) } }],
    usage: { prompt_tokens: 1_000, completion_tokens: 500 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("OpenAICompatibleModelGateway", () => {
  it("keeps the API key in the transport header only and records configured token cost", async () => {
    const apiKey = "test-secret-key";
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const serializedBody = String(init?.body ?? "");
      expect(serializedBody).not.toContain(apiKey);
      expect(JSON.stringify(request)).not.toContain(apiKey);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
      return successResponse();
    });

    const gateway = new OpenAICompatibleModelGateway({
      provider: "openai",
      baseUrl: "https://models.example.test/v1",
      apiKey,
      model: "test-model",
      pricing,
      fetchImpl,
    });

    const result = await gateway.generate<{ accepted: boolean }>(request);
    expect(result.output).toEqual({ accepted: true });
    expect(result.metadata).toMatchObject({
      provider: "openai",
      model: "test-model-2026-08-01",
      inputTokens: 1_000,
      outputTokens: 500,
      costUsd: 0.006,
      pricingVersion: "provider-pricing-2026-08-15",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a provider 429 and honors Retry-After within the bounded delay", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn(async (_ms: number) => undefined);
    const gateway = new OpenAICompatibleModelGateway({
      provider: "openai", baseUrl: "https://models.example.test/v1", apiKey: "secret", model: "test-model", pricing,
      fetchImpl, sleep, maxAttempts: 3, maxRetryDelayMs: 5_000,
    });

    await expect(gateway.generate(request)).resolves.toMatchObject({ output: { accepted: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("stops retrying after the configured bound", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const gateway = new OpenAICompatibleModelGateway({
      provider: "openai", baseUrl: "https://models.example.test/v1", apiKey: "secret", model: "test-model", pricing,
      fetchImpl, sleep, maxAttempts: 3,
    });

    await expect(gateway.generate(request)).rejects.toThrow(/returned 429/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient provider 4xx responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const gateway = new OpenAICompatibleModelGateway({
      provider: "openai", baseUrl: "https://models.example.test/v1", apiKey: "secret", model: "test-model", pricing,
      fetchImpl, sleep,
    });

    await expect(gateway.generate(request)).rejects.toMatchObject({ message: expect.stringMatching(/returned 400/), kind: "invalid-response", statusCode: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("classifies exhausted rate limits without exposing provider response bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response("private provider detail", { status: 429 }));
    const gateway = new OpenAICompatibleModelGateway({
      provider: "openai", baseUrl: "https://models.example.test/v1", apiKey: "secret", model: "test-model", pricing,
      fetchImpl, sleep: async () => undefined, maxAttempts: 1,
    });

    await expect(gateway.generate(request)).rejects.toMatchObject({ message: "Model provider returned 429", kind: "rate-limited" });
  });

  it("records a defensible zero cost when configured rates are zero", async () => {
    const gateway = new OpenAICompatibleModelGateway({
      provider: "ollama",
      baseUrl: "https://local-model.example.test/v1",
      apiKey: "local-placeholder",
      model: "local-model",
      pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, version: "local-zero-cost-v1" },
      fetchImpl: async () => new Response(JSON.stringify({
        model: "local-model",
        choices: [{ message: { content: JSON.stringify({ accepted: true }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    const result = await gateway.generate<{ accepted: boolean }>({
      ...request,
      policy: { ...request.policy, allowedProviders: ["ollama"] },
    });
    expect(result.metadata.costUsd).toBe(0);
    expect(result.metadata.pricingVersion).toBe("local-zero-cost-v1");
  });

  it("fails closed when provider usage needed for cost calculation is missing", async () => {
    const gateway = new OpenAICompatibleModelGateway({
      provider: "openai",
      baseUrl: "https://models.example.test/v1",
      apiKey: "secret",
      model: "test-model",
      pricing,
      fetchImpl: async () => new Response(JSON.stringify({
        model: "test-model",
        choices: [{ message: { content: JSON.stringify({ accepted: true }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    await expect(gateway.generate(request)).rejects.toThrow(/usage|token/i);
  });

  it("rejects invalid pricing instead of silently undercounting model cost", () => {
    expect(() => new OpenAICompatibleModelGateway({
      provider: "openai",
      baseUrl: "https://models.example.test/v1",
      apiKey: "secret",
      model: "test-model",
      pricing: { inputUsdPerMillionTokens: -1, outputUsdPerMillionTokens: 8, version: "bad" },
    })).toThrow(/pricing|cost|rate/i);
  });

  it("returns no gateway when no server-side LLM configuration exists", () => {
    expect(openAICompatibleGatewayFromEnv({})).toBeNull();
  });

  it("fails closed when only part of the server-side LLM configuration exists", () => {
    expect(() => openAICompatibleGatewayFromEnv({ KAIRO_LLM_API_KEY: "secret" })).toThrow(/configured together/);
  });

  it("requires an auditable pricing snapshot whenever the LLM runtime is configured", () => {
    expect(() => openAICompatibleGatewayFromEnv({
      KAIRO_LLM_PROVIDER: "openai",
      KAIRO_LLM_BASE_URL: "https://models.example.test/v1",
      KAIRO_LLM_MODEL: "test-model",
      KAIRO_LLM_API_KEY: "secret",
    })).toThrow(/pricing|configured together/i);
  });

  it("accepts complete non-secret token pricing configuration", () => {
    expect(openAICompatibleGatewayFromEnv({
      KAIRO_LLM_PROVIDER: "openai",
      KAIRO_LLM_BASE_URL: "https://models.example.test/v1",
      KAIRO_LLM_MODEL: "test-model",
      KAIRO_LLM_API_KEY: "secret",
      KAIRO_LLM_INPUT_USD_PER_1M_TOKENS: "2",
      KAIRO_LLM_OUTPUT_USD_PER_1M_TOKENS: "8",
      KAIRO_LLM_PRICING_VERSION: "provider-pricing-2026-08-15",
    })).not.toBeNull();
  });

  it.each([
    ["content-draft", { content: "Draft", supportingClaimIds: [] }, "content_draft_1"],
    ["critic-review", { passed: true, score: 90, findings: [] }, "critic_review_1"],
  ])("uses strict Groq JSON schema for %s", async (schemaName, output, responseName) => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      expect(payload.response_format).toMatchObject({
        type: "json_schema",
        json_schema: { name: responseName, strict: true },
      });
      expect(payload.response_format.json_schema.schema.additionalProperties).toBe(false);
      return new Response(JSON.stringify({
        model: "openai/gpt-oss-120b",
        choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const gateway = new OpenAICompatibleModelGateway({
      provider: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "secret",
      model: "openai/gpt-oss-120b",
      pricing,
      fetchImpl,
    });
    await expect(gateway.generate({
      ...request,
      role: schemaName === "content-draft" ? "drafter" : "critic",
      policy: { ...request.policy, allowedProviders: ["groq"] },
      outputSchema: { name: schemaName, version: "1" },
    })).resolves.toMatchObject({ output });
  });
});
