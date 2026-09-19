import { describe, expect, it } from "vitest";
import { contentFallback } from "./content";
import { createFromInsightHref, filterInsightContent, insightMetrics, insightSeries } from "./insights";

describe("Kairo UI v2 Insights behavior", () => {
  it("scales metrics by range and channel", () => {
    expect(insightMetrics("all", "30")[0]?.value).toBe("128.4K");
    expect(insightMetrics("Instagram", "7")[0]?.value).not.toBe("128.4K");
  });

  it("provides current and comparison chart series", () => {
    const series = insightSeries("all", "30");
    expect(series).toHaveLength(7);
    expect(series.every((point) => point.current >= point.previous)).toBe(true);
  });

  it("filters top content by channel", () => {
    expect(filterInsightContent(contentFallback(), "LinkedIn").every((item) => item.channel === "LinkedIn")).toBe(true);
  });

  it("preserves the Brand in create-from-insight routes", () => {
    expect(createFromInsightHref("brand/one")).toContain("brand=brand%2Fone");
  });
});

