import { describe, expect, it } from "vitest";
import { normalizeEntities, reviewCount, updateBrandField, updateDiscoveryTopic, type BrandBrainField, type DiscoveryTopic } from "./brand-brain";

const fields: BrandBrainField[] = [
  { key: "audience", fieldKey: "audience.primary", section: "audience", label: "Audience", description: "Who you serve", value: "Founders", state: "suggested", evidence: ["Website"] },
  { key: "voice", fieldKey: "voice.tone", section: "voice", label: "Voice", description: "How you sound", value: "Direct", state: "confirmed", evidence: ["Instagram"] },
];

const topics: DiscoveryTopic[] = [
  { id: "one", name: "Malta technology", priority: "High", audience: "Founders", entities: ["Malta startups"], sources: ["Industry news"] },
];

describe("Brand Brain interaction helpers", () => {
  it("confirms a field after a non-empty inline save", () => {
    expect(updateBrandField(fields, "audience", "  Malta founders  ")[0]).toMatchObject({ value: "Malta founders", state: "confirmed" });
  });

  it("keeps the previous field when an inline value is blank", () => {
    expect(updateBrandField(fields, "audience", "   ")).toEqual(fields);
  });

  it("normalizes and deduplicates search entities", () => {
    expect(normalizeEntities("Malta, AI, Malta, startups")).toEqual(["Malta", "AI", "startups"]);
  });

  it("updates an editable discovery topic without changing its policy metadata", () => {
    expect(updateDiscoveryTopic(topics, "one", { name: " Malta business ", entities: "SMBs, funding" })[0]).toEqual({
      ...topics[0],
      name: "Malta business",
      entities: ["SMBs", "funding"],
    });
  });

  it("counts suggested and review fields", () => {
    expect(reviewCount(fields)).toBe(1);
  });
});
