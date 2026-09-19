import { describe, expect, it } from "vitest";
import { isSettingsTabId, SETTINGS_TABS } from "./settings";

describe("Settings navigation", () => {
  it("keeps the six approved upper tabs in order", () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "Account & Profile",
      "Brand & Workspace",
      "AI Creator Avatar",
      "Channels & Publishing",
      "AI & Media Providers",
      "Team & Permissions",
    ]);
  });

  it("does not expose consolidated sections as separate tabs", () => {
    const labels = SETTINGS_TABS.map((tab) => tab.label);
    expect(labels).not.toContain("Notifications");
    expect(labels).not.toContain("Billing");
    expect(labels).not.toContain("Privacy & Data");
    expect(labels).not.toContain("Discovery Schedule");
  });

  it("validates tab identifiers", () => {
    expect(isSettingsTabId("avatar")).toBe(true);
    expect(isSettingsTabId("notifications")).toBe(false);
  });
});
