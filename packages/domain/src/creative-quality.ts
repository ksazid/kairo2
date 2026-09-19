import { DomainValidationError } from "./index";
import type { CarouselProject, CarouselSlideRole } from "./carousel-project";

export type CreativeQualitySeverity = "blocking" | "advisory";
export type CreativeQualityCode = "text-overflow" | "alignment" | "contrast" | "whitespace" | "logo-placement" | "copy-density" | "cta-position" | "brand-consistency";
export interface CreativeQualityEvidence { metric: string; actual: string | number | boolean; expected: string | number | boolean; unit?: string }
export interface CreativeQualityFinding { code: CreativeQualityCode; severity: CreativeQualitySeverity; slideId: string; message: string; evidence: CreativeQualityEvidence[] }
export interface CreativeQualityReport { passed: boolean; score: number; findings: CreativeQualityFinding[]; checkedSlideIds: string[] }

export interface CarouselSlideQualityInput {
  slideId: string;
  role: CarouselSlideRole;
  textOverflow: boolean;
  alignment: "left" | "center" | "right" | "mixed";
  foreground: readonly [number, number, number];
  background: readonly [number, number, number];
  whitespaceRatio: number;
  logoPlacement: "safe" | "unsafe" | "missing";
  copyCharacters: number;
  brandFontMatches: boolean;
  brandColorMatches: boolean;
}

export interface RendererRect { x: number; y: number; width: number; height: number }
export interface RendererTextMetrics {
  bounds: RendererRect;
  measuredWidth: number;
  measuredHeight: number;
  alignment: "left" | "center" | "right";
  characterCount: number;
  fontFamily: string;
  foreground: readonly [number, number, number];
}
export interface RendererSlideMetrics {
  slideId: string;
  role: CarouselSlideRole;
  canvas: { width: number; height: number };
  safeArea: RendererRect;
  background: readonly [number, number, number];
  text: RendererTextMetrics[];
  occupiedAreaPixels: number;
  logo?: { bounds: RendererRect };
  brand: { logoRequired: boolean; fontFamilies: string[]; colors: Array<readonly [number, number, number]> };
}

/** Converts renderer measurements into quality inputs; callers cannot assert pass/fail flags. */
export function evaluateRenderedCarouselQuality(project: CarouselProject, metrics: RendererSlideMetrics[]): CreativeQualityReport {
  if (!Array.isArray(metrics) || metrics.length !== project.slides.length) throw new DomainValidationError("Rendered quality requires one metrics record per carousel slide");
  return evaluateCarouselQuality(project, metrics.map(toObservation));
}

