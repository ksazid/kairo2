import { describe, expect, it } from "vitest";
import { canPublish, channelSettingsHref, presenterDraft, settingsFallback } from "./settings-data";

describe("Settings production projection", () => {
  it("uses a truthful signed-out fallback", () => {
    expect(settingsFallback()).toEqual({
      authenticated: false,
      account: { displayName: "Guest" },
      workspace: null,
      brand: null,
      channels: [],
      presenter: null,
    });
  });

  it("requires both a connected account and publishing capability", () => {
    const channel = { id: "ig", channel: "instagram" as const, displayName: "Kairo", accountRef: "ig-1", status: "connected" as const, capabilities: ["content-publishing"] };
    expect(canPublish(channel)).toBe(true);
    expect(canPublish({ ...channel, status: "reconnect-required" })).toBe(false);
    expect(canPublish({ ...channel, capabilities: [] })).toBe(false);
  });

  it("builds scoped v2 routes and presenter drafts", () => {
    expect(channelSettingsHref("brand / 1")).toBe("/settings?tab=channels&brand=brand%20%2F%201");
    expect(presenterDraft({ brandName: " Kairo ", look: "Professional", background: "Studio", voiceEnabled: true, expectedVersion: 3 })).toEqual({
      displayName: "Kairo Creator",
      status: "draft",
      mode: "talking-avatar",
      visualStyle: "Professional",
      background: "Studio",
      voiceStyle: "Voice requested; enrollment not configured",
      expectedVersion: 3,
    });
  });
});
