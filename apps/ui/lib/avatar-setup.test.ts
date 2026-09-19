import { describe, expect, it } from "vitest";
import { addAvatarPhotos, canContinueAvatarSetup, remainingAvatarPhotos } from "./avatar-setup";

describe("AI Creator Avatar setup", () => {
  it("caps selected identity photos at twelve", () => {
    expect(addAvatarPhotos(3, 12)).toBe(12);
  });

  it("requires eight photos and explicit consent before continuing", () => {
    expect(canContinueAvatarSetup(8, false)).toBe(false);
    expect(canContinueAvatarSetup(7, true)).toBe(false);
    expect(canContinueAvatarSetup(8, true)).toBe(true);
  });

  it("reports how many identity photos remain", () => {
    expect(remainingAvatarPhotos(3)).toBe(5);
    expect(remainingAvatarPhotos(9)).toBe(0);
  });
});
