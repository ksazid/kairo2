import { describe, expect, it } from "vitest";
import type { BrandBrainFieldDto } from "@kairo/contracts";
import { buildBrandBrainV2, buildTopicGraph, nextGraphVersion } from "./brand-intelligence";

function field(fieldKey: string, value: string, state: BrandBrainFieldDto["state"] = "inferred", sourceIds: string[] = ["source-1"], updatedAt = "2026-08-26T10:00:00.000Z"): BrandBrainFieldDto {
  return { id: `field-${fieldKey}-${state}`, workspaceId: "w1", brandId: "b1", section: "content-strategy", fieldKey, value, state, sourceIds, version: 1, updatedAt };
}

describe("VS-103 Brand Brain V2", () => {
  it("lets later confirmed Brand evidence override inferred scalar fields", () => {
    const brain = buildBrandBrainV2([
      field("sector", "software", "inferred", ["s1"], "2026-08-26T09:00:00.000Z"),
      field("sector", "AI infrastructure", "confirmed", [], "2026-08-26T10:00:00.000Z"),
      field("products", "Agents, APIs"),
    ]);
    expect(brain.sector).toBe("AI infrastructure");
    expect(brain.products).toEqual(["Agents", "APIs"]);
  });
  it("projects the dotted keys produced by the runtime Brand Brain generator", () => {
    const brain = buildBrandBrainV2([field("identity.sector", "Developer Technology"), field("content.core-topics", "AI agents, RAG")]);
    expect(brain.sector).toBe("Developer Technology");
    expect(brain.coreTopics).toEqual(["AI agents", "RAG"]);
  });
});

describe("VS-103 Topic Graph", () => {
  it("is deterministic and deduplicates aliases/topics", () => {
    const fields = [field("coreTopics", "AI Agents, ai agents, LLMs", "confirmed", ["s1", "s1"]), field("authorityAreas", "AI Agents", "inferred", ["s2"])];
    const one = buildTopicGraph(fields, "ai-tech");
    const two = buildTopicGraph([...fields].reverse(), "ai-tech");
    expect(one.fingerprint).toBe(two.fingerprint);
    expect(one.nodes.filter((node) => node.topic.toLowerCase() === "ai agents")).toHaveLength(1);
    expect(one.nodes.find((node) => node.topic.toLowerCase() === "ai agents")?.sourceIds).toEqual(["s1", "s2"]);
  });

  it("makes exclusions win over preferred and sector-pack seeds", () => {
    const graph = buildTopicGraph([
      field("coreTopics", "technology trends", "confirmed", ["s1"]),
      field("excludedTopics", "Technology Trends", "confirmed", ["s2"]),
    ], "ai-tech");
    const node = graph.nodes.find((item) => item.topic.toLowerCase() === "technology trends");
    expect(node?.excluded).toBe(true);
    expect(node?.preferred).toBe(false);
    expect(node?.priority).toBe(1);
    expect(node?.origin).toBe("brand-brain");
  });

  it("does not fabricate provenance for sector-pack hints", () => {
    const graph = buildTopicGraph([], "motorcycles");
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.every((node) => node.origin !== "sector-pack" || node.sourceIds.length === 0)).toBe(true);
    expect(graph.nodes.every((node) => node.origin !== "sector-pack" || node.confidence === undefined)).toBe(true);
    expect(graph).toMatchObject({ interestGraph: expect.any(Array), exclusions: [], explorationTopics: expect.any(Array), authorityZones: [], performanceWeights: {} });
    expect(graph.nodes.every((node) => Array.isArray(node.preferredSources) && Boolean(node.authorityLevel))).toBe(true);
  });

  it("increments versions only for material graph changes", () => {
    expect(nextGraphVersion(undefined, "a")).toBe(1);
    expect(nextGraphVersion({ version: 3, fingerprint: "a" }, "a")).toBe(3);
    expect(nextGraphVersion({ version: 3, fingerprint: "a" }, "b")).toBe(4);
  });
});
