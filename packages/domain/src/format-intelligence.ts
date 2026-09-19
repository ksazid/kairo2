import { DomainValidationError } from "./index";
import type { PublishChannel, PublishContentType } from "./publishing";
import type { MarketingFormat } from "./skill-registry";

export type FormatObjective =
  | "educate"
  | "explain"
  | "compare"
  | "demonstrate"
  | "story"
  | "opinion"
  | "announce"
  | "conversation";

export type ProductionEffort = "low" | "medium" | "high";
export type ChannelFitStrength = "primary" | "useful" | "limited";
export type ExistingCreativePlanContract = "carousel-plan" | "reel-plan";

export interface FormatChannelFit {
  channel: PublishChannel;
  strength: ChannelFitStrength;
  rationale: string;
}

export interface FormatIntelligenceProfile {
  key: PublishContentType;
  label: string;
  summary: string;
  strategyFormat?: MarketingFormat;
  effort: ProductionEffort;
  objectives: FormatObjective[];
  channelFit: FormatChannelFit[];
  strengths: string[];
  tradeoffs: string[];
  composition: string[];
  reviewChecks: string[];
  creativePlanContract?: ExistingCreativePlanContract;
}

export interface FormatRecommendation {
  profile: FormatIntelligenceProfile;
  score: number;
  reasons: string[];
}

export interface FormatRecommendationInput {
  channel?: PublishChannel;
  objective?: FormatObjective;
  maxEffort?: ProductionEffort;
  acceptedLearnings?: AcceptedFormatLearning[];
}

export interface AcceptedFormatLearning {
  learningId: string;
  format: PublishContentType;
  channel?: PublishChannel;
  confidence: number;
  evidenceObservationIds: string[];
  reason: string;
}

const CHANNELS: PublishChannel[] = ["linkedin", "instagram", "facebook", "manual"];
const CONTENT_TYPES: PublishContentType[] = ["text", "image", "video", "carousel", "reel"];
const OBJECTIVES: FormatObjective[] = ["educate", "explain", "compare", "demonstrate", "story", "opinion", "announce", "conversation"];
const EFFORTS: ProductionEffort[] = ["low", "medium", "high"];
const STRATEGY_FORMATS: MarketingFormat[] = ["text", "static", "carousel", "reel"];
const FITS: ChannelFitStrength[] = ["primary", "useful", "limited"];

