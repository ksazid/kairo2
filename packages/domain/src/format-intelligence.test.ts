import { describe, expect, it } from "vitest";
import { FORMAT_INTELLIGENCE_CATALOG, getFormatProfile, recommendFormats } from "./format-intelligence";

describe("VS-34 format intelligence library", () => {
  it("represents every current publish content type exactly once", () => {
    expect(FORMAT_INTELLIGENCE_CATALOG.map((item) => item.key)).toEqual(["text", "image", "video", "carousel", "reel"]);
    expect(new Set(FORMAT_INTELLIGENCE_CATALOG.map((item) => item.key)).size).toBe(5);
  });

  it("reuses the existing structured creative-plan contracts", () => {
    expect(getFormatProfile("carousel").creativePlanContract).toBe("carousel-plan");
    expect(getFormatProfile("reel").creativePlanContract).toBe("reel-plan");
    expect(getFormatProfile("text").creativePlanContract).toBeUndefined();
  });

  it("keeps the Marketing Lab strategy vocabulary aligned where a direct mapping exists", () => {
    expect(getFormatProfile("text").strategyFormat).toBe("text");
    expect(getFormatProfile("image").strategyFormat).toBe("static");
    expect(getFormatProfile("carousel").strategyFormat).toBe("carousel");
    expect(getFormatProfile("reel").strategyFormat).toBe("reel");
    expect(getFormatProfile("video").strategyFormat).toBeUndefined();
  });

  it("ranks Instagram education toward a carousel with explicit reasons", () => {
    const recommendations = recommendFormats({ channel: "instagram", objective: "educate" });
    expect(recommendations[0]?.profile.key).toBe("carousel");
    expect(recommendations[0]?.reasons).toContain("Primary format fit for instagram");
    expect(recommendations[0]?.reasons).toContain("Fits the educate objective");
  });

  it("ranks LinkedIn opinion toward text while keeping recommendations advisory", () => {
    const recommendations = recommendFormats({ channel: "linkedin", objective: "opinion" });
    expect(recommendations[0]?.profile.key).toBe("text");
    const visibleAdvice = recommendations.flatMap((item) => [item.profile.summary, ...item.reasons, ...item.profile.strengths, ...item.profile.tradeoffs]).join(" ").toLowerCase();
    expect(visibleAdvice).not.toMatch(/guarantee|guaranteed|will outperform|algorithm boost|causes? better/);
  });

  it("filters formats above the requested production-effort ceiling", () => {
    const recommendations = recommendFormats({ channel: "instagram", objective: "demonstrate", maxEffort: "medium" });
    expect(recommendations.some((item) => item.profile.effort === "high")).toBe(false);
    expect(recommendations.map((item) => item.profile.key)).not.toContain("reel");
    expect(recommendations.map((item) => item.profile.key)).not.toContain("video");
  });

  it("is deterministic for identical inputs", () => {
    const input = { channel: "instagram" as const, objective: "explain" as const, maxEffort: "high" as const };
    expect(recommendFormats(input)).toEqual(recommendFormats(input));
  });

  it("uses accepted Brand Learning evidence and explains its bounded influence", () => {
    const recommendations = recommendFormats({ channel: "instagram", objective: "demonstrate", acceptedLearnings: [{ learningId: "learning-1", format: "carousel", channel: "instagram", confidence: .8, evidenceObservationIds: ["metric-1", "metric-2"], reason: "Comparable educational carousels correlated with stronger saves" }] });
    expect(recommendations.find(item => item.profile.key === "carousel")?.reasons).toContain("Accepted Brand Learning: Comparable educational carousels correlated with stronger saves (2 observations)");
    expect(() => recommendFormats({ acceptedLearnings: [{ learningId: "candidate", format: "carousel", confidence: .8, evidenceObservationIds: [], reason: "Unreviewed" }] })).toThrow(/requires at least one item/i);
  });

  it("keeps actual provider capability outside format-fit guidance", () => {
    for (const profile of FORMAT_INTELLIGENCE_CATALOG) {
      expect(profile.channelFit).toHaveLength(4);
      for (const fit of profile.channelFit) {
        expect(fit.rationale.toLowerCase()).not.toMatch(/api supports|provider supports|publish capability granted|oauth/);
      }
    }
  });
});
