import { describe, expect, it } from "vitest";
import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  AgentRuntimeResult,
  DiscoveryEvidence,
  ToolGatewayPort,
  ToolRequest,
  ToolResult,
} from "@kairo/agent-contracts";
import { HunterOrchestrator, type HunterJudgmentOutput, type HunterFailureDiagnostic } from "./hunter";
import type { DiscoverySourceDefinition } from "@kairo/domain/source-policy";

const evidence = [{
  title: "Persistent agents",
  summary: "Agent runtimes can keep durable working state.",
  sourceUrl: "https://example.com/persistent",
  platform: "web",
  retrievedAt: "2026-08-13T00:00:00.000Z",
  provider: "agent-reach",
  providerVersion: "93ae1d18c37b707dec053c7c4f9d91cd8ef8943d",
} satisfies DiscoveryEvidence];

class FakeTools implements ToolGatewayPort {
  requests: ToolRequest[] = [];
  constructor(
    private readonly output: DiscoveryEvidence[] = evidence,
    private readonly handler?: (request: ToolRequest) => DiscoveryEvidence[] | Promise<DiscoveryEvidence[]>,
    private readonly documentBody: string = evidence[0]!.summary!,
  ) {}
  async invoke<TOutput>(request: ToolRequest): Promise<ToolResult<TOutput>> {
    this.requests.push(request);
    if (request.capability === "public-content-fetch") return { output: { document: { canonicalUrl: String(request.input.url), platform: "web", sourceType: "article", title: evidence[0]!.title, body: this.documentBody, transcript: this.documentBody, retrievedAt: evidence[0]!.retrievedAt, contentHash: "sha256:" + "a".repeat(64), provider: "website", providerVersion: "v1", parserVersion: "v1", provenance: [{ provider: "website", sourceUrl: String(request.input.url), retrievedAt: evidence[0]!.retrievedAt }], confidence: 1, extractionWarnings: [], trust: "untrusted-evidence" } } as TOutput, provenance: [] };
    const output = this.handler ? await this.handler(request) : this.output;
    return { output: output as TOutput, provenance: [] };
  }
}

class FakeRuntime implements AgentRuntimePort {
  lastRequest: AgentInvocationRequest | null = null;
  calls = 0;
  constructor(private readonly output: HunterJudgmentOutput) {}
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.calls += 1;
    this.lastRequest = request;
    return { output: this.output as TOutput, metadata: { runtime: "fixture", latencyMs: 1 } };
  }
}

class FakeSink {
  records: unknown[] = [];
  async recordCandidate(_accountId: string, _brandId: string, input: unknown) {
    this.records.push(input);
    return { signal: { id: "signal-1" }, opportunity: { id: "opportunity-1" } } as never;
  }
}

const brand = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  contextVersion: "brand-1@7",
  brandName: "Kairo",
  positioning: "Content decision intelligence",
  audience: "Technical founders",
};

const scores = { relevance: 0.9, evidence: 0.8, novelty: 0.8, timeliness: 0.9, brandAuthority: 0.7, audienceFit: 0.9 };
const aiProfile = {
  sector: "Developer Technology",
  geographies: ["global"],
  languages: ["English"],
  audiences: ["technical founders"],
  topics: ["AI agents", "software architecture"],
  excludedTopics: [],
  goals: ["educate"],
};
const umrahProfile = {
  sector: "Religious Travel",
  geographies: ["India"],
  languages: ["English"],
  audiences: ["first-time pilgrims"],
  topics: ["Umrah visa", "pilgrimage guidance"],
  excludedTopics: [],
  goals: ["guide"],
};

