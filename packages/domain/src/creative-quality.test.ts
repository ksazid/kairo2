import { describe, expect, it } from "vitest";
import type { CarouselProject } from "./carousel-project";
import { contrastRatio, evaluateCarouselQuality, evaluateRenderedCarouselQuality, type CarouselSlideQualityInput, type RendererSlideMetrics } from "./creative-quality";

const project: CarouselProject = {
  schemaVersion: 1, format: "carousel", structure: "listicle", coverHook: "Hook",
  slides: [
    { id: "hook", role: "hook", headline: "Hook", body: "Body", supportingClaimIds: ["claim-1"] },
    { id: "item", role: "list-item", headline: "Item", body: "Body", supportingClaimIds: ["claim-1"] },
    { id: "cta", role: "cta", headline: "CTA", body: "Body", supportingClaimIds: ["claim-1"] },
  ], caption: "Caption", cta: "Act", supportingClaimIds: ["claim-1"],
};

function observations(): CarouselSlideQualityInput[] {
  return project.slides.map((slide) => ({ slideId: slide.id, role: slide.role, textOverflow: false, alignment: "left", foreground: [0, 0, 0], background: [255, 255, 255], whitespaceRatio: 0.35, logoPlacement: "safe", copyCharacters: 80, brandFontMatches: true, brandColorMatches: true }));
}

describe("CreativeQuality", () => {
  it("passes a readable, Brand-consistent carousel deterministically", () => {
    const first = evaluateCarouselQuality(project, observations());
    expect(first).toEqual(evaluateCarouselQuality(project, observations()));
    expect(first).toMatchObject({ passed: true, score: 100, findings: [], checkedSlideIds: ["hook", "item", "cta"] });
  });

  it("reports all blocking visual failures", () => {
    const input = observations();
    Object.assign(input[0]!, { textOverflow: true, foreground: [120, 120, 120], background: [130, 130, 130], logoPlacement: "unsafe", copyCharacters: 300 });
    const report = evaluateCarouselQuality(project, input);
    expect(report.passed).toBe(false);
    expect(report.findings.filter((finding) => finding.slideId === "hook").map((finding) => finding.code)).toEqual(expect.arrayContaining(["text-overflow", "contrast", "logo-placement", "copy-density"]));
    expect(report.findings.filter((finding) => finding.severity === "blocking")).toHaveLength(4);
    expect(report.findings.every((finding) => finding.evidence.length > 0)).toBe(true);
  });

  it("reports alignment, whitespace, missing logo, moderate copy density and Brand consistency as advisory", () => {
    const input = observations();
    Object.assign(input[1]!, { alignment: "mixed", whitespaceRatio: 0.1, logoPlacement: "missing", copyCharacters: 500, brandFontMatches: false });
    const report = evaluateCarouselQuality(project, input);
    expect(report.passed).toBe(true);
    expect(report.findings.map((finding) => finding.code)).toEqual(["alignment", "whitespace", "logo-placement", "copy-density", "brand-consistency"]);
    expect(report.findings.every((finding) => finding.severity === "advisory")).toBe(true);
  });

  it("blocks CTA content before the final slide", () => {
    const malformed = structuredClone(project);
    malformed.slides[1]!.role = "cta";
    const input = observations(); input[1]!.role = "cta";
    expect(evaluateCarouselQuality(malformed, input).findings).toContainEqual(expect.objectContaining({ code: "cta-position", severity: "blocking", slideId: "item" }));
  });

  it("requires exact observation identity and bounded measurements", () => {
    const missing = observations().slice(1);
    const invalidWhitespace = observations(); invalidWhitespace[0]!.whitespaceRatio = 2;
    expect(() => evaluateCarouselQuality(project, missing)).toThrow(/one observation/i);
    expect(() => evaluateCarouselQuality(project, invalidWhitespace)).toThrow(/between zero and one/i);
  });

  it("uses WCAG contrast calculation", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 120, 120], [130, 130, 130])).toBeLessThan(4.5);
  });

  it("derives findings from realistic renderer measurements", () => {
    const rendered = rendererMetrics();
    rendered[0]!.text[0]!.measuredWidth = 980;
    rendered[0]!.text[0]!.bounds.width = 760;
    rendered[0]!.text[0]!.foreground = [120, 120, 120];
    rendered[0]!.text[0]!.characterCount = 250;
    rendered[0]!.logo = { bounds: { x: 1030, y: 1280, width: 100, height: 50 } };
    rendered[1]!.text.push({ bounds: { x: 100, y: 500, width: 700, height: 200 }, measuredWidth: 650, measuredHeight: 140, alignment: "center", characterCount: 80, fontFamily: "Other Sans", foreground: [0, 0, 0] });
    rendered[1]!.occupiedAreaPixels = 1_300_000;

    const report = evaluateRenderedCarouselQuality(project, rendered);
    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["text-overflow", "contrast", "logo-placement", "copy-density", "alignment", "whitespace", "brand-consistency"]));
    expect(report.findings.find((finding) => finding.code === "contrast")?.evidence[0]).toMatchObject({ metric: "contrastRatio", expected: 4.5 });
  });

  it("passes renderer measurements without accepting caller-computed assertions", () => {
    const report = evaluateRenderedCarouselQuality(project, rendererMetrics());
    expect(report).toMatchObject({ passed: true, score: 100, findings: [] });
  });

  it("rejects renderer metrics that do not match the canvas", () => {
    const rendered = rendererMetrics(); rendered[0]!.occupiedAreaPixels = 2_000_000;
    expect(() => evaluateRenderedCarouselQuality(project, rendered)).toThrow(/fit within the canvas/i);
  });
});

function rendererMetrics(): RendererSlideMetrics[] {
  return project.slides.map((slide) => ({
    slideId: slide.id,
    role: slide.role,
    canvas: { width: 1080, height: 1350 },
    safeArea: { x: 80, y: 80, width: 920, height: 1190 },
    background: [255, 255, 255],
    text: [{ bounds: { x: 100, y: 160, width: 800, height: 240 }, measuredWidth: 700, measuredHeight: 160, alignment: "left", characterCount: 80, fontFamily: "Brand Sans", foreground: [0, 0, 0] }],
    occupiedAreaPixels: 900_000,
    logo: { bounds: { x: 850, y: 1150, width: 100, height: 50 } },
    brand: { logoRequired: true, fontFamilies: ["Brand Sans"], colors: [[0, 0, 0], [255, 255, 255]] },
  }));
}
