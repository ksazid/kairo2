import { describe, expect, it } from "vitest";
import { configuredHunterSourceRegistry, createHunterToolGateway } from "./hunter-tool-gateway";

describe("configured Hunter source registry", () => {
  it("does not plan providers whose runtime prerequisites are absent", () => {
    const registry = configuredHunterSourceRegistry({});
    expect(registry.find((source) => source.key === "youtube")?.enabled).toBe(false);
    expect(registry.find((source) => source.key === "rss")?.enabled).toBe(false);
    expect(registry.find((source) => source.key === "agent-reach")?.enabled).toBe(false);
    expect(registry.find((source) => source.key === "github")?.enabled).toBe(true);
  });

  it("enables credential and feed backed sources when configured", () => {
    const registry = configuredHunterSourceRegistry({
      YOUTUBE_API_KEY: "key",
      EXA_API_KEY: "key",
      KAIRO_HUNTER_RSS_FEEDS_JSON: JSON.stringify([{ key: "news", url: "https://example.com/feed.xml", tags: ["technology"] }]),
    });
    expect(registry.find((source) => source.key === "youtube")?.enabled).toBe(true);
    expect(registry.find((source) => source.key === "rss")?.enabled).toBe(true);
    expect(registry.find((source) => source.key === "agent-reach")?.enabled).toBe(true);
  });

  it("does not disguise public providers as Agent Reach when its binding is absent", async () => {
    const gateway = createHunterToolGateway({});
    await expect(gateway.invoke({
      capability: "public-content-search", scope: { visibility: "brand-private", workspaceId: "workspace", brandId: "brand" }, timeoutMs: 1_000,
      input: { source: "agent-reach", query: "notion", maxResults: 2 },
    })).rejects.toThrow("Agent Reach is not configured");
  });
});
