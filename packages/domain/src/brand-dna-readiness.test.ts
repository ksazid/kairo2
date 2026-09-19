import { describe, expect, it } from "vitest";
import type { BrandBrainFieldDto } from "@kairo/contracts";
import { evaluateBrandDnaReadiness } from "./brand-dna-readiness";

function field(fieldKey: string, value: string, state: BrandBrainFieldDto["state"] = "inferred"): BrandBrainFieldDto {
  return { id: fieldKey, workspaceId: "w", brandId: "b", section: fieldKey.split(".")[0] as BrandBrainFieldDto["section"], fieldKey, value, state, sourceIds: ["s"], version: 1, updatedAt: "2026-08-29T00:00:00.000Z" };
}

describe("Brand DNA readiness", () => {
  it("does not unlock Hunter on generic fallback placeholders", () => {
    const result = evaluateBrandDnaReadiness([
      field("identity.category", "Public social profile — category not yet confirmed"),
      field("audience.primary", "The Brand's audience, to be confirmed from connected or readable source evidence"),
      field("content.pillars", "Topics and themes from the Brand's published content, to be confirmed"),
    ], { now: () => new Date("2026-08-29T00:00:00.000Z") });
    expect(result.status).toBe("needs-enrichment");
    expect(result.gaps).toEqual(expect.arrayContaining(["business", "offerings", "audience", "topics", "positioning", "boundaries"]));
    expect(result.nextAction?.type).toBe("add-source");
  });

  it("does not treat generic website fallback prose as Brand intelligence", () => {
    const result = evaluateBrandDnaReadiness([
      field("identity.category", "Business or organization website"),
      field("identity.products-services", "Stripe products or services described in the public reference"),
      field("audience.primary", "Customers seeking stripe products or services"),
      field("positioning.value-proposition", "Stripe provides the products or services described in its public reference."),
      field("content.pillars", "Brand story, products or services, practical guidance and customer value"),
      field("boundaries.excluded-topics", "No excluded topics identified in the public reference; confirm before Hunter activation"),
    ]);
    expect(result.status).toBe("needs-enrichment");
    expect(result.gaps).toEqual(expect.arrayContaining(["business", "offerings", "audience", "positioning", "topics", "boundaries"]));
  });

  it("accepts source-backed inferred context while keeping it non-authoritative", () => {
    const result = evaluateBrandDnaReadiness([
      field("identity.description", "A Malta grocery delivery service"),
      field("identity.products-services", "Same-day grocery delivery"),
      field("audience.primary", "Busy households in Malta"),
      field("positioning.value-proposition", "Convenient local delivery"),
      field("content.core-topics", "Grocery planning, local food and delivery"),
      field("boundaries.excluded-topics", "Medical advice"),
    ]);
    expect(result).toMatchObject({ status: "ready", score: 100, gaps: [] });
  });

  it("asks for geography only for location-dependent brands", () => {
    const base = [field("identity.description", "A software company"), field("identity.products-services", "Developer tools"), field("audience.primary", "Developers"), field("positioning.value-proposition", "Faster builds"), field("content.core-topics", "Software engineering"), field("boundaries.excluded-topics", "None")];
    expect(evaluateBrandDnaReadiness(base).status).toBe("ready");
    expect(evaluateBrandDnaReadiness(base, { geographyRequired: true }).gaps).toEqual(["geography"]);
  });
});
