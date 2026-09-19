import { describe, expect, it } from "vitest";
import { projectRuntimeFields, projectRuntimeLearnings, projectRuntimeSources, projectRuntimeTopics, type BrandBrainRuntimeData } from "./brand-brain-runtime";

const activation: BrandBrainRuntimeData = {
  brain: [
    { fieldKey: "audience.primary", section: "audience", value: "Malta founders", state: "confirmed", sourceIds: [], version: 2, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "content.preferred-topics", section: "content-strategy", value: "AI automation", state: "inferred", sourceIds: ["source-1"], version: 1, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "content.visual-direction", section: "content-strategy", value: "Clean editorial layouts with bold type", state: "confirmed", sourceIds: [], version: 3, updatedAt: "2026-09-01T10:00:00.000Z" },
  ],
  sources: [{ id: "source-1", type: "website", status: "active", title: "Kairo", sourceUrl: "https://example.com" }],
  status: "needs-enrichment",
  hunterReady: false,
  readiness: { status: "needs-enrichment", score: 33, brandIntelligenceScore: 33, evidenceCoverage: 50, confidence: 70, gaps: ["business", "offerings", "positioning", "boundaries"] },
  completeness: { score: 33, knownGroups: 2, totalGroups: 6 },
  fields: [
    { fieldKey: "audience.primary", origin: "user-confirmed", confidence: { score: 1, level: "high" }, sourceIds: [], critical: true, weak: false, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "content.preferred-topics", origin: "source-backed", confidence: { score: .85, level: "high" }, sourceIds: ["source-1"], critical: true, weak: false, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "content.visual-direction", origin: "user-confirmed", confidence: { score: 1, level: "high" }, sourceIds: [], critical: true, weak: false, updatedAt: "2026-09-01T10:00:00.000Z" },
  ],
  weakFields: ["identity.description"],
  recommendedSources: [],
  evidenceSourceCount: 1,
  updatedAt: "2026-09-01T10:00:00.000Z",
  discoveryPlan: {
    schemaVersion: "1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    revision: 1,
    planVersion: "brand-1@v1:discovery:1",
    snapshotVersion: "brand-1@v1",
    state: "initial",
    topics: [{ id: "ai-automation", name: "AI automation", priority: "High", audience: "Malta founders", entities: ["AI automation", "AI automation Malta"], sourceClasses: ["Official sources", "Industry news"] }],
    excludedTopics: [],
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
  discoveryPlanCurrent: true,
  discoveryRun: null,
  schedule: null,
  intelligenceSnapshot: { snapshotVersion: "brand-1@v1", performanceMemory: [] },
};

describe("Brand Brain runtime projection", () => {
  it("binds onboarding facts, sources and persisted initial Discovery Plan without fabricating learning", () => {
    const fields = projectRuntimeFields(activation);
    expect(fields.find((field) => field.key === "audience")).toMatchObject({ value: "Malta founders", state: "confirmed", fieldKey: "audience.primary", version: 2 });
    expect(fields.find((field) => field.key === "content")).toMatchObject({ value: "AI automation", state: "suggested", evidence: ["Kairo"] });
    expect(fields.find((field) => field.key === "visual-direction")).toMatchObject({ value: "Clean editorial layouts with bold type", state: "confirmed", fieldKey: "content.visual-direction", version: 3 });
    expect(fields.find((field) => field.key === "category")).toMatchObject({ value: "Not known yet", state: "review" });
    expect(projectRuntimeTopics(activation)).toEqual([expect.objectContaining({ name: "AI automation", audience: "Malta founders" })]);
    expect(projectRuntimeSources(activation)).toEqual([expect.objectContaining({ id: "source-1", title: "Kairo", status: "active" })]);
    expect(projectRuntimeLearnings(activation)).toEqual([]);
  });
});