describe("Hunter orchestration", () => {
  it("reports safe provider failure categories without logging raw errors or private context", async () => {
    const diagnostics: HunterFailureDiagnostic[] = [];
    const tools = new FakeTools([], () => {
      throw Object.assign(new Error("secret query, token and upstream response"), { kind: "rate-limited" });
    });
    const result = await new HunterOrchestrator(tools, new FakeRuntime({ candidates: [] }), new FakeSink() as never,
      undefined, (event) => { diagnostics.push(event); }).runForAuthorizedBrand({
      accountId: "account-1", brand, query: "private Brand query",
    });
    expect(result.degradedSources).toEqual(["agent-reach"]);
    expect(diagnostics).toEqual([{ phase: "discovery", source: "agent-reach", kind: "rate-limited" }]);
  });

  it("isolates diagnostic failures from a Hunter run", async () => {
    const tools = new FakeTools([], () => { throw new Error("unavailable"); });
    await expect(new HunterOrchestrator(tools, new FakeRuntime({ candidates: [] }), new FakeSink() as never,
      undefined, () => { throw new Error("logger failed"); }).runForAuthorizedBrand({
      accountId: "account-1", brand, query: "AI agents",
    })).resolves.toMatchObject({ evidenceCount: 0, degradedSources: ["agent-reach"] });
  });
  it("preserves the existing explicit-query path as one Agent Reach ToolGateway request", async () => {
    const runtime = new FakeRuntime({ candidates: [{
      sourceUrl: evidence[0]!.sourceUrl,
      title: "Persistent agents change SaaS architecture",
      rationale: "High audience fit",
      whyNow: "Runtime behavior is changing now",
      developmentDirection: "Explain multi-tenant architecture tradeoffs",
      scores,
    }] });
    const tools = new FakeTools();
    const sink = new FakeSink();
    const hunter = new HunterOrchestrator(tools, runtime, sink as never);
    const result = await hunter.runForAuthorizedBrand({ accountId: "account-1", brand, query: "AI agents", intelligenceVersion: 4 });

    expect(result).toEqual({ evidenceCount: 1, candidateCount: 1, opportunityCount: 1 });
    const searches = tools.requests.filter((request) => request.capability === "public-content-search");
    expect(searches).toHaveLength(1);
    expect(searches[0]?.input.query).toBe("AI agents");
    expect(searches[0]?.input.source).toBeUndefined();
    expect(tools.requests.some((request) => request.capability === "public-content-fetch")).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ details: { topic: "Persistent agents change SaaS architecture", proposedAngle: "Explain multi-tenant architecture tradeoffs", intelligenceVersion: 4 } });
    expect(runtime.lastRequest?.scope).toEqual({ visibility: "brand-private", workspaceId: "workspace-1", brandId: "brand-1" });
    expect(runtime.lastRequest?.budget.maxToolCalls).toBe(0);
  });

  it("routes explicit queries to configured public sources when Agent Reach is unavailable", async () => {
    const registry: DiscoverySourceDefinition[] = [
      { key: "agent-reach", capabilities: ["discovery"], enabled: false, requiresCredential: false, maxQueriesPerRun: 2 },
      { key: "github", capabilities: ["discovery"], enabled: true, requiresCredential: false, maxQueriesPerRun: 2 },
    ];
    const tools = new FakeTools([]);
    const result = await new HunterOrchestrator(tools, new FakeRuntime({ candidates: [] }), new FakeSink() as never, registry)
      .runForAuthorizedBrand({ accountId: "account-1", brand, query: "AI agents" });

    expect(result).toMatchObject({ evidenceCount: 0, candidateCount: 0, opportunityCount: 0 });
    expect(tools.requests.filter((request) => request.capability === "public-content-search").map((request) => request.input.source)).toEqual(["github"]);
  });

  it("bounds enriched evidence summaries before persistence", async () => {
    const runtime = new FakeRuntime({ candidates: [{
      sourceUrl: evidence[0]!.sourceUrl,
      title: "Persistent agents change SaaS architecture",
      rationale: "High audience fit",
      whyNow: "Runtime behavior is changing now",
      developmentDirection: "Explain multi-tenant architecture tradeoffs",
      scores,
    }] });
    const sink = new FakeSink();
    const hunter = new HunterOrchestrator(new FakeTools(evidence, undefined, "x".repeat(3_000)), runtime, sink as never);

    await hunter.runForAuthorizedBrand({ accountId: "account-1", brand, query: "AI agents" });

    const record = sink.records[0] as { signal: { summary: string } };
    expect(record.signal.summary).toHaveLength(2_000);
  });

  it("bounds fetched transcript text at the model boundary", async () => {
    const runtime = new FakeRuntime({ candidates: [] });
    const hunter = new HunterOrchestrator(new FakeTools(evidence, undefined, "x".repeat(100_000)), runtime, new FakeSink() as never);

    await hunter.runForAuthorizedBrand({ accountId: "account-1", brand, query: "AI agents" });

    const context = runtime.lastRequest?.task.context as { evidence?: Array<{ summary?: string; transcript?: string }> } | undefined;
    expect(context?.evidence?.[0]?.summary).toHaveLength(600);
    expect(context?.evidence?.[0]).not.toHaveProperty("transcript");
    expect(JSON.stringify(context)).not.toContain("x".repeat(601));
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(12_000);
  });

  it("executes materially different multi-source plans for AI and Umrah through the same Hunter", async () => {
    const aiTools = new FakeTools([], () => []);
    const umrahTools = new FakeTools([], () => []);

    await new HunterOrchestrator(aiTools, new FakeRuntime({ candidates: [] }), new FakeSink() as never).runForAuthorizedBrand({
      accountId: "account-1",
      brand,
      intelligenceProfile: aiProfile,
    });
    await new HunterOrchestrator(umrahTools, new FakeRuntime({ candidates: [] }), new FakeSink() as never).runForAuthorizedBrand({
      accountId: "account-1",
      brand,
      intelligenceProfile: umrahProfile,
    });

    const aiSearches = aiTools.requests.filter((request) => request.capability === "public-content-search");
    const umrahSearches = umrahTools.requests.filter((request) => request.capability === "public-content-search");
    const aiSources = new Set(aiSearches.map((request) => request.input.source));
    const umrahSources = new Set(umrahSearches.map((request) => request.input.source));
    expect(aiSources).toEqual(new Set(["github", "hacker-news", "rss", "youtube", "bluesky", "agent-reach"]));
    expect(umrahSources).toEqual(new Set(["rss", "youtube", "agent-reach", "bluesky"]));
    expect(umrahSources.has("hacker-news")).toBe(false);
    expect(aiSearches.length).toBeLessThanOrEqual(16);
    expect(umrahSearches.length).toBeLessThanOrEqual(16);
  });

  it("isolates a degraded provider and continues with evidence from healthy providers", async () => {
    const rssEvidence = [{
      title: "Healthy RSS evidence",
      sourceUrl: "https://example.com/healthy",
      platform: "rss",
      retrievedAt: "2026-08-14T20:00:00.000Z",
      provider: "rss",
    } satisfies DiscoveryEvidence];
    const tools = new FakeTools([], (request) => {
      if (request.input.source === "hacker-news") throw new Error("HN unavailable");
      if (request.input.source === "rss") return rssEvidence;
      return [];
    });
    const runtime = new FakeRuntime({ candidates: [] });
    const result = await new HunterOrchestrator(tools, runtime, new FakeSink() as never).runForAuthorizedBrand({
      accountId: "account-1",
      brand,
      intelligenceProfile: aiProfile,
      maxEvidence: 8,
    });

    expect(result).toEqual({ evidenceCount: 1, candidateCount: 0, opportunityCount: 0, degradedSources: ["hacker-news"] });
    expect(tools.requests.filter((request) => request.input.source === "hacker-news")).toHaveLength(1);
    expect(tools.requests.some((request) => request.input.source === "rss")).toBe(true);
    expect(runtime.calls).toBe(1);
  });

  it("deduplicates the same canonical URL across providers before model judgment", async () => {
    const tools = new FakeTools([], (request) => {
      if (request.input.source === "rss") return [{
        title: "Same story from RSS",
        sourceUrl: "https://example.com/story?utm_source=rss&id=7",
        platform: "rss",
        retrievedAt: "2026-08-14T20:00:00.000Z",
        provider: "rss",
      }];
      if (request.input.source === "youtube") return [{
        title: "Same canonical evidence",
        sourceUrl: "https://example.com/story?id=7&utm_campaign=video",
        platform: "youtube",
        retrievedAt: "2026-08-14T20:00:00.000Z",
        provider: "youtube",
      }];
      return [];
    });
    const runtime = new FakeRuntime({ candidates: [] });
    const result = await new HunterOrchestrator(tools, runtime, new FakeSink() as never).runForAuthorizedBrand({
      accountId: "account-1",
      brand,
      intelligenceProfile: aiProfile,
      maxEvidence: 8,
    });

    expect(result.evidenceCount).toBe(1);
    const context = runtime.lastRequest?.task.context as { evidence?: unknown[] } | undefined;
    expect(context?.evidence).toHaveLength(1);
  });

  it("returns zero opportunities without invoking the model when discovery returns no evidence", async () => {
    const tools = new FakeTools([]);
    const runtime = new FakeRuntime({ candidates: [] });
    const sink = new FakeSink();
    const hunter = new HunterOrchestrator(tools, runtime, sink as never);

    const result = await hunter.runForAuthorizedBrand({ accountId: "account-1", brand, query: "no evidence" });

    expect(result).toEqual({ evidenceCount: 0, candidateCount: 0, opportunityCount: 0 });
    expect(runtime.lastRequest).toBeNull();
    expect(sink.records).toHaveLength(0);
  });

  it("returns no Opportunity when judgment returns no strong candidates", async () => {
    const sink = new FakeSink();
    const hunter = new HunterOrchestrator(new FakeTools(), new FakeRuntime({ candidates: [] }), sink as never);
    const result = await hunter.runForAuthorizedBrand({ accountId: "account-1", brand, query: "AI agents" });
    expect(result).toEqual({ evidenceCount: 1, candidateCount: 0, opportunityCount: 0 });
    expect(sink.records).toHaveLength(0);
  });

  it("drops candidates that do not reference supplied evidence", async () => {
    const sink = new FakeSink();
    const hunter = new HunterOrchestrator(new FakeTools(), new FakeRuntime({ candidates: [{
      sourceUrl: "https://fabricated.example/no-evidence",
      title: "Fabricated",
      rationale: "Should not pass",
      whyNow: "Never",
      developmentDirection: "None",
      scores,
    }] }), sink as never);
    const result = await hunter.runForAuthorizedBrand({ accountId: "account-1", brand, query: "AI agents" });
    expect(result.opportunityCount).toBe(0);
    expect(sink.records).toHaveLength(0);
  });

  it("fails closed when a candidate has strong numeric scores but no Brand DNA match", async () => {
    const sink = new FakeSink();
    const hunter = new HunterOrchestrator(new FakeTools(), new FakeRuntime({ candidates: [{
      sourceUrl: evidence[0]!.sourceUrl,
      title: "A generic productivity trend",
      rationale: "Popular with many teams",
      whyNow: "It is currently discussed",
      developmentDirection: "Write a broad trend post",
      scores,
    }] }), sink as never);

    const result = await hunter.runForAuthorizedBrand({
      accountId: "account-1",
      brand,
      intelligenceProfile: { ...aiProfile, topics: ["zzzz topic"], audiences: ["yyyy audience"], goals: ["xxxx goal"], sector: "qqqq sector" },
    });

    expect(result.opportunityCount).toBe(0);
    expect(sink.records).toHaveLength(0);
  });

  it("rotates automatic queries on refresh without changing the evidence contract", async () => {
    const baselineTools = new FakeTools([], () => []);
    const refreshedTools = new FakeTools([], () => []);
    await new HunterOrchestrator(baselineTools, new FakeRuntime({ candidates: [] }), new FakeSink() as never).runForAuthorizedBrand({
      accountId: "account-1", brand, intelligenceProfile: aiProfile,
    });
    await new HunterOrchestrator(refreshedTools, new FakeRuntime({ candidates: [] }), new FakeSink() as never).runForAuthorizedBrand({
      accountId: "account-1", brand, intelligenceProfile: aiProfile, refreshSeed: "2026-08-27T13:00:00.000Z",
    });
    const baseline = baselineTools.requests.find((request) => request.capability === "public-content-search" && request.input.source !== "github");
    const refreshed = refreshedTools.requests.find((request) => request.capability === "public-content-search" && request.input.source !== "github");
    expect(refreshed?.input.query).not.toBe(baseline?.input.query);
  });

  it("does not recreate a previously surfaced idea with the same substance", async () => {
    const sink = new FakeSink();
    const hunter = new HunterOrchestrator(new FakeTools(), new FakeRuntime({ candidates: [{
      sourceUrl: evidence[0]!.sourceUrl,
      title: "Persistent agents change SaaS architecture",
      rationale: "High audience fit",
      whyNow: "Runtime behavior is changing now",
      developmentDirection: "Explain multi-tenant architecture tradeoffs",
      scores,
    }] }), sink as never);
    const result = await hunter.runForAuthorizedBrand({
      accountId: "account-1", brand, query: "AI agents", existingOpportunityTitles: ["Persistent agents change SaaS architecture"],
    });
    expect(result.opportunityCount).toBe(0);
    expect(sink.records).toHaveLength(0);
  });
});