export function evaluateCarouselQuality(project: CarouselProject, observations: CarouselSlideQualityInput[]): CreativeQualityReport {
  if (!Array.isArray(observations) || observations.length !== project.slides.length) throw new DomainValidationError("Creative quality requires one observation per carousel slide");
  const expected = new Map(project.slides.map((slide) => [slide.id, slide]));
  const seen = new Set<string>();
  const findings: CreativeQualityFinding[] = [];
  for (const item of observations) {
    const slide = expected.get(item?.slideId);
    if (!slide || seen.has(item.slideId) || slide.role !== item.role) throw new DomainValidationError("Creative quality observations must match unique project slides and roles");
    seen.add(item.slideId);
    validateObservation(item);
    const ratio = contrastRatio(item.foreground, item.background);
    if (item.textOverflow) add(findings, "text-overflow", "blocking", item.slideId, "Text exceeds the slide's safe content bounds.", [{ metric: "textWithinSafeArea", actual: false, expected: true }]);
    if (item.alignment === "mixed") add(findings, "alignment", "advisory", item.slideId, "Text alignment is inconsistent within the slide.", [{ metric: "alignment", actual: item.alignment, expected: "one consistent alignment" }]);
    if (ratio < 4.5) add(findings, "contrast", "blocking", item.slideId, "Text contrast is below the 4.5:1 readability threshold.", [{ metric: "contrastRatio", actual: rounded(ratio), expected: 4.5, unit: "ratio minimum" }]);
    if (item.whitespaceRatio < 0.18) add(findings, "whitespace", "advisory", item.slideId, "The slide has too little whitespace.", [{ metric: "whitespaceRatio", actual: rounded(item.whitespaceRatio), expected: 0.18, unit: "minimum fraction" }]);
    if (item.whitespaceRatio > 0.75) add(findings, "whitespace", "advisory", item.slideId, "The slide has excessive unused whitespace.", [{ metric: "whitespaceRatio", actual: rounded(item.whitespaceRatio), expected: 0.75, unit: "maximum fraction" }]);
    if (item.logoPlacement === "unsafe") add(findings, "logo-placement", "blocking", item.slideId, "Logo placement intersects an unsafe edge or content area.", [{ metric: "logoPlacement", actual: "outside safe area", expected: "inside safe area" }]);
    if (item.logoPlacement === "missing") add(findings, "logo-placement", "advisory", item.slideId, "The configured Brand logo is missing.", [{ metric: "logoPresent", actual: false, expected: true }]);
    if (item.copyCharacters > copyLimit(item.role)) add(findings, "copy-density", item.copyCharacters > copyLimit(item.role) * 1.5 ? "blocking" : "advisory", item.slideId, "The slide contains too much copy for its semantic role.", [{ metric: "copyCharacters", actual: item.copyCharacters, expected: copyLimit(item.role), unit: "maximum characters" }]);
    if (!item.brandFontMatches || !item.brandColorMatches) add(findings, "brand-consistency", "advisory", item.slideId, "Typography or color does not match the Brand direction.", [{ metric: "brandFontMatches", actual: item.brandFontMatches, expected: true }, { metric: "brandColorMatches", actual: item.brandColorMatches, expected: true }]);
  }
  const final = project.slides.at(-1);
  for (const slide of project.slides) if (slide.role === "cta" && slide.id !== final?.id) add(findings, "cta-position", "blocking", slide.id, "CTA content must appear on the final slide.", [{ metric: "slideRole", actual: "cta before final", expected: "cta on final slide" }]);
  if (final?.role !== "cta") add(findings, "cta-position", "blocking", final?.id ?? "carousel", "The final slide must contain the CTA.", [{ metric: "finalSlideRole", actual: final?.role ?? "missing", expected: "cta" }]);
  const blocking = findings.filter((finding) => finding.severity === "blocking").length;
  const advisory = findings.length - blocking;
  return { passed: blocking === 0, score: Math.max(0, 100 - blocking * 20 - advisory * 5), findings, checkedSlideIds: project.slides.map((slide) => slide.id) };
}

export function contrastRatio(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const high = Math.max(luminance(color(a)), luminance(color(b)));
  const low = Math.min(luminance(color(a)), luminance(color(b)));
  return (high + 0.05) / (low + 0.05);
}

function validateObservation(input: CarouselSlideQualityInput): void {
  color(input.foreground); color(input.background);
  if (!Number.isFinite(input.whitespaceRatio) || input.whitespaceRatio < 0 || input.whitespaceRatio > 1) throw new DomainValidationError("whitespaceRatio must be between zero and one");
  if (!Number.isInteger(input.copyCharacters) || input.copyCharacters < 0) throw new DomainValidationError("copyCharacters must be a non-negative integer");
  if (!["left", "center", "right", "mixed"].includes(input.alignment)) throw new DomainValidationError("alignment is not supported");
  if (!["safe", "unsafe", "missing"].includes(input.logoPlacement)) throw new DomainValidationError("logoPlacement is not supported");
}
function copyLimit(role: CarouselSlideRole): number { return role === "hook" || role === "attention" ? 120 : role === "cta" ? 180 : 420; }
function add(target: CreativeQualityFinding[], code: CreativeQualityCode, severity: CreativeQualitySeverity, slideId: string, message: string, evidence: CreativeQualityEvidence[]): void { target.push({ code, severity, slideId, message, evidence }); }

