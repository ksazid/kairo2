import { DomainValidationError } from "./index";

export interface CarouselSlide {
  headline: string;
  body: string;
  supportingClaimIds: string[];
}

export interface CarouselPlan {
  format: "carousel";
  coverHook: string;
  slides: CarouselSlide[];
  caption: string;
  cta: string;
  supportingClaimIds: string[];
}

export interface ReelScene {
  startSecond: number;
  endSecond: number;
  visual: string;
  onScreenText: string;
  voiceover: string;
  supportingClaimIds: string[];
}

export interface ReelPlan {
  format: "reel";
  hook: string;
  targetDurationSeconds: number;
  scenes: ReelScene[];
  caption: string;
  cta: string;
  supportingClaimIds: string[];
}

export type MarketingCreativePlan = CarouselPlan | ReelPlan;

export function validateCarouselPlan(input: CarouselPlan): CarouselPlan {
  if (!input || input.format !== "carousel") throw new DomainValidationError("Carousel format is required");
  const supportingClaimIds = claimIds(input.supportingClaimIds, "carousel.supportingClaimIds");
  if (!Array.isArray(input.slides) || input.slides.length < 2 || input.slides.length > 20) throw new DomainValidationError("Carousel requires between 2 and 20 slides");
  const allowed = new Set(supportingClaimIds);
  const slides = input.slides.map((slide, index) => {
    if (!slide || typeof slide !== "object") throw new DomainValidationError(`carousel.slides[${index}] is required`);
    const ids = claimIds(slide.supportingClaimIds, `carousel.slides[${index}].supportingClaimIds`);
    assertClaimSubset(ids, allowed, `carousel.slides[${index}]`);
    return {
      headline: text(slide.headline, `carousel.slides[${index}].headline`, 240),
      body: text(slide.body, `carousel.slides[${index}].body`, 2_000),
      supportingClaimIds: ids,
    };
  });
  return {
    format: "carousel",
    coverHook: text(input.coverHook, "carousel.coverHook", 300),
    slides,
    caption: text(input.caption, "carousel.caption", 5_000),
    cta: text(input.cta, "carousel.cta", 500),
    supportingClaimIds,
  };
}

export function validateReelPlan(input: ReelPlan): ReelPlan {
  if (!input || input.format !== "reel") throw new DomainValidationError("Reel format is required");
  const targetDurationSeconds = finiteNumber(input.targetDurationSeconds, "reel.targetDurationSeconds");
  if (targetDurationSeconds < 5 || targetDurationSeconds > 300) throw new DomainValidationError("Reel benchmark duration must be between 5 and 300 seconds");
  const supportingClaimIds = claimIds(input.supportingClaimIds, "reel.supportingClaimIds");
  if (!Array.isArray(input.scenes) || input.scenes.length < 2 || input.scenes.length > 40) throw new DomainValidationError("Reel requires between 2 and 40 scenes");
  const allowed = new Set(supportingClaimIds);
  let previousEnd = 0;
  const scenes = input.scenes.map((scene, index) => {
    if (!scene || typeof scene !== "object") throw new DomainValidationError(`reel.scenes[${index}] is required`);
    const startSecond = finiteNumber(scene.startSecond, `reel.scenes[${index}].startSecond`);
    const endSecond = finiteNumber(scene.endSecond, `reel.scenes[${index}].endSecond`);
    if (index === 0 && startSecond !== 0) throw new DomainValidationError("Reel first scene must start at zero");
    if (startSecond < previousEnd || endSecond <= startSecond) throw new DomainValidationError("Reel scenes must be ordered and non-overlapping");
    if (endSecond > targetDurationSeconds) throw new DomainValidationError("Reel scene exceeds target duration");
    previousEnd = endSecond;
    const ids = claimIds(scene.supportingClaimIds, `reel.scenes[${index}].supportingClaimIds`);
    assertClaimSubset(ids, allowed, `reel.scenes[${index}]`);
    return {
      startSecond,
      endSecond,
      visual: text(scene.visual, `reel.scenes[${index}].visual`, 1_000),
      onScreenText: text(scene.onScreenText, `reel.scenes[${index}].onScreenText`, 500),
      voiceover: text(scene.voiceover, `reel.scenes[${index}].voiceover`, 2_000),
      supportingClaimIds: ids,
    };
  });
  return {
    format: "reel",
    hook: text(input.hook, "reel.hook", 300),
    targetDurationSeconds,
    scenes,
    caption: text(input.caption, "reel.caption", 5_000),
    cta: text(input.cta, "reel.cta", 500),
    supportingClaimIds,
  };
}

function claimIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new DomainValidationError(`${field} requires at least one Claim`);
  return [...new Set(value.map((item) => text(item, field, 200)))];
}
function assertClaimSubset(ids: string[], allowed: Set<string>, field: string): void { if (ids.some((id) => !allowed.has(id))) throw new DomainValidationError(`${field} references a Claim outside the plan lineage`); }
function finiteNumber(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new DomainValidationError(`${field} must be a non-negative finite number`); return value; }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`); const normalized = value.trim(); if (normalized.length > max) throw new DomainValidationError(`${field} is too long`); return normalized; }
