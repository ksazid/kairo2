import type { OutputSchemaRef } from "@kairo/agent-contracts";

export type OpenAICompatibleResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict: true;
        schema: Record<string, unknown>;
      };
    };

const claimIdSchema = Object.freeze({ type: "string", minLength: 1, maxLength: 200 });
const slideClaimIdsSchema = Object.freeze({
  type: "array",
  minItems: 1,
  description: "Use only Claim IDs supplied in the benchmark case. This list must be a subset of the top-level supportingClaimIds.",
  items: claimIdSchema,
});
const planClaimIdsSchema = Object.freeze({
  type: "array",
  minItems: 1,
  description: "Include every required Claim ID supplied in the benchmark case and every Claim ID referenced by any slide.",
  items: claimIdSchema,
});

function carouselPlanSchema(
  claimSchemas: { slide: Record<string, unknown>; plan: Record<string, unknown> } = {
    slide: slideClaimIdsSchema,
    plan: planClaimIdsSchema,
  },
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      format: { type: "string", enum: ["carousel"] },
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
            supportingClaimIds: claimSchemas.slide,
          },
          required: ["headline", "body", "supportingClaimIds"],
          additionalProperties: false,
        },
      },
      caption: { type: "string", minLength: 1, maxLength: 5_000 },
      cta: { type: "string", minLength: 1, maxLength: 500 },
      supportingClaimIds: claimSchemas.plan,
    },
    required: ["format", "coverHook", "slides", "caption", "cta", "supportingClaimIds"],
    additionalProperties: false,
  };
}

const CAROUSEL_PLAN_SCHEMA = Object.freeze(carouselPlanSchema());

const CONTENT_DRAFT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    content: { type: "string", minLength: 1, maxLength: 50_000 },
    supportingClaimIds: {
      type: "array",
      maxItems: 100,
      items: claimIdSchema,
    },
  },
  required: ["content", "supportingClaimIds"],
  additionalProperties: false,
});

const productionClaimIdsSchema = Object.freeze({
  type: "array",
  minItems: 1,
  maxItems: 100,
  uniqueItems: true,
  items: claimIdSchema,
});

const PRODUCTION_CAROUSEL_PROJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    format: { type: "string", enum: ["carousel"] },
    structure: { type: "string", enum: ["aida", "pas", "listicle", "case-study", "story", "comparison"] },
    coverHook: { type: "string", minLength: 1, maxLength: 300 },
    caption: { type: "string", minLength: 1, maxLength: 5_000 },
    cta: { type: "string", minLength: 1, maxLength: 500 },
    slides: {
      type: "array",
      minItems: 2,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", maxLength: 200 },
          role: { type: "string", enum: ["hook", "attention", "interest", "desire", "problem", "agitation", "solution", "list-item", "context", "challenge", "approach", "result", "story-beat", "comparison", "evidence", "insight", "cta"] },
          headline: { type: "string", minLength: 1, maxLength: 240 },
          body: { type: "string", minLength: 1, maxLength: 2_000 },
          imageAssetId: { type: "string", minLength: 1, maxLength: 600 },
          supportingClaimIds: productionClaimIdsSchema,
        },
        required: ["id", "role", "headline", "body", "supportingClaimIds"],
        additionalProperties: false,
      },
    },
    supportingClaimIds: productionClaimIdsSchema,
  },
  required: ["schemaVersion", "format", "structure", "coverHook", "caption", "cta", "slides", "supportingClaimIds"],
  additionalProperties: false,
});

const PRODUCTION_REEL_PROJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    contentType: { type: "string", enum: ["reel"] },
    title: { type: "string", minLength: 1, maxLength: 300 },
    hook: { type: "string", minLength: 1, maxLength: 300 },
    targetDurationSeconds: { type: "number", minimum: 5, maximum: 300 },
    caption: { type: "string", minLength: 1, maxLength: 2_200 },
    cta: { type: "string", minLength: 1, maxLength: 500 },
    scenes: {
      type: "array",
      minItems: 2,
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$", maxLength: 120 },
          role: { type: "string", enum: ["hook", "problem", "insight", "evidence", "solution", "cta", "story-beat"] },
          startSecond: { type: "number", minimum: 0, maximum: 300 },
          endSecond: { type: "number", minimum: 0, maximum: 300 },
          visual: { type: "string", minLength: 1, maxLength: 1_000 },
          onScreenText: { type: "string", minLength: 1, maxLength: 500 },
          voiceover: { type: "string", minLength: 1, maxLength: 2_000 },
          supportingClaimIds: productionClaimIdsSchema,
        },
        required: ["id", "role", "startSecond", "endSecond", "visual", "onScreenText", "voiceover", "supportingClaimIds"],
        additionalProperties: false,
      },
    },
    supportingClaimIds: productionClaimIdsSchema,
  },
  required: ["schemaVersion", "contentType", "title", "hook", "targetDurationSeconds", "caption", "cta", "scenes", "supportingClaimIds"],
  additionalProperties: false,
});

