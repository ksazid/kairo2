import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleModelGateway } from "./model-gateway";
import { responseFormatForOutputSchema } from "./model-output-schemas";

const pricing = {
  inputUsdPerMillionTokens: 0.15,
  outputUsdPerMillionTokens: 0.60,
  version: "groq-gpt-oss-120b-test",
};

function validProviderResponse() {
  return new Response(JSON.stringify({
    model: "openai/gpt-oss-120b",
    choices: [{ message: { content: JSON.stringify({
      format: "carousel",
      coverHook: "Choose the right bike for your priorities",
      slides: [
        { headline: "Goal", body: "Compare the supplied rider-goal claim.", supportingClaimIds: ["mc2-c1"] },
        { headline: "Evidence", body: "Separate expected benefits from verified claims.", supportingClaimIds: ["mc2-c2"] },
        { headline: "Decision", body: "Use both supplied Claims when comparing.", supportingClaimIds: ["mc2-c1", "mc2-c2"] },
      ],
      caption: "Compare the supplied Claims before deciding.",
      cta: "Save this comparison.",
      supportingClaimIds: ["mc2-c1", "mc2-c2"],
    }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 100 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function gateway(fetchImpl: typeof fetch) {
  return new OpenAICompatibleModelGateway({
    provider: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "test-key",
    model: "openai/gpt-oss-120b",
    pricing,
    fetchImpl,
  });
}

describe("strict structured model output", () => {
  it("keeps the generic Groq GPT-OSS carousel domain bounds for non-qualification calls", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        response_format?: {
          type?: string;
          json_schema?: { name?: string; strict?: boolean; schema?: Record<string, unknown> };
        };
      };
      expect(body.response_format?.type).toBe("json_schema");
      expect(body.response_format?.json_schema?.name).toBe("marketing_carousel_plan_1");
      expect(body.response_format?.json_schema?.strict).toBe(true);
      expect(body.response_format?.json_schema?.schema).toMatchObject({
        type: "object",
        properties: {
          coverHook: { type: "string", minLength: 1, maxLength: 300 },
          slides: {
            type: "array",
            minItems: 3,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                headline: { type: "string", minLength: 1, maxLength: 240 },
                body: { type: "string", minLength: 1, maxLength: 2_000 },
                supportingClaimIds: {
                  type: "array",
                  minItems: 1,
                  items: { type: "string", minLength: 1, maxLength: 200 },
                },
              },
              required: ["headline", "body", "supportingClaimIds"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      });
      return validProviderResponse();
    });

    await gateway(fetchImpl).generate({
      role: "strategist",
      scope: { visibility: "global-public" },
      policy: { qualityTier: "balanced", privacyClass: "global-public", maxCostUsd: 0.03, maxOutputTokens: 2_200, allowedProviders: ["groq"] },
      input: "Synthetic carousel benchmark input",
      outputSchema: { name: "marketing-carousel-plan", version: "1" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("constrains approved motorcycle qualification Claim IDs to the exact supplied lineage", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        response_format?: { json_schema?: { name?: string; schema?: any } };
      };
      const schema = body.response_format?.json_schema?.schema;
      expect(body.response_format?.json_schema?.name).toBe("marketing_carousel_plan_qualification_1");
      expect(schema?.properties?.supportingClaimIds).toMatchObject({
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: { type: "string", enum: ["mc2-c1", "mc2-c2"] },
      });
      expect(schema?.properties?.slides?.items?.properties?.supportingClaimIds).toMatchObject({
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: { type: "string", enum: ["mc2-c1", "mc2-c2"] },
      });
      return validProviderResponse();
    });

    const input = JSON.stringify({
      instruction: "qualification",
      context: {
        benchmarkCase: {
          caseId: "motorcycle-carousel-02",
          format: "carousel",
          claims: [
            { id: "mc2-c1", statement: "one", evidenceRefs: ["fixture://1"] },
            { id: "mc2-c2", statement: "two", evidenceRefs: ["fixture://2"] },
          ],
          requiredClaimIds: ["mc2-c1", "mc2-c2"],
        },
      },
    });

    await gateway(fetchImpl).generate({
      role: "strategist",
      scope: { visibility: "global-public" },
      policy: { qualityTier: "balanced", privacyClass: "global-public", maxCostUsd: 0.03, maxOutputTokens: 2_200, allowedProviders: ["groq"] },
      input,
      outputSchema: { name: "marketing-carousel-plan", version: "1" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails before network access when an approved qualification context does not require every supplied Claim", async () => {
    const fetchImpl = vi.fn(async () => validProviderResponse());
    const input = JSON.stringify({
      context: {
        benchmarkCase: {
          caseId: "motorcycle-carousel-02",
          format: "carousel",
          claims: [{ id: "mc2-c1" }, { id: "mc2-c2" }],
          requiredClaimIds: ["mc2-c1"],
        },
      },
    });
    await expect(gateway(fetchImpl).generate({
      role: "strategist",
      scope: { visibility: "global-public" },
      policy: { qualityTier: "balanced", privacyClass: "global-public", maxCostUsd: 0.03, maxOutputTokens: 2_200, allowedProviders: ["groq"] },
      input,
      outputSchema: { name: "marketing-carousel-plan", version: "1" },
    })).rejects.toThrow(/requires every supplied Claim/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses certified strict schemas for content generation and review", () => {
    expect(responseFormatForOutputSchema("groq", "openai/gpt-oss-120b", { name: "content-draft", version: "1" })).toMatchObject({
      type: "json_schema",
      json_schema: { name: "content_draft_1", strict: true },
    });
    expect(responseFormatForOutputSchema("groq", "openai/gpt-oss-120b", { name: "critic-review", version: "1" })).toMatchObject({
      type: "json_schema",
      json_schema: { name: "critic_review_1", strict: true },
    });
    expect(responseFormatForOutputSchema("groq", "openai/gpt-oss-120b", { name: "hunter-opportunities", version: "2" })).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "hunter_opportunities_2",
        strict: true,
        schema: {
          properties: {
            candidates: {
              items: {
                required: ["sourceUrl", "title", "rationale", "whyNow", "developmentDirection", "scores"],
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    });
  });

  it("uses strict production project schemas for carousel and Reel generation", () => {
    const carousel = responseFormatForOutputSchema("groq", "openai/gpt-oss-120b", { name: "production-carousel-project", version: "1" });
    expect(carousel).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "production_carousel_project_1",
        strict: true,
        schema: {
          properties: {
            structure: { enum: ["aida", "pas", "listicle", "case-study", "story", "comparison"] },
            caption: { type: "string", minLength: 1, maxLength: 5_000 },
            slides: { minItems: 2, maxItems: 10, items: { properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", maxLength: 200 }, role: { type: "string" }, imageAssetId: { type: "string", minLength: 1, maxLength: 600 }, supportingClaimIds: { minItems: 1 } }, additionalProperties: false } },
          },
          additionalProperties: false,
        },
      },
    });
    expect(responseFormatForOutputSchema("groq", "openai/gpt-oss-120b", { name: "production-reel-project", version: "1" })).toMatchObject({ type: "json_schema", json_schema: { name: "production_reel_project_1", strict: true } });
  });

  it("keeps JSON object mode for providers or models without the certified Groq strict route", () => {
    expect(responseFormatForOutputSchema("openai", "openai/gpt-oss-120b", { name: "marketing-carousel-plan", version: "1" })).toEqual({ type: "json_object" });
    expect(responseFormatForOutputSchema("groq", "other-model", { name: "marketing-carousel-plan", version: "1" })).toEqual({ type: "json_object" });
    expect(responseFormatForOutputSchema("groq", "openai/gpt-oss-120b", { name: "hunter-ranking", version: "1" })).toEqual({ type: "json_object" });
  });
});
