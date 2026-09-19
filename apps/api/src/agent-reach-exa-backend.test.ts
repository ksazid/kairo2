import { describe, expect, it, vi } from "vitest";
import { ExaAgentReachSearchBackend, agentReachSearchBackendFromEnv } from "./agent-reach-exa-backend";

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

  it("rejects oversized upstream responses", async () => {
    const backend = new ExaAgentReachSearchBackend("secret", async () => new Response("{}", { headers: { "content-length": "2000001" } }));
    await expect(backend.search("notion", { maxResults: 2, timeoutMs: 1_000, signal: new AbortController().signal }))
      .rejects.toThrow("size limit");
  });
});
