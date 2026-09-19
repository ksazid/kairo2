import { describe, expect, it } from "vitest";
import type { BrandBrainFieldDto, KnowledgeSourceDto } from "@kairo/contracts";
import type { CandidateLearning } from "./learning";
import { compactBrandIntelligenceSnapshot, projectBrandIntelligenceSnapshot } from "./brand-intelligence-snapshot";

function field(
  fieldKey: string,
  section: BrandBrainFieldDto["section"],
  value: string,
  state: BrandBrainFieldDto["state"] = "inferred",
  sourceIds: string[] = ["source-1"],
  updatedAt = "2026-09-01T00:00:00.000Z",
): BrandBrainFieldDto {
  return {
    id: `${fieldKey}-${state}-${updatedAt}`,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    section,
    fieldKey,
    value,
    state,
    sourceIds,
    version: 1,
    updatedAt,
    ...(state === "confirmed" ? { confirmedByAccountId: "owner-1" } : {}),
  };
}

function source(id: string, updatedAt = "2026-09-01T00:30:00.000Z"): KnowledgeSourceDto {
  return {
    id,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    type: "website",
    status: "active",
    sourceUrl: "https://example.com/",
    hasPrivateContent: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt,
  };
}

function acceptedLearning(): CandidateLearning {
  return {
    id: "learning-1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    statement: "Checklist carousels earn more saves.",
    interpretation: "Prefer checklist structures when the topic supports practical steps.",
    confidence: 0.84,
    period: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T23:59:59.000Z" },
    applicability: { channel: "instagram", format: "carousel" },
    patterns: [],
    evidence: [{ publishedPostId: "post-1", metricObservationIds: ["metric-1"] }],
    contradictions: [],
    status: "accepted",
    version: 2,
    createdAt: "2026-09-01T00:00:00.000Z",
    decidedAt: "2026-09-01T01:00:00.000Z",
    decidedBy: "owner-1",
  };
}

const completeFields = () => [
  field("identity.description", "identity", "A practical Malta travel Brand"),
  field("identity.products-services", "identity", "Malta travel guides"),
  field("audience.primary", "audience", "Independent Malta travellers"),
  field("positioning.value-proposition", "positioning", "Useful local guidance"),
  field("content.core-topics", "content-strategy", "Malta itineraries and travel tips"),
  field("boundaries.excluded-topics", "boundaries", "Unsafe travel advice"),
];

describe("Brand Intelligence snapshot", () => {
  it("projects one versioned canonical context from Brain, sources and accepted learnings", () => {
    const snapshot = projectBrandIntelligenceSnapshot({
      brand: { id: "brand-1", workspaceId: "workspace-1", name: "Malta Guide" },
      fields: completeFields(),
      sources: [source("source-1")],
      learnings: [acceptedLearning()],
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "1",
      snapshotVersion: "brand-1@2026-09-01T01:00:00.000Z",
      brandId: "brand-1",
      brandName: "Malta Guide",
      status: "ready-for-hunter",
      hunterReady: true,
      activeSourceIds: ["source-1"],
      evidenceSourceIds: ["source-1"],
      performanceMemory: [expect.objectContaining({ learningId: "learning-1", confidence: 0.84 })],
    });
    expect(snapshot.context.identity).toContain("identity.description: A practical Malta travel Brand");
    expect(snapshot.context.audience).toContain("audience.primary: Independent Malta travellers");
  });

  it("keeps user-confirmed values authoritative in the shared context", () => {
    const fields = completeFields();
    fields.push(field("audience.primary", "audience", "Local weekend travellers", "confirmed", [], "2026-09-01T02:00:00.000Z"));
    const snapshot = projectBrandIntelligenceSnapshot({
      brand: { id: "brand-1", workspaceId: "workspace-1", name: "Malta Guide" },
      fields,
    });

    const audience = snapshot.fields.find((item) => item.fieldKey === "audience.primary");
    expect(audience).toMatchObject({
      value: "Local weekend travellers",
      origin: "user-confirmed",
      confidence: { score: 1, level: "high" },
      confirmedByAccountId: "owner-1",
    });
    expect(snapshot.context.audience).toContain("Local weekend travellers");
    expect(snapshot.context.audience).not.toContain("Independent Malta travellers");
  });

  it("excludes non-accepted and foreign learnings from agent memory", () => {
    const candidate = { ...acceptedLearning(), id: "candidate", status: "candidate" as const };
    const foreign = { ...acceptedLearning(), id: "foreign", brandId: "brand-2" };
    const snapshot = projectBrandIntelligenceSnapshot({
      brand: { id: "brand-1", workspaceId: "workspace-1", name: "Malta Guide" },
      fields: completeFields(),
      learnings: [candidate, foreign],
    });
    expect(snapshot.performanceMemory).toEqual([]);
  });

  it("carries readiness gaps and weak fields so agents cannot mistake partial Brain data for certainty", () => {
    const snapshot = projectBrandIntelligenceSnapshot({
      brand: { id: "brand-1", workspaceId: "workspace-1", name: "Malta Guide" },
      fields: [field("identity.description", "identity", "A travel Brand")],
    });
    expect(snapshot.hunterReady).toBe(false);
    expect(snapshot.readinessGaps).toEqual(expect.arrayContaining(["offerings", "audience", "positioning", "topics", "boundaries"]));
    expect(snapshot.weakFields).toEqual(expect.arrayContaining(["identity.products-services", "audience.primary"]));
  });

  it("produces a compact cross-agent payload without evidence text duplication", () => {
    const snapshot = projectBrandIntelligenceSnapshot({
      brand: { id: "brand-1", workspaceId: "workspace-1", name: "Malta Guide" },
      fields: completeFields(),
      learnings: [acceptedLearning()],
    });
    const compact = compactBrandIntelligenceSnapshot(snapshot);
    expect(compact).toMatchObject({
      schemaVersion: "1",
      snapshotVersion: expect.stringContaining("brand-1@"),
      brand: { brandName: "Malta Guide" },
      performanceMemory: [expect.objectContaining({ statement: "Checklist carousels earn more saves." })],
    });
    expect(JSON.stringify(compact)).not.toContain("metric-1");
  });
});
