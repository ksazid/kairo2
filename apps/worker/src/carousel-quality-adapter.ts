import { validateCarouselProject, type CarouselProject } from "@kairo/domain/carousel-project";
import {
  evaluateRenderedCarouselQuality,
  type CreativeQualityReport,
  type RendererSlideMetrics,
  type RendererTextMetrics,
} from "@kairo/domain/creative-quality";
import type { CreativeLayoutMetrics, RenderedCreativeArtifact } from "./creative-renderer";

export interface ExpectedCarouselBrandTheme {
  fontFamilies: string[];
  colors: Array<readonly [number, number, number]>;
  logoRequired: boolean;
}

/**
 * Adapts measured renderer output into the domain quality model. The caller
 * supplies artifacts, never precomputed quality observations or pass flags.
 */
export function evaluateRenderedCarouselArtifactsQuality(
  projectInput: CarouselProject,
  artifacts: RenderedCreativeArtifact[],
  expectedBrandInput: ExpectedCarouselBrandTheme,
): CreativeQualityReport {
  const project = validateCarouselProject(projectInput);
  const expectedBrand = validateExpectedBrand(expectedBrandInput);
  if (!Array.isArray(artifacts) || artifacts.length !== project.slides.length) {
    throw new Error("Rendered carousel quality requires exactly one artifact per project slide");
  }
  const metrics = artifacts.map((artifact, index) => toMetrics(project, artifact, index, expectedBrand));
  return evaluateRenderedCarouselQuality(project, metrics);
}

function toMetrics(project: CarouselProject, artifact: RenderedCreativeArtifact, index: number, expectedBrand: ExpectedCarouselBrandTheme): RendererSlideMetrics {
  const slide = project.slides[index]!;
  if (!artifact || artifact.role !== "carousel-slide" || artifact.contentType !== "image/png") {
    throw new Error("Rendered carousel quality accepts PNG slide artifacts only");
  }
  if (!Number.isInteger(artifact.index) || artifact.index !== index) {
    throw new Error("Rendered carousel artifacts must be ordered with contiguous indexes");
  }
  if (!sameIds(artifact.supportingClaimIds, slide.supportingClaimIds)) {
    throw new Error("Rendered carousel artifact Claim lineage does not match its project slide");
  }
  const layout = requiredLayout(artifact.layoutMetrics);
  const text = layout.text.map((metric): RendererTextMetrics => {
    const foreground = metric.role === "cover" || metric.role === "cta" ? layout.palette.accent : layout.palette.foreground;
    const fontFamily = metric.role === "cover" || metric.role === "headline" ? layout.headingFontLabel : layout.bodyFontLabel;
    return {
      bounds: {
        x: metric.x,
        y: metric.y,
        width: Math.max(1, layout.safeArea.x + layout.safeArea.width - metric.x),
        height: Math.max(1, layout.safeArea.y + layout.safeArea.height - metric.y),
      },
      measuredWidth: metric.width,
      measuredHeight: metric.height,
      alignment: metric.alignment,
      characterCount: metric.characterCount,
      fontFamily,
      foreground,
    };
  });
  const canvasPixels = layout.canvas.width * layout.canvas.height;
  const logoPixels = layout.logoBounds ? layout.logoBounds.width * layout.logoBounds.height : 0;
  return {
    slideId: slide.id,
    role: slide.role,
    canvas: layout.canvas,
    safeArea: layout.safeArea,
    background: layout.palette.background,
    text,
    occupiedAreaPixels: Math.min(canvasPixels, Math.round(layout.textOccupiedRatio * canvasPixels + logoPixels)),
    ...(layout.logoBounds ? { logo: { bounds: layout.logoBounds } } : {}),
    brand: expectedBrand,
  };
}

function requiredLayout(value: CreativeLayoutMetrics | undefined): CreativeLayoutMetrics {
  if (!value || !Array.isArray(value.text) || !value.text.length) throw new Error("Rendered carousel artifact requires layout metrics");
  return value;
}
function sameIds(a: string[], b: string[]): boolean { return Array.isArray(a) && a.length === b.length && a.every((id, index) => id === b[index]); }
function validateExpectedBrand(value: ExpectedCarouselBrandTheme): ExpectedCarouselBrandTheme {
  if (!value || !Array.isArray(value.fontFamilies) || !value.fontFamilies.length || !Array.isArray(value.colors) || !value.colors.length || typeof value.logoRequired !== "boolean") throw new Error("Expected Carousel Brand theme is required");
  const fontFamilies = [...new Set(value.fontFamilies.map((font) => { if (typeof font !== "string" || !font.trim() || font.trim().length > 200) throw new Error("Expected Brand font family is invalid"); return font.trim(); }))];
  const seen = new Set<string>(); const colors = value.colors.map((color) => { if (!Array.isArray(color) || color.length !== 3 || color.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error("Expected Brand color is invalid"); return [color[0], color[1], color[2]] as const; }).filter((color) => { const key=color.join(",");if(seen.has(key))return false;seen.add(key);return true; });
  return { fontFamilies, colors, logoRequired: value.logoRequired };
}
