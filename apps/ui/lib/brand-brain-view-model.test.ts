import { describe, expect, it } from "vitest";
import { buildBrandBrainPageViewModel, type BrandBrainActivationInput, type BrandBrainFieldInput } from "./brand-brain-view-model";

function brainField(fieldKey: string, value: string, state: BrandBrainFieldInput["state"] = "inferred", sourceIds: string[] = ["source-1"]): BrandBrainFieldInput {
  return {
    fieldKey,
    section: fieldKey.startsWith("content.") ? "content-strategy" : fieldKey.split(".")[0] ?? "identity",
    value,
    state,
    sourceIds,
    version: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function activation(brain: BrandBrainFieldInput[]): BrandBrainActivationInput {
  return {
    brain,
    sources: [{ id: "source-1", type: "website", status: "active", sourceUrl: "https://example.com/" }],
    status: "ready-for-hunter",
    hunterReady: true,
    readiness: { status: "ready", score: 100, brandIntelligenceScore: 82, evidenceCoverage: 100, confidence: 0, gaps: [] },
    completeness: { score: 100, knownGroups: 6, totalGroups: 6 },
    fields: brain.map((field) => ({
      fieldKey: field.fieldKey,
      origin: field.state === "confirmed" ? "user-confirmed" : field.sourceIds.length ? "source-backed" : "ai-inferred",
      confidence: { score: field.state === "confirmed" ? 1 : field.sourceIds.length ? .85 : .55, level: field.state === "confirmed" || field.sourceIds.length ? "high" : "medium" },
      sourceIds: field.sourceIds,
      critical: true,
      weak: !field.sourceIds.length && field.state !== "confirmed",
      updatedAt: field.updatedAt,
    })),
    weakFields: [],
    recommendedSources: [],
    evidenceSourceCount: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("Kairo v2 Brand Brain view model", () => {
  it("keeps the frozen formatter hierarchy and adds source-backed confidence metadata", () => {
    const input = activation([
      brainField("identity.description", "A practical Malta travel Brand"),
      brainField("identity.products-services", "Travel guides, local itineraries"),
      brainField("audience.primary", "Independent travellers"),
      brainField("positioning.value-proposition", "Useful local guidance"),
      brainField("content.pillars", "Malta travel, road trips"),
      brainField("boundaries.excluded-topics", "Unsafe travel advice"),
    ]);
    const result = buildBrandBrainPageViewModel(input);
    expect(result.title).toBe("Brand Brain");
    expect(result.activation).toMatchObject({ label: "Ready for Hunter", hunterReady: true, completenessScore: 100 });
    expect(result.sections.map((section) => section.id)).toEqual(["identity", "products-services", "audience", "positioning", "voice", "content", "boundaries"]);
    expect(result.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "identity.description")).toMatchObject({ originLabel: "Source backed", confidenceLabel: "High confidence", needsReview: false });
    expect(result.sections.find((section) => section.id === "products-services")?.chipEditors[0]).toMatchObject({ fieldKey: "identity.products-services", originLabel: "Source backed" });
  });

  it("shows unknown critical fields without fabricating values", () => {
    const input = activation([]);
    input.status = "needs-enrichment";
    input.hunterReady = false;
    input.readiness = { ...input.readiness, status: "needs-enrichment", score: 0, brandIntelligenceScore: 0, evidenceCoverage: 0, confidence: 0, gaps: ["business"] };
    input.completeness = { score: 0, knownGroups: 0, totalGroups: 6 };
    input.sources = [];
    input.evidenceSourceCount = 0;
    const result = buildBrandBrainPageViewModel(input);
    expect(result.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "identity.description")).toMatchObject({ value: null, state: "unknown", originLabel: "Unknown", needsReview: true });
  });

  it("marks user-confirmed fields distinctly", () => {
    const confirmed = brainField("audience.primary", "Malta road-trip travellers", "confirmed", []);
    const input = activation([confirmed]);
    input.fields[0] = { ...input.fields[0]!, origin: "user-confirmed", confidence: { score: 1, level: "high" }, weak: false };
    const result = buildBrandBrainPageViewModel(input);
    expect(result.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "audience.primary")).toMatchObject({ originLabel: "User confirmed", confidenceLabel: "High confidence" });
  });
});
