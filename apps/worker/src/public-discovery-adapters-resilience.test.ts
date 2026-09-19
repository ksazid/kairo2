import { describe, expect, it } from "vitest";
import type { DiscoveryRequest } from "@kairo/agent-contracts";
import {
  BlueskyDiscoveryProvider,
  HackerNewsDiscoveryProvider,
  RssAtomDiscoveryProvider,
} from "./public-discovery-adapters";
import { RetryingDiscoverySourceProvider } from "./retrying-discovery-provider";

const request: DiscoveryRequest = {
  query: "AI",
  scope: { visibility: "global-public" },
  maxResults: 3,
  timeoutMs: 1_000,
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("VS-13 public discovery resilience", () => {
  it("retries transient failures from public discovery adapters", async () => {
    let calls = 0;
    const provider = new RetryingDiscoverySourceProvider(new BlueskyDiscoveryProvider({
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? json({ error: "temporary" }, 500) : json({ posts: [] });
      },
    }), { sleep: async () => undefined });
    await expect(provider.discover(request)).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it("rejects unsafe RSS feed locations before any network call", () => {
    let calls = 0;
    expect(() => new RssAtomDiscoveryProvider({
      feeds: [{ key: "unsafe", url: "http://127.0.0.1/feed.xml", tags: ["ai"] }],
      fetchImpl: async () => { calls += 1; return new Response(""); },
    })).toThrow(/public HTTP\(S\)/i);
    expect(calls).toBe(0);
  });

  it("reuses Hacker News list/item cache within the configured TTL", async () => {
    let calls = 0;
    const provider = new HackerNewsDiscoveryProvider({
      maxItemsToInspect: 1,
      cacheTtlMs: 60_000,
      fetchImpl: async (input) => {
        calls += 1;
        const url = String(input);
        if (url.endsWith("/topstories.json")) return json([1]);
        if (url.endsWith("/newstories.json")) return json([1]);
        if (url.endsWith("/item/1.json")) return json({ id: 1, type: "story", title: "AI systems", url: "https://example.com/ai", time: 1786730000 });
        throw new Error("unexpected URL");
      },
    });

    await provider.discover(request);
    await provider.discover(request);

    expect(calls).toBe(3);
  });

  it("classifies Bluesky 429 as provider-local rate limiting", async () => {
    const provider = new BlueskyDiscoveryProvider({ fetchImpl: async () => json({ error: "rate" }, 429) });
    await expect(provider.discover(request)).rejects.toMatchObject({ kind: "rate-limited" });
  });
});
