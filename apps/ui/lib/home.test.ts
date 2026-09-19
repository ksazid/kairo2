import { describe, expect, it } from "vitest";
import {
  buildContinueItems,
  creationDestination,
  normalizeCreationFormat,
  selectHomeOpportunities,
  viralConcept,
} from "./home";

describe("Kairo UI v2 Home behavior", () => {
  it("never substitutes preview opportunities for an authenticated Brand", () => {
    const preview = [{ id: "demo" }];
    expect(selectHomeOpportunities(true, [], preview)).toEqual([]);
    expect(selectHomeOpportunities(false, [], preview)).toEqual(preview);
    expect(selectHomeOpportunities(true, [{ id: "persisted" }], preview)).toEqual([{ id: "persisted" }]);
  });

  it("maps approved Home choices to creation formats", () => {
    expect(normalizeCreationFormat("Post")).toBe("image");
    expect(normalizeCreationFormat("Reel")).toBe("reel");
    expect(normalizeCreationFormat("Carousel")).toBe("carousel");
    expect(normalizeCreationFormat("Campaign")).toBe("campaign");
  });

  it("creates a safe concept preview for supported public links", () => {
    expect(viralConcept("https://www.instagram.com/reel/example")).toMatchObject({
      format: "reel",
      sourceLabel: "Instagram",
    });
    expect(viralConcept("https://example.com/guide")).toMatchObject({
      format: "carousel",
      sourceLabel: "example.com",
    });
  });

  it("rejects local and non-http viral links", () => {
    for (const value of ["file:///tmp/post", "http://localhost:3000/post", "http://127.0.0.1/post", "not-a-url"]) {
      expect(() => viralConcept(value)).toThrow(/public http/i);
    }
  });

  it("routes generated assets and campaigns into their v2 previews", () => {
    expect(creationDestination("brand 1", { campaignId: "campaign 1", assetId: "asset 1" }))
      .toBe("/content/campaign%201/asset%201?brand=brand%201");
    expect(creationDestination("brand 1", { campaignId: "campaign 1" }))
      .toBe("/campaigns/campaign%201?brand=brand%201");
  });

  it("orders real unfinished campaigns and ideas and avoids duplicate lineage", () => {
    expect(buildContinueItems("brand", [
      { id: "campaign", ideaId: "idea-1", name: "Campaign draft", status: "draft", createdAt: "2026-08-30T10:00:00Z" },
    ], [
      { id: "idea-1", title: "Already developed", status: "angles-ready", createdAt: "2026-08-30T09:00:00Z" },
      { id: "idea-2", title: "Research draft", status: "research-ready", createdAt: "2026-08-30T11:00:00Z" },
    ])).toEqual([
      expect.objectContaining({ id: "idea-2", context: "Research ready" }),
      expect.objectContaining({ id: "campaign", context: "Draft content in progress" }),
    ]);
  });
});
