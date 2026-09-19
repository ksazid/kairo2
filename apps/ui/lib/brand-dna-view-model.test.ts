import { describe, expect, it } from "vitest";
import { formatBrandDnaForUi, type BrandDnaFieldInput } from "./brand-dna-view-model";

function field(fieldKey: string, value: string, sourceIds = ["source-1"]): BrandDnaFieldInput {
  return { fieldKey, section: fieldKey.split(".")[0] ?? "identity", value, state: "inferred", sourceIds };
}

describe("Flow 1A Brand DNA UI formatter", () => {
  it("formats discovered website intelligence into clean Kairo sections", () => {
    const result = formatBrandDnaForUi([
      field("identity.description", "Acme helps restaurant teams manage ordering and payments with one simple platform."),
      field("identity.category", "Restaurant Technology"),
      field("identity.geography", "Malta, Gozo"),
      field("identity.products-services", "Payments | Payment solutions | Online ordering"),
      field("audience.primary", "Restaurant teams"),
      field("positioning.value-proposition", "Simpler ordering and payments for restaurant operators."),
      field("content.pillars", "Restaurant growth, payments, ordering"),
      field("content.visual-direction", "Clean editorial layouts with bold type"),
      field("boundaries.excluded-topics", "No excluded topics identified; confirm before Hunter activation."),
    ], { brandIntelligenceScore: 78 });

    expect(result.title).toBe("Brand Brain");
    expect(result.intelligence.status).toBe("Strong");
    expect(result.intelligence.score).toBe(78);
    expect(result.evidence).toMatchObject({ available: true, sourceCount: 1, actionLabel: "View evidence" });

    const identity = result.sections.find((section) => section.id === "identity");
    expect(identity?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Category", value: "Restaurant Technology", editable: true }),
      expect.objectContaining({ label: "Location", value: "Malta · Gozo" }),
    ]));

    const products = result.sections.find((section) => section.id === "products-services");
    expect(products?.chips).toEqual(["Payments", "Online Ordering"]);
    const content = result.sections.find((section) => section.id === "content");
    expect(content?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "content.visual-direction", label: "Visual direction", value: "Clean editorial layouts with bold type", editable: true }),
    ]));
  });

  it("keeps sparse evidence unknown instead of fabricating UI values", () => {
    const result = formatBrandDnaForUi([
      field("identity.description", "Acme builds tools for restaurant teams."),
    ]);

    const identity = result.sections.find((section) => section.id === "identity");
    expect(identity?.status).toBe("partial");
    expect(identity?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "identity.category", value: null, state: "unknown" }),
      expect.objectContaining({ fieldKey: "identity.geography", value: null, state: "unknown" }),
    ]));
    expect(result.intelligence.status).toBe("Needs enrichment");
  });

  it("summarizes long primary text and keeps evidence metadata out of display values", () => {
    const result = formatBrandDnaForUi([
      field("identity.description", `Acme helps restaurant operators. ${"Detailed crawler evidence ".repeat(40)}`, ["source-a", "source-b"]),
      field("identity.category", "Restaurant Technology", ["source-a"]),
    ]);

    const description = result.sections.find((section) => section.id === "identity")?.fields.find((item) => item.fieldKey === "identity.description");
    expect(description?.value?.length).toBeLessThanOrEqual(241);
    expect(description?.value).not.toMatch(/source-a|source-b|selector|json-ld/i);
    expect(description?.evidenceCount).toBe(2);
    expect(result.evidence.sourceIds).toEqual(["source-a", "source-b"]);
  });
});
