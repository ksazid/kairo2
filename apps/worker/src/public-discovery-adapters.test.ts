import { describe, expect, it } from "vitest";
import type { DiscoveryRequest } from "@kairo/agent-contracts";
import {
  BlueskyDiscoveryProvider,
  HackerNewsDiscoveryProvider,
  PublicDiscoveryAdapterError,
  RssAtomDiscoveryProvider,
  YouTubeDiscoveryProvider,
} from "./public-discovery-adapters";

const request = (query: string, maxResults = 5): DiscoveryRequest => ({
  query,
  scope: { visibility: "global-public" },
  maxResults,
  timeoutMs: 1_000,
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("VS-13 RSS/Atom discovery adapter", () => {
  it("uses one generic tagged feed adapter and normalizes RSS evidence", async () => {
    const calls: string[] = [];
    const rss = `<?xml version="1.0"?><rss><channel><title>AI Feed</title><item><title>AI agents reach production</title><link>https://example.com/agents?utm_source=rss</link><description><![CDATA[<p>Architecture update</p>]]></description><pubDate>Fri, 14 Aug 2026 18:00:00 GMT</pubDate></item></channel></rss>`;
    const provider = new RssAtomDiscoveryProvider({
      feeds: [
        { key: "ai", url: "https://feeds.example.com/ai.xml", tags: ["ai", "agents"], publisher: "AI Feed" },
        { key: "umrah", url: "https://feeds.example.com/umrah.xml", tags: ["umrah", "travel"] },
      ],
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(rss, { status: 200, headers: { "content-type": "application/rss+xml" } });
      },
      now: () => new Date("2026-08-14T20:00:00.000Z"),
    });

    const result = await provider.discover(request("AI agents", 3));

    expect(calls).toEqual(["https://feeds.example.com/ai.xml"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "AI agents reach production",
      sourceUrl: "https://example.com/agents?utm_source=rss",
      summary: "Architecture update",
      platform: "rss",
      publisher: "AI Feed",
      provider: "rss",
      providerVersion: "rss-atom-v1",
      retrievedAt: "2026-08-14T20:00:00.000Z",
    });
  });

  it("normalizes Atom entries and isolates a malformed sibling feed", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Travel</title><entry><title>Umrah visa guidance update</title><link rel="alternate" href="https://example.org/umrah"/><summary>New guidance for pilgrims</summary><updated>2026-08-14T19:00:00Z</updated><author><name>Travel Desk</name></author></entry></feed>`;
    const provider = new RssAtomDiscoveryProvider({
      feeds: [
        { key: "bad", url: "https://feeds.example.com/bad.xml", tags: ["umrah"] },
        { key: "good", url: "https://feeds.example.com/good.xml", tags: ["umrah"] },
      ],
      fetchImpl: async (input) => String(input).includes("bad")
        ? new Response("<!DOCTYPE bad><rss>", { status: 200 })
        : new Response(atom, { status: 200 }),
      now: () => new Date("2026-08-14T20:00:00.000Z"),
    });

    const result = await provider.discover(request("Umrah visa"));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Umrah visa guidance update",
      sourceUrl: "https://example.org/umrah",
      author: "Travel Desk",
      provider: "rss",
    });
  });
});

describe("VS-13 Hacker News discovery adapter", () => {
  it("uses the official v0 API with bounded item fan-out and deterministic relevance", async () => {
    const calls: string[] = [];
    const provider = new HackerNewsDiscoveryProvider({
      maxItemsToInspect: 3,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/topstories.json")) return jsonResponse([101, 102, 103, 104]);
        if (url.endsWith("/newstories.json")) return jsonResponse([103, 105]);
        if (url.endsWith("/item/101.json")) return jsonResponse({ id: 101, type: "story", title: "AI agent runtime patterns", url: "https://example.com/ai", time: 1786730000, by: "alice" });
        if (url.endsWith("/item/102.json")) return jsonResponse({ id: 102, type: "story", title: "Gardening notes", url: "https://example.com/garden", time: 1786730001 });
        if (url.endsWith("/item/103.json")) return jsonResponse({ id: 103, type: "story", title: "Developer AI tools", time: 1786730002, by: "bob" });
        throw new Error(`unexpected ${url}`);
      },
      now: () => new Date("2026-08-14T20:00:00.000Z"),
    });

    const result = await provider.discover(request("AI developer", 5));

    expect(calls.filter((url) => url.includes("/item/")).length).toBeLessThanOrEqual(3);
    expect(result.map((item) => item.title)).toEqual(["Developer AI tools", "AI agent runtime patterns"]);
    expect(result[0]?.sourceUrl).toBe("https://news.ycombinator.com/item?id=103");
    expect(result.every((item) => item.provider === "hacker-news")).toBe(true);
    expect(result.every((item) => item.providerVersion === "v0")).toBe(true);
  });
});

describe("VS-13 Bluesky discovery adapter", () => {
  it("uses the public AppView without authentication and normalizes public post URLs", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const provider = new BlueskyDiscoveryProvider({
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenInit = init;
        return jsonResponse({ posts: [{
          uri: "at://did:plc:abc/app.bsky.feed.post/3lxyz",
          author: { did: "did:plc:abc", handle: "alice.bsky.social", displayName: "Alice" },
          record: { text: "AI agents are moving into production", createdAt: "2026-08-14T19:30:00.000Z" },
          indexedAt: "2026-08-14T19:31:00.000Z",
        }] });
      },
      now: () => new Date("2026-08-14T20:00:00.000Z"),
    });

    const result = await provider.discover(request("AI agents", 2));

    expect(seenUrl).toContain("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts");
    expect(seenUrl).toContain("q=AI+agents");
    expect(seenUrl).toContain("limit=2");
    expect(JSON.stringify(seenInit?.headers ?? {})).not.toMatch(/authorization/i);
    expect(result[0]).toMatchObject({
      sourceUrl: "https://bsky.app/profile/alice.bsky.social/post/3lxyz",
      platform: "bluesky",
      author: "alice.bsky.social",
      provider: "bluesky",
      providerVersion: "app.bsky.feed.searchPosts",
    });
  });
});

describe("VS-13 YouTube discovery adapter", () => {
  it("fails closed without a key before making a network request", async () => {
    let calls = 0;
    const provider = new YouTubeDiscoveryProvider({
      apiKey: "  ",
      fetchImpl: async () => { calls += 1; return jsonResponse({ items: [] }); },
    });

    await expect(provider.discover(request("AI agents"))).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toBe(0);
  });

  it("uses one bounded search.list request and never leaks the key into evidence", async () => {
    let seenUrl = "";
    const provider = new YouTubeDiscoveryProvider({
      apiKey: "super-secret-youtube-key",
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return jsonResponse({ items: [{
          id: { kind: "youtube#video", videoId: "abc123" },
          snippet: {
            title: "AI agent architecture",
            description: "A practical architecture walkthrough",
            channelTitle: "Architecture Lab",
            publishedAt: "2026-08-14T18:00:00Z",
          },
        }] });
      },
      now: () => new Date("2026-08-14T20:00:00.000Z"),
    });

    const result = await provider.discover(request("AI agents", 4));

    expect(seenUrl).toContain("/youtube/v3/search");
    expect(seenUrl).toContain("part=snippet");
    expect(seenUrl).toContain("type=video");
    expect(seenUrl).toContain("maxResults=4");
    expect(seenUrl).toContain("key=super-secret-youtube-key");
    expect(JSON.stringify(result)).not.toContain("super-secret-youtube-key");
    expect(result[0]).toMatchObject({
      title: "AI agent architecture",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
      platform: "youtube",
      publisher: "Architecture Lab",
      provider: "youtube",
      providerVersion: "v3/search.list",
    });
  });

  it("classifies provider quota/rate failures without echoing secret URLs", async () => {
    const provider = new YouTubeDiscoveryProvider({ apiKey: "dont-leak", fetchImpl: async () => jsonResponse({ error: { message: "quota" } }, 429) });
    let caught: unknown;
    try { await provider.discover(request("AI")); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PublicDiscoveryAdapterError);
    expect(caught).toMatchObject({ kind: "rate-limited" });
    expect(String(caught)).not.toContain("dont-leak");
  });
});
