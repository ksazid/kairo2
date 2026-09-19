import { prepareAgentInvocation, type AgentRuntimePort } from "@kairo/agent-contracts";
import type {
  CarouselSlideRole,
  CarouselStructure,
  ContentDevelopmentType,
  ProductionCarouselProjectDto,
  ProductionReelProjectDto,
  ReelSceneRole,
  StructuredContentDevelopmentDto,
} from "@kairo/contracts";

export interface ContentPlanGeneratorInput {
  workspaceId: string;
  brandId: string;
  brandContextVersion: string;
  idea: { id: string; title: string; premise: string };
  angle: { id: string; title: string; framing: string; audience: string; objective: string; hookDirection: string; recommendedFormat: string };
  contentType: ContentDevelopmentType;
  recommendationRationale: string;
  claims: Array<{ id: string; text: string; classification: string; verificationState: string }>;
}

export class ContentPlanGenerator {
  constructor(private readonly runtime: AgentRuntimePort) {}

  async generate(input: ContentPlanGeneratorInput): Promise<StructuredContentDevelopmentDto> {
    validateInput(input);
    const context = canonicalContext(input);
    const request = prepareAgentInvocation({
      role: "strategist",
      scope: { visibility: "brand-private", workspaceId: input.workspaceId, brandId: input.brandId },
      approvedContextVersion: input.brandContextVersion,
      capabilities: [],
      task: {
        instruction: instruction(input.contentType),
        context,
      },
      outputSchema: { name: input.contentType === "carousel" ? "production-carousel-project" : "production-reel-project", version: "1" },
      budget: { maxOutputTokens: 4_000, maxToolCalls: 0, maxCostUsd: 0.2, timeoutMs: 45_000 },
    });
    const result = await this.runtime.invoke<ProductionCarouselProjectDto | ProductionReelProjectDto>(request);
    const allowedClaims = new Set(input.claims.map((claim) => claim.id));
    const project = input.contentType === "carousel"
      ? validateCarouselProject(result.output, allowedClaims)
      : validateReelProject(result.output, allowedClaims);
    return {
      schemaVersion: 1,
      lineage: { ideaId: input.idea.id, angleId: input.angle.id, supportingClaimIds: [...project.supportingClaimIds] },
      contentType: input.contentType,
      recommendationRationale: input.recommendationRationale.trim(),
      project,
    };
  }
}

function canonicalContext(input: ContentPlanGeneratorInput) {
  return {
    idea: { id: input.idea.id.trim(), title: input.idea.title.trim(), premise: input.idea.premise.trim() },
    angle: {
      id: input.angle.id.trim(), title: input.angle.title.trim(), framing: input.angle.framing.trim(), audience: input.angle.audience.trim(),
      objective: input.angle.objective.trim(), hookDirection: input.angle.hookDirection.trim(), recommendedFormat: input.angle.recommendedFormat.trim(),
    },
    contentType: input.contentType,
    claims: input.claims.map((claim) => ({ id: claim.id.trim(), text: claim.text.trim(), classification: claim.classification.trim(), verificationState: claim.verificationState.trim() })),
  };
}

const STRUCTURES: CarouselStructure[] = ["aida", "pas", "listicle", "case-study", "story", "comparison"];
const SLIDE_ROLES: CarouselSlideRole[] = ["hook", "attention", "interest", "desire", "problem", "agitation", "solution", "list-item", "context", "challenge", "approach", "result", "story-beat", "comparison", "evidence", "insight", "cta"];
const SCENE_ROLES: ReelSceneRole[] = ["hook", "problem", "insight", "evidence", "solution", "cta", "story-beat"];

function instruction(type: ContentDevelopmentType): string {
  return `Develop the supplied Idea and selected Angle into one production ${type} project. Use only supplied Claim IDs, keep every factual statement inside that lineage, preserve stable item IDs, and return only the requested structured project. Do not publish, approve, render, or request tools.`;
}