const RAW_CATALOG: FormatIntelligenceProfile[] = [
  {
    key: "text",
    label: "Text post",
    summary: "A focused written execution where the idea, argument and wording carry most of the value.",
    strategyFormat: "text",
    effort: "low",
    objectives: ["educate", "explain", "opinion", "announce", "conversation"],
    channelFit: [
      { channel: "linkedin", strength: "primary", rationale: "Strong fit for a clear argument, lesson, update or professional conversation." },
      { channel: "instagram", strength: "limited", rationale: "Useful as caption direction, but Kairo should usually pair the idea with an appropriate visual execution." },
      { channel: "facebook", strength: "primary", rationale: "Strong fit for a focused Page update, useful explanation or audience conversation." },
      { channel: "manual", strength: "useful", rationale: "Portable copy that can be adapted safely when Kairo does not own the final destination workflow." },
    ],
    strengths: ["Fast to produce and revise", "Keeps nuance in the written argument", "Easy to compare versions during review"],
    tradeoffs: ["Depends heavily on opening quality and structure", "Offers less visual demonstration than media-led formats"],
    composition: ["Open with the useful tension or takeaway", "Develop one coherent argument", "Use short readable sections", "End with one relevant CTA or question"],
    reviewChecks: ["The opening earns attention without clickbait", "Claims remain supported by the approved evidence", "The post has one clear point rather than several weak ones"],
  },
  {
    key: "image",
    label: "Static image",
    summary: "A single visual execution supported by concise copy when one frame can carry the message.",
    strategyFormat: "static",
    effort: "medium",
    objectives: ["announce", "demonstrate", "story"],
    channelFit: [
      { channel: "linkedin", strength: "useful", rationale: "Useful when a single diagram, proof point or visual summary strengthens the written context." },
      { channel: "instagram", strength: "primary", rationale: "Strong fit when one visual frame can communicate the core idea without forcing a multi-step narrative." },
      { channel: "facebook", strength: "primary", rationale: "Strong fit for a Page post where one image and concise copy carry the message." },
      { channel: "manual", strength: "useful", rationale: "A portable visual asset that can be exported into an authorised manual workflow." },
    ],
    strengths: ["Communicates one idea quickly", "Creates a clear visual focal point", "Works well for announcements, diagrams and proof points"],
    tradeoffs: ["Limited room for complex explanation", "Weak visual hierarchy can make the execution feel generic"],
    composition: ["Choose one visual message", "Keep on-image copy concise", "Use the caption for context rather than duplicating the image", "Preserve Brand visual hierarchy"],
    reviewChecks: ["The image is understandable without tiny text", "Visual claims match the approved evidence", "The caption adds context instead of repeating the frame"],
  },
  {
    key: "video",
    label: "Video",
    summary: "A general video execution for demonstration, explanation or narrative when motion adds real information.",
    effort: "high",
    objectives: ["demonstrate", "story", "explain"],
    channelFit: [
      { channel: "linkedin", strength: "useful", rationale: "Useful for demonstrations, founder explanations and motion that adds context beyond a text post." },
      { channel: "instagram", strength: "useful", rationale: "Useful when video is appropriate but the execution is not specifically structured as a Reel plan." },
      { channel: "facebook", strength: "useful", rationale: "Useful for Page-native demonstrations, explanations and stories." },
      { channel: "manual", strength: "useful", rationale: "Keeps a provider-neutral video concept available for an authorised external workflow." },
    ],
    strengths: ["Shows motion, process and personality", "Can make demonstrations easier to understand", "Supports richer narrative sequencing"],
    tradeoffs: ["Higher production and review effort", "Motion should not be used when a simpler format explains the idea better"],
    composition: ["State the value early", "Use motion only where it improves understanding", "Keep each section purposeful", "Plan captions or on-screen text for silent viewing where appropriate"],
    reviewChecks: ["The video earns its production cost", "Spoken and on-screen claims remain evidence-grounded", "The structure still works without ornamental motion"],
  },
  {
    key: "carousel",
    label: "Carousel",
    summary: "A sequenced visual narrative for teaching, comparing or unpacking an idea across multiple steps.",
    strategyFormat: "carousel",
    effort: "medium",
    objectives: ["educate", "explain", "compare"],
    channelFit: [
      { channel: "linkedin", strength: "useful", rationale: "Useful for structured educational or comparison narratives when multiple frames improve comprehension." },
      { channel: "instagram", strength: "primary", rationale: "Strong fit for a swipeable teaching, checklist or comparison sequence." },
      { channel: "facebook", strength: "limited", rationale: "Keep as an approved creative plan when automatic multi-image publishing is unavailable." },
      { channel: "manual", strength: "useful", rationale: "The sequenced concept can be carried into an authorised manual publishing flow." },
    ],
    strengths: ["Breaks complex ideas into readable steps", "Supports progressive explanation", "Makes comparisons and checklists easy to scan"],
    tradeoffs: ["Requires coherent slide-to-slide progression", "More production effort than a single visual"],
    composition: ["Use the existing CarouselPlan contract", "Make the cover promise specific", "Give every slide one job", "Build toward a useful conclusion rather than filler slides"],
    reviewChecks: ["The sequence works in order", "Every slide retains approved Claim lineage", "The carousel stays within Kairo's validated plan structure"],
    creativePlanContract: "carousel-plan",
  },
  {
    key: "reel",
    label: "Reel",
    summary: "A short scene-based vertical-video concept where timing, visual change and concise narration work together.",
    strategyFormat: "reel",
    effort: "high",
    objectives: ["demonstrate", "story", "explain"],
    channelFit: [
      { channel: "linkedin", strength: "limited", rationale: "The underlying video idea may transfer, but the Reel-specific structure should not be treated as a LinkedIn-native guarantee." },
      { channel: "instagram", strength: "primary", rationale: "Strong fit for concise scene-based storytelling, demonstrations and explanations designed for a Reel execution." },
      { channel: "facebook", strength: "limited", rationale: "Keep as an approved short-video plan until Facebook video publishing is explicitly enabled." },
      { channel: "manual", strength: "useful", rationale: "The validated scene plan can guide a separately authorised manual production workflow." },
    ],
    strengths: ["Combines motion, voice and on-screen text", "Supports concise demonstrations and stories", "Makes timing an explicit part of the content plan"],
    tradeoffs: ["Highest production coordination in the current library", "Weak scene changes or padded duration reduce clarity"],
    composition: ["Use the existing ReelPlan contract", "Start with the useful hook immediately", "Keep scenes ordered and non-overlapping", "Make visual, voiceover and on-screen text serve the same point"],
    reviewChecks: ["The first scene starts at zero under the validated contract", "Every scene retains approved Claim lineage", "The target duration and scene timing remain inside Kairo's validated ReelPlan"],
    creativePlanContract: "reel-plan",
  },
];

