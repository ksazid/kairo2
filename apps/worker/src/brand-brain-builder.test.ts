import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort, AgentRuntimeResult } from "@kairo/agent-contracts";
import { BrandBrainBuilder } from "./brand-brain-builder";

class FakeRuntime implements AgentRuntimePort {
  request: AgentInvocationRequest | null = null;
  constructor(private readonly output: unknown) {}
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.request = request;
    return {
      output: this.output as TOutput,
      metadata: { runtime: "fake", latencyMs: 1 },
    };
  }
}

const input = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  brandName: "The Duke 390",
  primaryObjective: "Grow audience",
  existingConfirmed: { "boundaries.owner-directive": "Do not glorify dangerous public-road riding." },
  references: [{
    sourceId: "source-1",
    url: "https://www.instagram.com/_dukeman390/",
    title: "The Duke 390",
    summary: "Duke 390 ownership and riding content",
    excerpt: "Rides, ownership, modifications and rider questions.",
    retrievedAt: "2026-08-15T18:23:00.000Z",
  }],
};

describe("BrandBrainBuilder", () => {
  it("uses a zero-tool Brand-private strategist invocation and returns allow-listed source-linked proposals", async () => {
    const runtime = new FakeRuntime({ proposals: [
      { section: "audience", fieldKey: "audience.primary", value: "Duke 390 owners and prospective owners.", sourceIds: ["source-1"] },
      { section: "voice", fieldKey: "voice.tone", value: "Direct, energetic and rider-to-rider.", sourceIds: ["source-1"] },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    const result = await builder.propose(input);

    expect(result).toHaveLength(2);
    expect(result[0]?.sourceIds).toEqual(["source-1"]);
    expect(runtime.request).toMatchObject({
      role: "strategist",
      scope: { visibility: "brand-private", workspaceId: "workspace-1", brandId: "brand-1" },
      capabilities: [],
      outputSchema: { name: "brand-brain-proposals", version: "1" },
      budget: { maxToolCalls: 0 },
    });
    expect(JSON.stringify(runtime.request?.task.context)).toContain("Duke 390 ownership and riding content");
  });

  it("accepts provisional proposals based only on owner context with no fabricated external provenance", async () => {
    const runtime = new FakeRuntime({ proposals: [
      { section: "positioning", fieldKey: "positioning.market-position", value: "A provisional rider-focused motorcycle content Brand.", sourceIds: [] },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    const result = await builder.propose({ ...input, references: [] });

    expect(result).toEqual([{ section: "positioning", fieldKey: "positioning.market-position", value: "A provisional rider-focused motorcycle content Brand.", sourceIds: [] }]);
    expect(runtime.request?.task.context).toMatchObject({ references: [] });
    expect(JSON.stringify(runtime.request?.task.instruction)).toContain("sourceIds must be an empty array");
  });

  it("infers a provisional source-backed Brand objective when the owner did not select one", async () => {
    const runtime = new FakeRuntime({ proposals: [
      { section: "goals", fieldKey: "goals.objectives", value: "Grow an engaged Duke ownership audience", sourceIds: ["source-1"] },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    const result = await builder.propose({ ...input, primaryObjective: undefined });

    expect(result).toEqual([{ section: "goals", fieldKey: "goals.objectives", value: "Grow an engaged Duke ownership audience", sourceIds: ["source-1"] }]);
    expect(runtime.request?.task.context).not.toHaveProperty("primaryObjective");
  });

  it("keeps an owner-selected objective authoritative", async () => {
    const runtime = new FakeRuntime({ proposals: [
      { section: "goals", fieldKey: "goals.objectives", value: "Replace the owner's goal", sourceIds: ["source-1"] },
      { section: "audience", fieldKey: "audience.primary", value: "Duke riders", sourceIds: ["source-1"] },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    const result = await builder.propose(input);

    expect(result).toEqual([{ section: "audience", fieldKey: "audience.primary", value: "Duke riders", sourceIds: ["source-1"] }]);
  });

  it("rejects source-backed goals without provenance", async () => {
    const runtime = new FakeRuntime({ proposals: [
      { section: "goals", fieldKey: "goals.objectives", value: "Grow audience", sourceIds: [] },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    await expect(builder.propose({ ...input, primaryObjective: undefined })).rejects.toThrow(/active source provenance/i);
  });

  it("rejects source IDs that were not supplied as inspected references", async () => {
    const runtime = new FakeRuntime({ proposals: [
      { section: "audience", fieldKey: "audience.primary", value: "An audience", sourceIds: ["foreign-source"] },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    await expect(builder.propose(input)).rejects.toThrow(/source/i);
  });

  it("accepts bounded source-backed visual direction in the existing content-strategy section", async () => {
    const runtime = new FakeRuntime({ proposals: [
      {
        section: "content-strategy",
        fieldKey: "content.imagery-direction",
        value: "Dynamic riding photography with clear subject focus.",
        sourceIds: ["source-1"],
      },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    await expect(builder.propose(input)).resolves.toEqual([{
      section: "content-strategy",
      fieldKey: "content.imagery-direction",
      value: "Dynamic riding photography with clear subject focus.",
      sourceIds: ["source-1"],
    }]);
  });

  it("accepts evidence-backed Brand Intelligence V2 proposals", async () => {
    const builder = new BrandBrainBuilder(new FakeRuntime({ proposals: [
      { section: "identity", fieldKey: "identity.sector", value: "Developer Technology", sourceIds: ["source-1"] },
      { section: "content-strategy", fieldKey: "content.core-topics", value: "AI agents, developer tools", sourceIds: ["source-1"] },
    ] }));
    await expect(builder.propose(input)).resolves.toMatchObject([
      { fieldKey: "identity.sector", sourceIds: ["source-1"] },
      { fieldKey: "content.core-topics", sourceIds: ["source-1"] },
    ]);
  });

  it("rejects visual direction without active supplied-source provenance", async () => {
    const runtime = new FakeRuntime({ proposals: [
      {
        section: "content-strategy",
        fieldKey: "content.logo-guidance",
        value: "Keep the logo in the lower-right corner.",
        sourceIds: [],
      },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    await expect(builder.propose(input)).rejects.toThrow(/active source provenance/i);
  });

  it("rejects oversized imported visual direction", async () => {
    const runtime = new FakeRuntime({ proposals: [
      {
        section: "content-strategy",
        fieldKey: "content.visual-direction",
        value: "x".repeat(2_001),
        sourceIds: ["source-1"],
      },
    ] });
    const builder = new BrandBrainBuilder(runtime);

    await expect(builder.propose(input)).rejects.toThrow(/value is invalid/i);
  });

  it("rejects empty, oversized or malformed proposal output", async () => {
    const malformed = [
      { proposals: [{ section: "audience", fieldKey: "audience.primary", value: "", sourceIds: ["source-1"] }] },
      { proposals: [{ section: "audience", fieldKey: "audience.primary", value: "x".repeat(10001), sourceIds: ["source-1"] }] },
      { proposals: [{ section: "audience", fieldKey: "audience.primary", value: "Audience" }] },
      { proposals: "not-an-array" },
    ];
    for (const output of malformed) {
      const builder = new BrandBrainBuilder(new FakeRuntime(output));
      await expect(builder.propose(input)).rejects.toThrow();
    }
  });
});
