import { describe, expect, it } from "vitest";
import { prepareNormalizedSourceDocument, prepareToolRequest, type DiscoveryRequest, type DiscoverySourceProvider, type PublicContentFetchPort } from "@kairo/agent-contracts";
import {
  AGENT_REACH_PIN,
  AgentReachDiscoveryProvider,
  DiscoveryProviderError,
  KairoToolGateway,
  SourceRoutingToolGateway,
  type AgentReachSearchBackend,
} from "./discovery-provider";

class FakeBackend implements AgentReachSearchBackend {
  calls: Array<{ query: string; maxResults: number; timeoutMs: number }> = [];
  async search(query: string, options: { maxResults: number; timeoutMs: number; signal: AbortSignal }) {
    this.calls.push({ query, maxResults: options.maxResults, timeoutMs: options.timeoutMs });
    return [
      { title: "Useful evidence", url: "https://example.com/story?utm_source=x", platform: "web", publisher: "Example" },
      { title: "Second result", url: "https://example.org/second", platform: "web" },
    ];
  }
}

class FakeSource implements DiscoverySourceProvider {
  calls: DiscoveryRequest[] = [];
  constructor(private readonly provider: string) {}
  async discover(request: DiscoveryRequest) {
    this.calls.push(request);
    return [{
      title: `${this.provider} result`,
      sourceUrl: `https://example.com/${this.provider}`,
      platform: this.provider,
      retrievedAt: "2026-08-14T20:00:00.000Z",
      provider: this.provider,
    }];
  }
}

class FakeFetcher implements PublicContentFetchPort {
  calls: string[] = [];
  async fetch(request: Parameters<PublicContentFetchPort["fetch"]>[0]) {
    this.calls.push(request.url);
    return {
      adapterId: "website",
      cacheHit: false,
      document: prepareNormalizedSourceDocument({
        canonicalUrl: request.url,
        platform: "website",
        sourceType: "website",
        title: "Fetched page",
        body: "Untrusted source body",
        retrievedAt: "2026-08-26T07:00:00.000Z",
        contentHash: "sha256:test",
        provider: "secure-http",
        providerVersion: "2",
        parserVersion: "html-v1",
        provenance: [{ provider: "secure-http", sourceUrl: request.url, retrievedAt: "2026-08-26T07:00:00.000Z" }],
        confidence: 1,
        extractionWarnings: [],
      }),
    };
  }
}

describe("Discovery provider boundary", () => {
  it("normalizes public evidence and pins Agent Reach provenance", async () => {
    const backend = new FakeBackend();
    const provider = new AgentReachDiscoveryProvider(backend, () => new Date("2026-08-13T00:00:00.000Z"));
    const result = await provider.discover({ query: "AI agents", scope: { visibility: "global-public" }, maxResults: 1, timeoutMs: 1000 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Useful evidence",
      sourceUrl: "https://example.com/story?utm_source=x",
      provider: "agent-reach",
      providerVersion: AGENT_REACH_PIN,
      retrievedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(backend.calls).toEqual([{ query: "AI agents", maxResults: 1, timeoutMs: 1000 }]);
  });

  it("rejects unsafe/private URLs before evidence can leave Agent Reach", async () => {
    const provider = new AgentReachDiscoveryProvider({
      async search() { return [{ title: "Unsafe", url: "http://127.0.0.1/private" }]; },
    });
    await expect(provider.discover({ query: "x", scope: { visibility: "global-public" }, maxResults: 1, timeoutMs: 1000 }))
      .rejects.toBeInstanceOf(DiscoveryProviderError);
  });

  it("keeps legacy KairoToolGateway calls on Agent Reach without requiring a source key", async () => {
    const backend = new FakeBackend();
    const gateway = new KairoToolGateway(new AgentReachDiscoveryProvider(backend, () => new Date("2026-08-13T00:00:00.000Z")));
    const request = prepareToolRequest({
      capability: "public-content-search",
      scope: { visibility: "global-public" },
      input: { query: "AI agents", maxResults: 2 },
      timeoutMs: 1000,
    });
    const result = await gateway.invoke<unknown[]>(request);
    expect(result.provenance).toHaveLength(2);
    expect(result.provenance[0]?.providerVersion).toBe(AGENT_REACH_PIN);
    expect(backend.calls).toHaveLength(1);
    expect(JSON.stringify(request.input)).not.toContain("command");
  });

  it("routes an explicit source key to the registered provider", async () => {
    const fallback = new FakeSource("agent-reach");
    const rss = new FakeSource("rss");
    const gateway = new SourceRoutingToolGateway(fallback, { rss });
    const request = prepareToolRequest({
      capability: "public-content-search",
      scope: { visibility: "global-public" },
      input: { source: "rss", query: "Umrah visa", maxResults: 3 },
      timeoutMs: 1000,
    });

    const result = await gateway.invoke<unknown[]>(request);

    expect(rss.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
    expect(result.provenance[0]?.provider).toBe("rss");
  });

  it("fails closed for an unknown source instead of silently falling back", async () => {
    const gateway = new SourceRoutingToolGateway(new FakeSource("agent-reach"), {});
    const request = prepareToolRequest({
      capability: "public-content-search",
      scope: { visibility: "global-public" },
      input: { source: "unknown-provider", query: "AI", maxResults: 2 },
      timeoutMs: 1000,
    });
    await expect(gateway.invoke(request)).rejects.toThrow(/not registered/i);
  });

  it("implements public-content-fetch through the Kairo-owned fetch port", async () => {
    const fetcher = new FakeFetcher();
    const gateway = new SourceRoutingToolGateway(new FakeSource("agent-reach"), {}, fetcher);
    const request = prepareToolRequest({
      capability: "public-content-fetch",
      scope: { visibility: "brand-private", workspaceId: "w1", brandId: "b1" },
      input: { url: "https://example.com" },
      timeoutMs: 1000,
    });
    const result = await gateway.invoke<{ document: { trust: string }; adapterId: string }>(request);
    expect(fetcher.calls).toEqual(["https://example.com"]);
    expect(result.output.document.trust).toBe("untrusted-evidence");
    expect(result.provenance[0]).toMatchObject({ provider: "secure-http", sourceUrl: "https://example.com/" });
  });

  it("reports fetch unavailable truthfully when no fetch port is configured", async () => {
    const gateway = new SourceRoutingToolGateway(new FakeSource("agent-reach"));
    await expect(gateway.invoke(prepareToolRequest({
      capability: "public-content-fetch",
      scope: { visibility: "global-public" },
      input: { url: "https://example.com" },
      timeoutMs: 1000,
    }))).rejects.toThrow(/not configured/i);
  });

  it("bounds result count before the Agent Reach backend runs", async () => {
    const provider = new AgentReachDiscoveryProvider(new FakeBackend());
    const bad: DiscoveryRequest = { query: "AI", scope: { visibility: "global-public" }, maxResults: 21, timeoutMs: 1000 };
    await expect(provider.discover(bad)).rejects.toThrow(/maxResults/);
  });
});
