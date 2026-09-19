import { describe, expect, it } from "vitest";
import { responseFormatForOutputSchema } from "./model-output-schemas";

describe("VS-65 evaluator structured output", () => {
  it("uses strict JSON Schema for the certified Groq GPT-OSS evaluator route", () => {
    const format = responseFormatForOutputSchema(
      "groq",
      "openai/gpt-oss-120b",
      { name: "marketing-pair-quality-evaluation", version: "1" },
    );
    expect(format.type).toBe("json_schema");
    if (format.type !== "json_schema") throw new Error("expected strict schema");
    expect(format.json_schema.name).toBe("marketing_pair_quality_evaluation_1");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema).toMatchObject({
      type: "object",
      properties: {
        candidateA: {
          type: "object",
          properties: {
            truthPassed: { type: "boolean" },
            scores: {
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
            },
            reasons: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
          required: ["truthPassed", "scores", "reasons"],
          additionalProperties: false,
        },
        candidateB: { type: "object" },
      },
      required: ["candidateA", "candidateB"],
      additionalProperties: false,
    });
  });

  it("does not silently enable the evaluator schema for uncertified routes", () => {
    expect(responseFormatForOutputSchema(
      "openai",
      "openai/gpt-oss-120b",
      { name: "marketing-pair-quality-evaluation", version: "1" },
    )).toEqual({ type: "json_object" });
  });
});