const CRITIC_REVIEW_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    passed: { type: "boolean" },
    score: { type: "number", minimum: 0, maximum: 100 },
    findings: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        properties: {
          code: { type: "string", minLength: 1, maxLength: 120 },
          severity: { type: "string", enum: ["advisory", "revision"] },
          message: { type: "string", minLength: 1, maxLength: 2_000 },
        },
        required: ["code", "severity", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["passed", "score", "findings"],
  additionalProperties: false,
});

// Groq strict structured output supports a deliberately small JSON Schema subset. Keep the
// provider-facing Hunter schema structural; Kairo's runtime validator owns the tighter string,
// URL and 0..1 score bounds after generation.
const hunterScoreSchema = Object.freeze({
  type: "number",
  description: "A decimal score from 0 through 1 inclusive.",
});
const HUNTER_OPPORTUNITIES_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceUrl: { type: "string", description: "An exact sourceUrl supplied in the evidence." },
          title: { type: "string" },
          rationale: { type: "string" },
          whyNow: { type: "string" },
          developmentDirection: { type: "string" },
          scores: {
            type: "object",
            properties: {
              relevance: hunterScoreSchema,
              evidence: hunterScoreSchema,
              novelty: hunterScoreSchema,
              timeliness: hunterScoreSchema,
              brandAuthority: hunterScoreSchema,
              audienceFit: hunterScoreSchema,
            },
            required: ["relevance", "evidence", "novelty", "timeliness", "brandAuthority", "audienceFit"],
            additionalProperties: false,
          },
        },
        required: ["sourceUrl", "title", "rationale", "whyNow", "developmentDirection", "scores"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
});

const qualityScoresSchema = Object.freeze({
  type: "object",
  properties: {
    brandFit: { type: "number", minimum: 0, maximum: 100 },
    hookQuality: { type: "number", minimum: 0, maximum: 100 },
    originality: { type: "number", minimum: 0, maximum: 100 },
    formatQuality: { type: "number", minimum: 0, maximum: 100 },
    criticScore: { type: "number", minimum: 0, maximum: 100 },
  },
  required: ["brandFit", "hookQuality", "originality", "formatQuality", "criticScore"],
  additionalProperties: false,
});

const candidateQualityEvaluationSchema = Object.freeze({
  type: "object",
  properties: {
    truthPassed: { type: "boolean" },
    scores: qualityScoresSchema,
    reasons: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
  required: ["truthPassed", "scores", "reasons"],
  additionalProperties: false,
});

const MARKETING_PAIR_QUALITY_EVALUATION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    candidateA: candidateQualityEvaluationSchema,
    candidateB: candidateQualityEvaluationSchema,
  },
  required: ["candidateA", "candidateB"],
  additionalProperties: false,
});

const GROQ_STRICT_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
const QUALIFICATION_CASE_IDS = new Set([
  "motorcycle-carousel-01",
  "motorcycle-carousel-02",
  "motorcycle-carousel-03",
  "motorcycle-carousel-04",
]);