function toObservation(input: RendererSlideMetrics): CarouselSlideQualityInput {
  positive(input.canvas.width, "canvas.width"); positive(input.canvas.height, "canvas.height"); rect(input.safeArea, "safeArea"); color(input.background);
  const canvasPixels = input.canvas.width * input.canvas.height;
  if (!Number.isFinite(input.occupiedAreaPixels) || input.occupiedAreaPixels < 0 || input.occupiedAreaPixels > canvasPixels) throw new DomainValidationError("occupiedAreaPixels must fit within the canvas");
  if (!Array.isArray(input.text) || !input.text.length) throw new DomainValidationError("Renderer metrics require at least one text measurement");
  const alignments = new Set<string>(); let copyCharacters = 0; let overflow = false; let worst = input.text[0]!; let worstRatio = Number.POSITIVE_INFINITY;
  for (const textMetric of input.text) {
    rect(textMetric.bounds, "text.bounds"); positive(textMetric.measuredWidth, "text.measuredWidth"); positive(textMetric.measuredHeight, "text.measuredHeight"); color(textMetric.foreground);
    if (!Number.isInteger(textMetric.characterCount) || textMetric.characterCount < 0) throw new DomainValidationError("text.characterCount must be a non-negative integer");
    if (!textMetric.fontFamily?.trim()) throw new DomainValidationError("text.fontFamily is required");
    if (!["left", "center", "right"].includes(textMetric.alignment)) throw new DomainValidationError("text.alignment is not supported");
    alignments.add(textMetric.alignment); copyCharacters += textMetric.characterCount;
    overflow ||= textMetric.measuredWidth > textMetric.bounds.width || textMetric.measuredHeight > textMetric.bounds.height || !contains(input.safeArea, textMetric.bounds);
    const ratio = contrastRatio(textMetric.foreground, input.background); if (ratio < worstRatio) { worstRatio = ratio; worst = textMetric; }
  }
  if (input.logo) rect(input.logo.bounds, "logo.bounds");
  const logoPlacement = !input.logo ? (input.brand.logoRequired ? "missing" : "safe") : (contains(input.safeArea, input.logo.bounds) ? "safe" : "unsafe");
  const fonts = new Set(input.brand.fontFamilies.map((font) => font.trim().toLowerCase()).filter(Boolean));
  if (!fonts.size) throw new DomainValidationError("Brand metrics require at least one font family");
  const palette = input.brand.colors.map((entry) => rgbKey(color(entry)));
  if (!palette.length) throw new DomainValidationError("Brand metrics require at least one color");
  return { slideId: input.slideId, role: input.role, textOverflow: overflow, alignment: alignments.size > 1 ? "mixed" : ([...alignments][0] as "left" | "center" | "right"), foreground: worst.foreground, background: input.background, whitespaceRatio: 1 - input.occupiedAreaPixels / canvasPixels, logoPlacement, copyCharacters, brandFontMatches: input.text.every((entry) => fonts.has(entry.fontFamily.trim().toLowerCase())), brandColorMatches: input.text.every((entry) => palette.includes(rgbKey(entry.foreground))) && palette.includes(rgbKey(input.background)) };
}
function contains(outer: RendererRect, inner: RendererRect): boolean { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function rect(value: RendererRect, field: string): void { if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new DomainValidationError(`${field} is invalid`); positive(value.width, `${field}.width`); positive(value.height, `${field}.height`); }
function positive(value: number, field: string): void { if (!Number.isFinite(value) || value <= 0) throw new DomainValidationError(`${field} must be positive`); }
function rgbKey(value: readonly [number, number, number]): string { return value.join(","); }
function rounded(value: number): number { return Math.round(value * 100) / 100; }
function color(value: readonly [number, number, number]): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new DomainValidationError("Creative quality color must contain three RGB bytes");
  return value;
}
function luminance(value: readonly [number, number, number]): number {
  const [r, g, b] = value.map((part) => { const c = part / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
}