function validateInput(input: ContentPlanGeneratorInput): void {
  if (!input || typeof input !== "object") throw new Error("Content plan generation input is required");
  text(input.workspaceId, "workspaceId", 200); text(input.brandId, "brandId", 200); text(input.brandContextVersion, "brandContextVersion", 160);
  text(input.idea?.id, "idea.id", 200); text(input.idea?.title, "idea.title", 500); text(input.idea?.premise, "idea.premise", 2_000);
  text(input.angle?.id, "angle.id", 200); text(input.angle?.title, "angle.title", 500); text(input.angle?.framing, "angle.framing", 2_000);
  text(input.angle?.audience, "angle.audience", 500); text(input.angle?.objective, "angle.objective", 1_000); text(input.angle?.hookDirection, "angle.hookDirection", 1_000); text(input.angle?.recommendedFormat, "angle.recommendedFormat", 120);
  if (input.contentType !== "carousel" && input.contentType !== "reel") throw new Error("contentType is not supported");
  text(input.recommendationRationale, "recommendationRationale", 1_000);
  if (!Array.isArray(input.claims) || !input.claims.length) throw new Error("Content plan generation requires Claims");
  if (input.claims.length > 100) throw new Error("Content plan generation accepts at most 100 Claims");
  const ids = input.claims.map((claim, index) => {
    const prefix = `claims[${index}]`;
    const id = text(claim?.id, `${prefix}.id`, 200);
    text(claim?.text, `${prefix}.text`, 5_000);
    text(claim?.classification, `${prefix}.classification`, 120);
    text(claim?.verificationState, `${prefix}.verificationState`, 120);
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Error("Claim IDs must be unique");
}

export function validateCarouselProject(value: unknown, allowedClaims?: Set<string>): ProductionCarouselProjectDto {
  const item = record(value, "carousel project");
  if (item.schemaVersion !== 1 || item.format !== "carousel") throw new Error("Production carousel project version/type is invalid");
  const structure = enumText(item.structure, STRUCTURES, "carousel.structure");
  const supportingClaimIds = claimIds(item.supportingClaimIds, "carousel.supportingClaimIds", allowedClaims);
  const allowed = new Set(supportingClaimIds);
  if (!Array.isArray(item.slides) || item.slides.length < 2 || item.slides.length > 10) throw new Error("Production carousel requires 2 to 10 slides");
  const ids = new Set<string>();
  const slides = item.slides.map((raw, index) => {
    const slide = record(raw, `carousel.slides[${index}]`);
    const id = stableCarouselId(slide.id, `carousel.slides[${index}].id`);
    if (ids.has(id)) throw new Error("Carousel slide IDs must be unique");
    ids.add(id);
    const claims = claimIds(slide.supportingClaimIds, `carousel.slides[${index}].supportingClaimIds`, allowed);
    return { id, role: enumText(slide.role, SLIDE_ROLES, `carousel.slides[${index}].role`), headline: text(slide.headline, "slide.headline", 240), body: text(slide.body, "slide.body", 2_000), ...(optionalImageAssetId(slide.imageAssetId)), supportingClaimIds: claims };
  });
  validateCarouselNarrative(structure, slides);
  return { schemaVersion: 1, format: "carousel", structure, coverHook: text(item.coverHook, "carousel.coverHook", 300), caption: text(item.caption, "carousel.caption", 5_000), cta: text(item.cta, "carousel.cta", 500), slides, supportingClaimIds };
}

export function validateReelProject(value: unknown, allowedClaims?: Set<string>): ProductionReelProjectDto {
  const item = record(value, "reel project");
  if (item.schemaVersion !== 1 || item.contentType !== "reel") throw new Error("Production Reel project version/type is invalid");
  const supportingClaimIds = claimIds(item.supportingClaimIds, "reel.supportingClaimIds", allowedClaims);
  const allowed = new Set(supportingClaimIds);
  const duration = number(item.targetDurationSeconds, "reel.targetDurationSeconds", 5, 300);
  if (!Array.isArray(item.scenes) || item.scenes.length < 2 || item.scenes.length > 40) throw new Error("Production Reel requires 2 to 40 scenes");
  const ids = new Set<string>(); let previousEnd = 0;
  const scenes = item.scenes.map((raw, index) => {
    const scene = record(raw, `reel.scenes[${index}]`); const id = stableId(scene.id, `reel.scenes[${index}].id`);
    if (ids.has(id)) throw new Error("Reel scene IDs must be unique"); ids.add(id);
    const startSecond = number(scene.startSecond, "scene.startSecond", 0, 300); const endSecond = number(scene.endSecond, "scene.endSecond", 0, 300);
    if ((index === 0 && startSecond !== 0) || startSecond < previousEnd || endSecond <= startSecond || endSecond > duration) throw new Error("Reel scene timing is invalid"); previousEnd = endSecond;
    return { id, role: enumText(scene.role, SCENE_ROLES, "scene.role"), startSecond, endSecond, visual: text(scene.visual, "scene.visual", 1_000), onScreenText: text(scene.onScreenText, "scene.onScreenText", 500), voiceover: text(scene.voiceover, "scene.voiceover", 2_000), supportingClaimIds: claimIds(scene.supportingClaimIds, "scene.supportingClaimIds", allowed) };
  });
  return { schemaVersion: 1, contentType: "reel", title: text(item.title, "reel.title", 300), hook: text(item.hook, "reel.hook", 300), targetDurationSeconds: duration, caption: text(item.caption, "reel.caption", 2_200), cta: text(item.cta, "reel.cta", 500), scenes, supportingClaimIds };
}

function record(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} is required`); return value as Record<string, unknown>; }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`); const result = value.trim(); if (result.length > max) throw new Error(`${field} is too long`); return result; }
function optionalImageAssetId(value: unknown): { imageAssetId?: string } { return value === undefined ? {} : { imageAssetId: text(value, "slide.imageAssetId", 600) }; }
function stableId(value: unknown, field: string): string { const id = text(value, field, 120); if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`${field} is invalid`); return id; }
function stableCarouselId(value: unknown, field: string): string { const id = text(value, field, 200); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) throw new Error(`${field} is invalid`); return id; }
function enumText<T extends string>(value: unknown, values: readonly T[], field: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${field} is not supported`); return value as T; }
function claimIds(value: unknown, field: string, allowed?: Set<string>): string[] { if (!Array.isArray(value) || !value.length) throw new Error(`${field} requires at least one Claim`); const ids = value.map((id) => text(id, field, 200)); if (new Set(ids).size !== ids.length) throw new Error(`${field} must be unique`); if (allowed && ids.some((id) => !allowed.has(id))) throw new Error(`${field} references a Claim outside the approved lineage`); return ids; }
function number(value: unknown, field: string, min: number, max: number): number { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} is invalid`); return value; }

function validateCarouselNarrative(structure: CarouselStructure, slides: ProductionCarouselProjectDto["slides"]): void {
  const roles = new Set(slides.map((slide) => slide.role));
  const required: Record<CarouselStructure, CarouselSlideRole[][]> = {
    aida: [["hook", "attention"], ["interest"], ["desire"], ["cta"]],
    pas: [["problem"], ["agitation"], ["solution"], ["cta"]],
    listicle: [["hook"], ["list-item"], ["cta"]],
    "case-study": [["context"], ["challenge"], ["approach"], ["result"], ["cta"]],
    story: [["hook"], ["story-beat"], ["cta"]],
    comparison: [["comparison"], ["cta"]],
  };
  for (const alternatives of required[structure]) if (!alternatives.some((role) => roles.has(role))) throw new Error(`${structure} carousel is missing required narrative roles`);
  if (slides.at(-1)?.role !== "cta") throw new Error("Production carousel must end with a CTA slide");
}
