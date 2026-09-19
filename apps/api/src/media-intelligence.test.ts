import { describe, expect, it, vi } from "vitest";
import { prepareNormalizedSourceDocument } from "@kairo/agent-contracts";
import { MediaAnalyzer, selectOnboardingEvidence } from "./media-intelligence";

function source(overrides: Record<string, unknown> = {}) {
  return prepareNormalizedSourceDocument({
    canonicalUrl: "https://example.com/video",
    platform: "youtube",
    sourceType: "video",
    title: "AI Architecture in 2026",
    retrievedAt: "2026-08-26T09:00:00.000Z",
    contentHash: "sha256:test",
    provider: "test",
    providerVersion: "1",
    parserVersion: "1",
    provenance: [{ provider: "test", providerVersion: "1", sourceUrl: "https://example.com/video", retrievedAt: "2026-08-26T09:00:00.000Z" }],
    confidence: 0.9,
    extractionWarnings: [],
    ...overrides,
  });
}

describe("VS-102 MediaAnalyzer", () => {
  it("prefers captions and does not call STT when captions are already available", async () => {
    const transcribeAudio = vi.fn(async () => "should not be used");
    const result = await new MediaAnalyzer({ transcribeAudio }).analyze(source({ captions: "Stop building agents as one giant prompt. In 2026, teams need bounded tools and observable workflows. Follow for more architecture notes.", video: { width: 1080, height: 1920 } }));
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(result.transcript).toContain("bounded tools");
    expect(result.format).toBe("video");
    expect(result.visualStyle).toContain("vertical composition");
    expect(result.cta).toContain("Follow");
    expect(result.evidence[0]?.kind).toBe("caption");
  });

  it("falls back to STT and degrades frame/OCR failures independently", async () => {
    const result = await new MediaAnalyzer({
      transcribeAudio: async () => "We tested 12 workflows in 2026. The best result reduced review time by 35%.",
      extractFrames: async () => [{ timestampSeconds: 1 }, { timestampSeconds: 4 }],
      readFrameText: async () => { throw new Error("ocr offline"); },
    }).analyze(source({ video: { width: 1920, height: 1080 } }));
    expect(result.transcript).toContain("35%");
    expect(result.facts.join(" ")).toContain("35%");
    expect(result.representativeFrames).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.includes("ocr unavailable"))).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("does not invent evidence when no text or media capability is available", async () => {
    const result = await new MediaAnalyzer().analyze(source({ title: undefined }));
    expect(result.thesis).toBeUndefined();
    expect(result.claims).toEqual([]);
    expect(result.facts).toEqual([]);
    expect(result.warnings).toContain("media analysis found no usable textual evidence");
  });
});

describe("VS-102 onboarding sampling", () => {
  it("bounds recent/deep evidence and deduplicates canonical URLs and content hashes", () => {
    const candidates = [
      { url: "https://example.com/", kind: "initial" as const },
      { url: "https://example.com/#top", kind: "site" as const },
      ...Array.from({ length: 25 }, (_, index) => ({ url: `https://example.com/recent/${index}`, kind: "recent" as const })),
      ...Array.from({ length: 8 }, (_, index) => ({ url: `https://example.com/deep/${index}`, kind: "deep" as const })),
      { url: "https://example.com/about", kind: "about" as const, contentHash: "same" },
      { url: "https://example.com/company", kind: "about" as const, contentHash: "same" },
    ];
    const selected = selectOnboardingEvidence(candidates);
    expect(selected.filter((item) => item.kind === "recent")).toHaveLength(20);
    expect(selected.filter((item) => item.kind === "deep")).toHaveLength(5);
    expect(selected.filter((item) => item.contentHash === "same")).toHaveLength(1);
    expect(selected.filter((item) => item.url === "https://example.com/")).toHaveLength(1);
  });
});
