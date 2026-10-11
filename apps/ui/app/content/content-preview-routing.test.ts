import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("content preview routing", () => {
  it("keeps preview and authenticated actions inside Kairo UI v2", () => {
    const page = readFileSync(new URL("./[campaignId]/[assetId]/page.tsx", import.meta.url), "utf8");
    const client = readFileSync(new URL("./[campaignId]/[assetId]/content-preview-client.tsx", import.meta.url), "utf8");

    expect(page).toContain('href="#caption-editor"');
    expect(page).toContain("Back to Content");
    expect(page).not.toContain("NEXT_PUBLIC_KAIRO_WEB_URL");
    expect(page).not.toContain("legacyHref");
    expect(client).not.toContain("legacyHref");
    expect(client).not.toContain("window.location.assign");
    expect(client).toContain('fetch("/api/content/action"');
    expect(client).toContain("Text concept preview; production media is missing");
    expect(client).toContain("Attach approved media to complete this preview.");
    expect(client).toContain("missingMedia ? <div className=\"social-media-concept\"");
  });
});