export const FORMAT_INTELLIGENCE_CATALOG: readonly FormatIntelligenceProfile[] = Object.freeze(RAW_CATALOG.map(validateFormatProfile));

export function recommendFormats(input: FormatRecommendationInput = {}): FormatRecommendation[] {
  const channel = input.channel === undefined ? undefined : one(input.channel, CHANNELS, "channel");
  const objective = input.objective === undefined ? undefined : one(input.objective, OBJECTIVES, "objective");
  const maxEffort = input.maxEffort === undefined ? undefined : one(input.maxEffort, EFFORTS, "maxEffort");
  const acceptedLearnings = normalizeAcceptedLearnings(input.acceptedLearnings);
  const maxEffortRank = maxEffort === undefined ? Number.POSITIVE_INFINITY : effortRank(maxEffort);

  return FORMAT_INTELLIGENCE_CATALOG
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => effortRank(profile.effort) <= maxEffortRank)
    .map(({ profile, index }) => {
      let score = 4 - effortRank(profile.effort);
      const reasons: string[] = [];
      if (channel) {
        const fit = profile.channelFit.find((item) => item.channel === channel)!;
        score += fitScore(fit.strength);
        reasons.push(`${fitLabel(fit.strength)} for ${channel}`);
      }
      if (objective && profile.objectives.includes(objective)) {
        score += 24;
        reasons.push(`Fits the ${objectiveLabel(objective)} objective`);
      }
      if (!channel && !objective) reasons.push(`${profile.effort} production effort`);
      if (maxEffort) reasons.push(`Within the ${maxEffort} effort limit`);
      for (const learning of acceptedLearnings) {
        if (learning.format !== profile.key || (learning.channel && channel && learning.channel !== channel)) continue;
        score += Math.min(12, Math.max(1, Math.round(learning.confidence * 12)));
        reasons.push(`Accepted Brand Learning: ${learning.reason} (${learning.evidenceObservationIds.length} observations)`);
      }
      return { profile, score, reasons, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ profile, score, reasons }) => ({ profile, score, reasons }));
}

function normalizeAcceptedLearnings(value: AcceptedFormatLearning[] | undefined): AcceptedFormatLearning[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DomainValidationError("acceptedLearnings must be a list");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new DomainValidationError(`acceptedLearnings[${index}] must be an object`);
    if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new DomainValidationError(`acceptedLearnings[${index}].confidence is invalid`);
    const evidenceObservationIds = uniqueText(item.evidenceObservationIds, `acceptedLearnings[${index}].evidenceObservationIds`);
    if (!evidenceObservationIds.length) throw new DomainValidationError(`acceptedLearnings[${index}] requires supporting evidence`);
    return { learningId: text(item.learningId, `acceptedLearnings[${index}].learningId`, 200), format: one(item.format, CONTENT_TYPES, `acceptedLearnings[${index}].format`), ...(item.channel ? { channel: one(item.channel, CHANNELS, `acceptedLearnings[${index}].channel`) } : {}), confidence: item.confidence, evidenceObservationIds, reason: text(item.reason, `acceptedLearnings[${index}].reason`, 300) };
  });
}

export function isFormatObjective(value: string): value is FormatObjective {
  return OBJECTIVES.includes(value as FormatObjective);
}

