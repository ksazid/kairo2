import { describe, expect, it } from "vitest";
import { normalizePublishableCopy, publicCopyFindings } from "./publishable-copy";
describe("Public copy boundary", () => {
  it("removes internal lineage and Markdown while preserving copy and paragraph breaks", () => {
    expect(normalizePublishableCopy("# Alphafly 4\n\n**Road racing** 【source:claim-1】\n[Read](https://nike.com) [size 4]")).toBe("Alphafly 4\n\nRoad racing\nRead (https://nike.com) [size 4]");
  });
  it("reports structured Instagram caption overflow without truncation", () => {
    const caption = "x".repeat(2201);
    expect(publicCopyFindings("instagram", JSON.stringify({ caption, scenes: [] }))).toEqual([expect.objectContaining({code:"channel-copy-limit",severity:"revision"})]);
    expect(normalizePublishableCopy(caption)).toHaveLength(2201);
    expect(publicCopyFindings("instagram", "x".repeat(2200))).toEqual([]);
  });
  it("reports leaked claim IDs for manual versions", () => {
    expect(publicCopyFindings("linkedin", "Road racing 【source:claim-1】")).toEqual([expect.objectContaining({code:"public-copy-format"})]);
  });
});
