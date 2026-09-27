import { describe, expect, it, vi } from "vitest";
import { ExaAgentReachSearchBackend, agentReachSearchBackendFromEnv } from "./agent-reach-exa-backend";
import { AgentReachDiscoveryProvider } from "@kairo/worker/discovery-provider";

describe("Agent Reach Exa backend", () => {
  it("uses the fixed approved endpoint and normalizes bounded result fields", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [{
      title: "Notion AI updates", url: "https://www.notion.so/blog/ai", author: "Notion", publishedDate: "2026-09-01T00:00:00.000Z", highlights: ["A useful update"],
    }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const backend = new ExaAgentReachSearchBackend("secret", fetchImpl);

    await expect(backend.search("notion ai", { maxResults: 3, timeoutMs: 1_000, signal: new AbortController().signal }))
      .resolves.toEqual([expect.objectContaining({ title: "Notion AI updates", url: "https://www.notion.so/blog/ai", summary: "A useful update", platform: "web" })]);

    expect(fetchImpl).toHaveBeenCalledWith("https://api.exa.ai/search", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "x-api-key": "secret" }),
    }));
  });

  it("does not advertise a runtime backend without the required server-side key", () => {
    expect(agentReachSearchBackendFromEnv({})).toBeUndefined();
    expect(agentReachSearchBackendFromEnv({ EXA_API_KEY: "key" })).toBeInstanceOf(ExaAgentReachSearchBackend);
  });

  it("bounds Exa text and drops invalid dates before evidence validation", async () => {
    const backend = new ExaAgentReachSearchBackend("secret", async () => new Response(JSON.stringify({ results: [{
      title: "T".repeat(350), url: "https://example.com/story", author: "A".repeat(250),
      publishedDate: "not a date", highlights: ["S".repeat(2_500)],
    }] }), { status: 200 }));
    const provider = new AgentReachDiscoveryProvider(backend);
    await expect(provider.discover({ query: "public", scope: { visibility: "global-public" }, maxResults: 1, timeoutMs: 1_000 }))
      .resolves.toEqual([expect.objectContaining({
        title: "T".repeat(300), summary: "S".repeat(2_000), author: "A".repeat(200),
      })]);
  });

  it("classifies Exa rate limiting without exposing response text", async () => {
    const backend = new ExaAgentReachSearchBackend("secret", async () => new Response("private upstream detail", { status: 429 }));
    await expect(new AgentReachDiscoveryProvider(backend).discover({
      query: "public", scope: { visibility: "global-public" }, maxResults: 1, timeoutMs: 1_000,
    })).rejects.toMatchObject({ kind: "rate-limited", statusCode: 429 });
  });

  it("rejects oversized upstream responses", async () => {
    const backend = new ExaAgentReachSearchBackend("secret", async () => new Response("{}", { headers: { "content-length": "2000001" } }));
    await expect(backend.search("notion", { maxResults: 2, timeoutMs: 1_000, signal: new AbortController().signal }))
      .rejects.toThrow("size limit");
  });
});
