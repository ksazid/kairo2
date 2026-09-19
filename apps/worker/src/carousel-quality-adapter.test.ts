import { describe, expect, it } from "vitest";
import type { CarouselProject } from "@kairo/domain/carousel-project";
import { compileCarouselProject } from "@kairo/domain/carousel-project";
import { renderCreativePlan } from "./creative-renderer";
import { evaluateRenderedCarouselArtifactsQuality } from "./carousel-quality-adapter";

const project: CarouselProject = {
  schemaVersion: 1,
  format: "carousel",
  structure: "comparison",
  coverHook: "Choose with evidence",
  slides: [
    { id: "comparison", role: "comparison", headline: "Compare the tradeoffs", body: "Use the supported criteria before deciding.", supportingClaimIds: ["claim-1"] },
    { id: "cta", role: "cta", headline: "Your next step", body: "Save this comparison.", supportingClaimIds: ["claim-1"] },
  ],
  caption: "An evidence-linked comparison.",
  cta: "Save this.",
  supportingClaimIds: ["claim-1"],
};
const expectedBrand = { fontFamilies: ["Kairo Bitmap"], colors: [[247,247,244], [24,24,24], [72,92,75]] as Array<readonly [number,number,number]>, logoRequired: false };

describe("rendered carousel quality adapter", () => {
  it("evaluates actual rendered artifacts without caller-computed observations", () => {
    const rendered = renderCreativePlan(compileCarouselProject(project));
    const report = evaluateRenderedCarouselArtifactsQuality(project, rendered.artifacts, expectedBrand);
    expect(report.passed).toBe(true);
    expect(report.checkedSlideIds).toEqual(["comparison", "cta"]);
    expect(report.findings.every((finding) => finding.evidence.length > 0)).toBe(true);
  });

  it("derives representative contrast, copy, whitespace and logo evidence from real layout metrics", () => {
    const crowded = structuredClone(project);
    crowded.slides[1]!.body = "EVIDENCE ".repeat(18).trim();
    const rendered = renderCreativePlan(compileCarouselProject(crowded), {
      foreground: [120, 120, 120],
      background: [130, 130, 130],
      accent: [125, 125, 125],
      logoPlacement: "none",
    });
    const report = evaluateRenderedCarouselArtifactsQuality(crowded, rendered.artifacts, { fontFamilies:["Kairo Bitmap"],colors:[[130,130,130],[120,120,120],[125,125,125]],logoRequired:true });
    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["contrast", "copy-density", "whitespace", "logo-placement"]));
    expect(report.findings.find((finding) => finding.code === "contrast")?.evidence[0]).toMatchObject({ metric: "contrastRatio", expected: 4.5 });
  });

  it("fails closed on artifact count, order and corresponding slide lineage", () => {
    const rendered = renderCreativePlan(compileCarouselProject(project));
    expect(() => evaluateRenderedCarouselArtifactsQuality(project, rendered.artifacts.slice(1), expectedBrand)).toThrow(/exactly one artifact/i);
    const reordered = [rendered.artifacts[1]!, rendered.artifacts[0]!];
    expect(() => evaluateRenderedCarouselArtifactsQuality(project, reordered, expectedBrand)).toThrow(/contiguous indexes/i);
    const wrongLineage = rendered.artifacts.map((artifact, index) => index ? artifact : { ...artifact, supportingClaimIds: ["other-claim"] });
    expect(() => evaluateRenderedCarouselArtifactsQuality(project, wrongLineage, expectedBrand)).toThrow(/Claim lineage/i);
  });

  it("uses renderer alignment and separately validated expected Brand theme", () => {
    const rendered = renderCreativePlan(compileCarouselProject(project));
    const artifacts = structuredClone(rendered.artifacts);
    artifacts[0]!.layoutMetrics!.text[1]!.alignment = "center";
    artifacts[0]!.layoutMetrics!.headingFontLabel = "Alternative Display";
    const report = evaluateRenderedCarouselArtifactsQuality(project, artifacts, expectedBrand);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "alignment", evidence: [expect.objectContaining({ metric: "alignment" })] }),
      expect.objectContaining({ code: "brand-consistency", evidence: expect.arrayContaining([expect.objectContaining({ metric: "brandFontMatches", actual: false })]) }),
    ]));
  });
});
