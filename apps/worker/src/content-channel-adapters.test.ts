import { describe, expect, it } from "vitest";
import {
  channelContentFits,
  resolveChannelContentProfile,
  validateChannelContent,
} from "./content-channel-adapters";

describe("VS-31 channel content profiles", () => {
  it("resolves LinkedIn as a text-first execution with the publishing hard limit", () => {
    const profile = resolveChannelContentProfile("linkedin", "text");
    expect(profile).toMatchObject({
      channel: "linkedin",
      format: "text",
      contentMode: "text-first",
      hardLimits: { maxCharacters: 3000 },
      presentation: { visualPrimary: false, videoPrimary: false },
    });
    expect(profile.requirements.join(" ")).toMatch(/3000/);
  });

  it("resolves Instagram carousel and reel as different visual execution modes", () => {
    const carousel = resolveChannelContentProfile("instagram", "carousel");
    const reel = resolveChannelContentProfile("instagram", "reel");
    expect(carousel).toMatchObject({
      contentMode: "visual-caption",
      hardLimits: { maxCharacters: 2200 },
      presentation: { visualPrimary: true, videoPrimary: false },
    });
    expect(carousel.recommendations.join(" ")).toMatch(/carousel/i);
    expect(reel).toMatchObject({
      contentMode: "video-caption",
      hardLimits: { maxCharacters: 2200 },
      presentation: { visualPrimary: true, videoPrimary: true },
    });
    expect(reel.recommendations.join(" ")).toMatch(/video|reel/i);
  });

  it("keeps manual publishing as a generic safe fallback", () => {
    expect(resolveChannelContentProfile("manual", "newsletter")).toMatchObject({
      channel: "manual",
      format: "newsletter",
      contentMode: "generic",
      hardLimits: { maxCharacters: 50000 },
    });
  });

  it("fails closed when generated content exceeds a channel hard limit", () => {
    const linkedin = resolveChannelContentProfile("linkedin", "text");
    expect(() => validateChannelContent(linkedin, "x".repeat(3001))).toThrow(/LinkedIn content exceeds 3000 characters/i);
    expect(channelContentFits("instagram", "carousel", "x".repeat(2201))).toBe(false);
  });

  it("validates without silently truncating or rewriting content", () => {
    const original = "  Keep the user's exact wording inside the limit.  ";
    const result = validateChannelContent(resolveChannelContentProfile("linkedin", "text"), original);
    expect(result).toBe(original);
  });
});
