import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort, AgentRuntimeResult, DiscoveryEvidence, ToolGatewayPort, ToolRequest, ToolResult } from "@kairo/agent-contracts";
import type { ResearchDossier } from "@kairo/domain/research";
import { ResearcherOrchestrator, type ResearcherOutput } from "./researcher";

const baseEvidence: DiscoveryEvidence = {
  title: "Public web topic evidence",
  summary: "General public evidence about the public web topic.",
  sourceUrl: "https://example.com/general",
  platform: "web",
  retrievedAt: "2026-08-15T16:00:00.000Z",
  provider: "fixture",
};

const openAlexEvidence: DiscoveryEvidence = {
  title: "AI agent evaluation scholarly evidence",
  summary: "Peer reviewed evidence about AI agent evaluation.",
  sourceUrl: "https://doi.org/10.1234/shared",
  platform: "research",
  publishedAt: "2026-07-01T00:00:00.000Z",
  retrievedAt: "2026-08-15T16:01:00.000Z",
  provider: "openalex",
  providerVersion: "works-v1",
};

const crossrefDuplicate: DiscoveryEvidence = {
  ...openAlexEvidence,
  title: "Same AI agent evaluation DOI from Crossref",
  sourceUrl: "https://doi.org/10.1234/SHARED?utm_source=test",
  provider: "crossref",
  providerVersion: "rest-v1",
};

class RecordingTools implements ToolGatewayPort {
  requests: ToolRequest[] = [];
  constructor(private readonly failSource?: string) {}
  async invoke<TOutput>(request: ToolRequest): Promise<ToolResult<TOutput>> {
    this.requests.push(request);
    const source = typeof request.input.source === "string" ? request.input.source : "general";
    if (source === this.failSource) throw new Error(`${source} unavailable`);
    const output = source === "openalex" ? [openAlexEvidence]
      : source === "crossref" ? [crossrefDuplicate]
      : [baseEvidence];
    return { output: output as TOutput, provenance: [] };
  }
}

class FakeRuntime implements AgentRuntimePort {
  lastRequest: AgentInvocationRequest | null = null;
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.lastRequest = request;
    const supplied = Array.isArray(request.task.context.evidence) ? request.task.context.evidence : [];
    const evidenceIds = supplied.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const id = (item as Record<string, unknown>).id;
      return typeof id === "string" ? [id] : [];
    });
    const output: ResearcherOutput = {
      summary: "Evidence-backed summary",
      importantContext: ["Context"],
      competingInterpretations: ["Interpretation"],
      unresolvedUncertainties: ["Uncertainty"],
      claims: [{
        text: "The evidence supports the research topic.",
        classification: "fact",
        confidence: 0.8,
        evidenceStrength: "strong",
        verificationState: "supported",
        freshness: "fresh",
        evidenceIds,
        firstPersonAuthorization: "not-applicable",
      }],
    };
    return { output: output as TOutput, metadata: { runtime: "fixture", provider: "test", model: "test", latencyMs: 1 } };
  }
}

class FakeSink {
  saved: ResearchDossier[] = [];
  async saveResearchDossier(_accountId: string, dossier: ResearchDossier) { this.saved.push(dossier); }
}

const input = {
  accountId: "account-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  brandContextVersion: "brand-1@8",
  idea: { id: "idea-1", title: "Private Brand phrasing", premise: "Private positioning stays local" },
  query: "public web topic",
  publicResearchQuery: "AI agent evaluation",
  maxEvidence: 8,
};

describe("VS-22 Researcher evidence enrichment", () => {
  it("fans out only the explicit public research query to OpenAlex/Crossref and deduplicates DOI evidence", async () => {
    const tools = new RecordingTools();
    const runtime = new FakeRuntime();
    const sink = new FakeSink();
    const researcher = new ResearcherOrchestrator(tools, runtime, sink);

    const result = await researcher.run(input);

    expect(tools.requests).toHaveLength(3);
    expect(tools.requests.map((request) => request.input.source ?? "general")).toEqual(["general", "openalex", "crossref"]);
    for (const request of tools.requests) expect(request.scope).toEqual({ visibility: "global-public" });
    expect(tools.requests[1]?.input.query).toBe("AI agent evaluation");
    expect(tools.requests[2]?.input.query).toBe("AI agent evaluation");
    expect(JSON.stringify(tools.requests.slice(1))).not.toContain("Private Brand phrasing");
    expect(JSON.stringify(tools.requests.slice(1))).not.toContain("Private positioning stays local");
    expect(result).toMatchObject({ evidenceCount: 2, claimCount: 1 });
    expect(result.degradedSources).toBeUndefined();
    expect(sink.saved[0]?.evidence.map((item) => item.sourceUrl)).toEqual([
      "https://example.com/general",
      "https://doi.org/10.1234/shared",
    ]);
  });

  it("does not call scholarly providers without an explicit public-only query", async () => {
    const tools = new RecordingTools();
    const runtime = new FakeRuntime();
    const sink = new FakeSink();
    const researcher = new ResearcherOrchestrator(tools, runtime, sink);

    const { publicResearchQuery: _omitted, ...withoutPublicResearch } = input;
    const result = await researcher.run({ ...withoutPublicResearch, maxEvidence: 1 });

    expect(tools.requests).toHaveLength(1);
    expect(tools.requests[0]?.input.source).toBeUndefined();
    expect(result.evidenceCount).toBe(1);
  });

  it("degrades one scholarly source without fabricating success when other evidence remains", async () => {
    const tools = new RecordingTools("openalex");
    const runtime = new FakeRuntime();
    const sink = new FakeSink();
    const researcher = new ResearcherOrchestrator(tools, runtime, sink);

    const result = await researcher.run(input);

    expect(result.degradedSources).toEqual(["openalex"]);
    expect(result.evidenceCount).toBe(2);
    expect(tools.requests.map((request) => request.input.source ?? "general")).toEqual(["general", "openalex", "crossref"]);
  });
});