export function responseFormatForOutputSchema(
  provider: string,
  model: string,
  outputSchema: OutputSchemaRef,
  input?: string,
): OpenAICompatibleResponseFormat {
  if (provider === "groq" && GROQ_STRICT_MODELS.has(model)) {
    if (outputSchema.name === "production-carousel-project" && outputSchema.version === "1") {
      return {
        type: "json_schema",
        json_schema: {
          name: "production_carousel_project_1",
          strict: true,
          schema: PRODUCTION_CAROUSEL_PROJECT_SCHEMA,
        },
      };
    }
    if (outputSchema.name === "production-reel-project" && outputSchema.version === "1") {
      return {
        type: "json_schema",
        json_schema: {
          name: "production_reel_project_1",
          strict: true,
          schema: PRODUCTION_REEL_PROJECT_SCHEMA,
        },
      };
    }
    if (outputSchema.name === "content-draft" && outputSchema.version === "1") {
      return {
        type: "json_schema",
        json_schema: {
          name: "content_draft_1",
          strict: true,
          schema: CONTENT_DRAFT_SCHEMA,
        },
      };
    }
    if (outputSchema.name === "critic-review" && outputSchema.version === "1") {
      return {
        type: "json_schema",
        json_schema: {
          name: "critic_review_1",
          strict: true,
          schema: CRITIC_REVIEW_SCHEMA,
        },
      };
    }
    if (outputSchema.name === "hunter-opportunities" && outputSchema.version === "2") {
      return {
        type: "json_schema",
        json_schema: {
          name: "hunter_opportunities_2",
          strict: true,
          schema: HUNTER_OPPORTUNITIES_SCHEMA,
        },
      };
    }
    if (outputSchema.name === "marketing-carousel-plan" && outputSchema.version === "1") {
      const qualification = qualificationClaimSchemas(input);
      return {
        type: "json_schema",
        json_schema: {
          name: qualification ? "marketing_carousel_plan_qualification_1" : "marketing_carousel_plan_1",
          strict: true,
          schema: qualification ? carouselPlanSchema(qualification) : CAROUSEL_PLAN_SCHEMA,
        },
      };
    }
    if (outputSchema.name === "marketing-pair-quality-evaluation" && outputSchema.version === "1") {
      return {
        type: "json_schema",
        json_schema: {
          name: "marketing_pair_quality_evaluation_1",
          strict: true,
          schema: MARKETING_PAIR_QUALITY_EVALUATION_SCHEMA,
        },
      };
    }
  }
  return { type: "json_object" };
}

function qualificationClaimSchemas(
  input: string | undefined,
): { slide: Record<string, unknown>; plan: Record<string, unknown> } | null {
  if (!input) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const context = (parsed as { context?: unknown }).context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const benchmarkCase = (context as { benchmarkCase?: unknown }).benchmarkCase;
  if (!benchmarkCase || typeof benchmarkCase !== "object" || Array.isArray(benchmarkCase)) return null;
  const candidate = benchmarkCase as {
    caseId?: unknown;
    format?: unknown;
    claims?: unknown;
    requiredClaimIds?: unknown;
  };
  if (typeof candidate.caseId !== "string" || !QUALIFICATION_CASE_IDS.has(candidate.caseId)) return null;
  if (candidate.format !== "carousel") throw new Error("Qualification carousel structured-output context has an invalid format");
  if (!Array.isArray(candidate.claims) || !candidate.claims.length) {
    throw new Error("Qualification carousel structured-output context requires Claims");
  }
  const claimIds = candidate.claims.map((claim) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      throw new Error("Qualification carousel structured-output context has an invalid Claim");
    }
    const id = (claim as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim() || id.trim().length > 200) {
      throw new Error("Qualification carousel structured-output context has an invalid Claim ID");
    }
    return id.trim();
  });
  if (new Set(claimIds).size !== claimIds.length) {
    throw new Error("Qualification carousel structured-output Claim IDs must be unique");
  }
  if (!Array.isArray(candidate.requiredClaimIds) || candidate.requiredClaimIds.length !== claimIds.length) {
    throw new Error("Qualification carousel structured-output requires every supplied Claim");
  }
  const required = candidate.requiredClaimIds.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("Qualification carousel structured-output has an invalid required Claim ID");
    }
    return value.trim();
  });
  if (new Set(required).size !== required.length || required.some((id) => !claimIds.includes(id))) {
    throw new Error("Qualification carousel structured-output required Claims must equal the supplied Claim lineage");
  }
  const item = { type: "string", enum: claimIds };
  return {
    slide: {
      type: "array",
      minItems: 1,
      maxItems: claimIds.length,
      description: `Use only the supplied benchmark Claim IDs: ${claimIds.join(", ")}.`,
      items: item,
    },
    plan: {
      type: "array",
      minItems: required.length,
      maxItems: required.length,
      description: `Include every and only required Claim ID exactly once: ${required.join(", ")}.`,
      items: item,
    },
  };
}
