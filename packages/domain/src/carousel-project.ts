import { DomainValidationError } from "./index";
import { validateCarouselPlan, type CarouselPlan } from "./creative-formats";

export const CAROUSEL_STRUCTURES = ["aida", "pas", "listicle", "case-study", "story", "comparison"] as const;
export type CarouselStructure = typeof CAROUSEL_STRUCTURES[number];

export const CAROUSEL_SLIDE_ROLES = [
  "hook", "attention", "interest", "desire", "problem", "agitation", "solution",
  "list-item", "context", "challenge", "approach", "result", "story-beat",
  "comparison", "evidence", "insight", "cta",
] as const;
export type CarouselSlideRole = typeof CAROUSEL_SLIDE_ROLES[number];

export interface CarouselProjectSlide {
  id: string;
  role: CarouselSlideRole;
  headline: string;
  body: string;
  supportingClaimIds: string[];
  imageAssetId?: string;
}

export interface CarouselProject {
  schemaVersion: 1;
  format: "carousel";
  structure: CarouselStructure;
  coverHook: string;
  slides: CarouselProjectSlide[];
  caption: string;
  cta: string;
  supportingClaimIds: string[];
}

/** Validates the editable project while retaining stable slide identifiers. */
export function validateCarouselProject(input: CarouselProject): CarouselProject {
  if (!input || input.schemaVersion !== 1 || input.format !== "carousel") throw new DomainValidationError("Carousel Project schema version 1 is required");
  const structure = oneOf(input.structure, CAROUSEL_STRUCTURES, "carouselProject.structure");
  if (!Array.isArray(input.slides) || input.slides.length < 2 || input.slides.length > 10) throw new DomainValidationError("Instagram carousel requires between 2 and 10 slides");
  const supportingClaimIds = ids(input.supportingClaimIds, "carouselProject.supportingClaimIds");
  const allowed = new Set(supportingClaimIds);
  const slideIds = new Set<string>();
  const slides = input.slides.map((slide, index) => {
    if (!slide || typeof slide !== "object") throw new DomainValidationError(`carouselProject.slides[${index}] is required`);
    const id = stableId(slide.id, `carouselProject.slides[${index}].id`);
    if (slideIds.has(id)) throw new DomainValidationError("Carousel slide IDs must be unique");
    slideIds.add(id);
    const slideClaims = ids(slide.supportingClaimIds, `carouselProject.slides[${index}].supportingClaimIds`);
    if (slideClaims.some((claimId) => !allowed.has(claimId))) throw new DomainValidationError(`carouselProject.slides[${index}] references a Claim outside the project lineage`);
    return {
      id,
      role: oneOf(slide.role, CAROUSEL_SLIDE_ROLES, `carouselProject.slides[${index}].role`),
      headline: required(slide.headline, `carouselProject.slides[${index}].headline`, 240),
      body: required(slide.body, `carouselProject.slides[${index}].body`, 2_000),
      supportingClaimIds: slideClaims,
      ...(slide.imageAssetId ? { imageAssetId: required(slide.imageAssetId, `carouselProject.slides[${index}].imageAssetId`, 600) } : {}),
    };
  });
  validateNarrative(structure, slides);
  return {
    schemaVersion: 1,
    format: "carousel",
    structure,
    coverHook: required(input.coverHook, "carouselProject.coverHook", 300),
    slides,
    caption: required(input.caption, "carouselProject.caption", 5_000),
    cta: required(input.cta, "carouselProject.cta", 500),
    supportingClaimIds,
  };
}

export function compileCarouselProject(input: CarouselProject): CarouselPlan {
  const project = validateCarouselProject(input);
  return validateCarouselPlan({
    format: "carousel",
    coverHook: project.coverHook,
    slides: project.slides.map(({ headline, body, supportingClaimIds }) => ({ headline, body, supportingClaimIds: [...supportingClaimIds] })),
    caption: project.caption,
    cta: project.cta,
    supportingClaimIds: [...project.supportingClaimIds],
  });
}

function validateNarrative(structure: CarouselStructure, slides: CarouselProjectSlide[]): void {
  const roles = new Set(slides.map((slide) => slide.role));
  const requirements: Record<CarouselStructure, CarouselSlideRole[][]> = {
    aida: [["hook", "attention"], ["interest"], ["desire"], ["cta"]],
    pas: [["problem"], ["agitation"], ["solution"], ["cta"]],
    listicle: [["hook"], ["list-item"], ["cta"]],
    "case-study": [["context"], ["challenge"], ["approach"], ["result"], ["cta"]],
    story: [["hook"], ["story-beat"], ["cta"]],
    comparison: [["comparison"], ["cta"]],
  };
  for (const alternatives of requirements[structure]) {
    if (!alternatives.some((role) => roles.has(role))) throw new DomainValidationError(`${structure} carousel requires a ${alternatives.join(" or ")} slide`);
  }
  if (slides.at(-1)?.role !== "cta") throw new DomainValidationError("Carousel CTA must be the final slide");
}

function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.length) throw new DomainValidationError(`${field} requires at least one Claim`);
  const result = value.map((item) => required(item, field, 200));
  if (new Set(result).size !== result.length) throw new DomainValidationError(`${field} must not contain duplicates`);
  return result;
}
function required(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}
function stableId(value: unknown, field: string): string {
  const normalized = required(value, field, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(normalized)) throw new DomainValidationError(`${field} is invalid`);
  return normalized;
}
function oneOf<const T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new DomainValidationError(`${field} is not supported`);
  return value as T;
}