export function isProductionEffort(value: string): value is ProductionEffort {
  return EFFORTS.includes(value as ProductionEffort);
}

export function isFormatChannel(value: string): value is PublishChannel {
  return CHANNELS.includes(value as PublishChannel);
}

export function getFormatProfile(key: PublishContentType): FormatIntelligenceProfile {
  const contentType = one(key, CONTENT_TYPES, "format");
  const profile = FORMAT_INTELLIGENCE_CATALOG.find((item) => item.key === contentType);
  if (!profile) throw new DomainValidationError(`No format intelligence profile exists for ${contentType}`);
  return profile;
}

function validateFormatProfile(input: FormatIntelligenceProfile): FormatIntelligenceProfile {
  const key = one(input.key, CONTENT_TYPES, "format.key");
  const label = text(input.label, "format.label", 120);
  const summary = text(input.summary, "format.summary", 500);
  const effort = one(input.effort, EFFORTS, "format.effort");
  const objectives = uniqueEnums(input.objectives, OBJECTIVES, "format.objectives");
  const strengths = uniqueText(input.strengths, "format.strengths");
  const tradeoffs = uniqueText(input.tradeoffs, "format.tradeoffs");
  const composition = uniqueText(input.composition, "format.composition");
  const reviewChecks = uniqueText(input.reviewChecks, "format.reviewChecks");
  if (!Array.isArray(input.channelFit) || input.channelFit.length !== CHANNELS.length) throw new DomainValidationError("format.channelFit must cover every current Kairo channel");
  const channelFit = input.channelFit.map((item) => ({
    channel: one(item.channel, CHANNELS, "format.channelFit.channel"),
    strength: one(item.strength, FITS, "format.channelFit.strength"),
    rationale: text(item.rationale, "format.channelFit.rationale", 500),
  }));
  if (new Set(channelFit.map((item) => item.channel)).size !== CHANNELS.length) throw new DomainValidationError("format.channelFit channels must be unique");
  const strategyFormat = input.strategyFormat === undefined ? undefined : one(input.strategyFormat, STRATEGY_FORMATS, "format.strategyFormat");
  const creativePlanContract = input.creativePlanContract;
  if (creativePlanContract !== undefined && !["carousel-plan", "reel-plan"].includes(creativePlanContract)) throw new DomainValidationError("format.creativePlanContract is not supported");
  if (key === "carousel" && creativePlanContract !== "carousel-plan") throw new DomainValidationError("Carousel intelligence must reuse CarouselPlan");
  if (key === "reel" && creativePlanContract !== "reel-plan") throw new DomainValidationError("Reel intelligence must reuse ReelPlan");
  return { key, label, summary, effort, objectives, channelFit, strengths, tradeoffs, composition, reviewChecks, ...(strategyFormat ? { strategyFormat } : {}), ...(creativePlanContract ? { creativePlanContract } : {}) };
}

function fitScore(value: ChannelFitStrength): number {
  return value === "primary" ? 30 : value === "useful" ? 18 : 4;
}

function fitLabel(value: ChannelFitStrength): string {
  return value === "primary" ? "Primary format fit" : value === "useful" ? "Useful format fit" : "Limited format fit";
}

function effortRank(value: ProductionEffort): number {
  return value === "low" ? 1 : value === "medium" ? 2 : 3;
}

function objectiveLabel(value: FormatObjective): string {
  return value === "conversation" ? "conversation" : value;
}

function uniqueText(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new DomainValidationError(`${field} requires at least one item`);
  const items = value.map((item) => text(item, field, 500));
  if (new Set(items).size !== items.length) throw new DomainValidationError(`${field} must not contain duplicates`);
  return items;
}

function uniqueEnums<const T extends string>(value: unknown, allowed: readonly T[], field: string): T[] {
  if (!Array.isArray(value) || value.length === 0) throw new DomainValidationError(`${field} requires at least one item`);
  const items = value.map((item) => one(item, allowed, field));
  if (new Set(items).size !== items.length) throw new DomainValidationError(`${field} must not contain duplicates`);
  return items;
}

function one<const T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new DomainValidationError(`${field} is not supported`);
  return value as T;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}
