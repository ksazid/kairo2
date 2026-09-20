import { DomainValidationError } from "./index";
import { prepareContentMechanism, type ContentMechanism } from "./opportunity-intelligence";

export const HUNTER_MULTISTAGE_SCHEMA_VERSION = "1" as const;
export const HUNTER_PRERANK_VERSION = "hunter-prerank-v1" as const;
export const HUNTER_DEEP_INTELLIGENCE_VERSION = "hunter-deep-v1" as const;

export type HunterPreRankUnknownFeature =
  | "brandSemanticSimilarity"
  | "preferenceAffinity"
  | "duplicationPenalty"
  | "hardNegativeSimilarity";

export interface HunterPreRankFeatures {
  brandSemanticSimilarity?: number;
  topicFit: number;
  evidenceStrength: number;
  freshness: number;
  trendMomentum: number;
  sourceDiversity: number;
  preferenceAffinity?: number;
  saturationPenalty: number;
  duplicationPenalty?: number;
  hardNegativeSimilarity?: number;
}

export interface HunterPreRankScore {
  schemaVersion: typeof HUNTER_MULTISTAGE_SCHEMA_VERSION;
  candidateId: string;
  preRankVersion: typeof HUNTER_PRERANK_VERSION;
  features: HunterPreRankFeatures;
  unknownFeatures: HunterPreRankUnknownFeature[];
  positiveScore: number;
  penaltyScore: number;
  overall: number;
}

export function scoreHunterPreRank(candidateId: string, input: HunterPreRankFeatures): HunterPreRankScore {
  const features: HunterPreRankFeatures = {
    ...(input.brandSemanticSimilarity !== undefined ? { brandSemanticSimilarity: score(input.brandSemanticSimilarity, "brandSemanticSimilarity") } : {}),
    topicFit: score(input.topicFit, "topicFit"),
    evidenceStrength: score(input.evidenceStrength, "evidenceStrength"),
    freshness: score(input.freshness, "freshness"),
    trendMomentum: score(input.trendMomentum, "trendMomentum"),
    sourceDiversity: score(input.sourceDiversity, "sourceDiversity"),
    ...(input.preferenceAffinity !== undefined ? { preferenceAffinity: score(input.preferenceAffinity, "preferenceAffinity") } : {}),
    saturationPenalty: score(input.saturationPenalty, "saturationPenalty"),
    ...(input.duplicationPenalty !== undefined ? { duplicationPenalty: score(input.duplicationPenalty, "duplicationPenalty") } : {}),
    ...(input.hardNegativeSimilarity !== undefined ? { hardNegativeSimilarity: score(input.hardNegativeSimilarity, "hardNegativeSimilarity") } : {}),
  };

  const unknownFeatures: HunterPreRankUnknownFeature[] = [];
  if (features.brandSemanticSimilarity === undefined) unknownFeatures.push("brandSemanticSimilarity");
  if (features.preferenceAffinity === undefined) unknownFeatures.push("preferenceAffinity");
  if (features.duplicationPenalty === undefined) unknownFeatures.push("duplicationPenalty");
  if (features.hardNegativeSimilarity === undefined) unknownFeatures.push("hardNegativeSimilarity");

  const positive = weightedKnown([
    [features.brandSemanticSimilarity, 0.24],
    [features.topicFit, 0.18],
    [features.evidenceStrength, 0.16],
    [features.freshness, 0.12],
    [features.trendMomentum, 0.12],
    [features.sourceDiversity, 0.08],
    [features.preferenceAffinity, 0.10],
  ]);

  const penalty = weightedKnown([
    [features.saturationPenalty, 0.08],
    [features.duplicationPenalty, 0.12],
    [features.hardNegativeSimilarity, 0.18],
  ], false);

  return {
    schemaVersion: HUNTER_MULTISTAGE_SCHEMA_VERSION,
    candidateId: requiredText(candidateId, "candidateId", 240),
    preRankVersion: HUNTER_PRERANK_VERSION,
    features,
    unknownFeatures,
    positiveScore: positive,
    penaltyScore: penalty,
    overall: clamp01(positive - penalty),
  };
}

export interface HunterDeepAnalysisRequest {
  candidateId: string;
  topic: string;
  stage: string;
  audience?: string;
  evidenceSummary: string;
  supportingSignalIds: string[];
  sourceClasses: string[];
  preRankScore: number;
}

export interface HunterDeepAnalysisResult {
  version: typeof HUNTER_DEEP_INTELLIGENCE_VERSION;
  candidateId: string;
  mechanism?: ContentMechanism;
  brandReason: string;
  audienceReason: string;
  whyNow: string;
  contentGap: string;
  proposedAngle: string;
  originality: number;
  actionability: number;
  confidence: number;
}

export interface HunterDeepAnalysisPort {
  analyze(request: HunterDeepAnalysisRequest): Promise<HunterDeepAnalysisResult>;
}

export function prepareHunterDeepAnalysisResult(input: HunterDeepAnalysisResult): HunterDeepAnalysisResult {
  if (input.version !== HUNTER_DEEP_INTELLIGENCE_VERSION) {
    throw new DomainValidationError("deep intelligence version is not supported");
  }
  return {
    version: HUNTER_DEEP_INTELLIGENCE_VERSION,
    candidateId: requiredText(input.candidateId, "candidateId", 240),
    ...(input.mechanism ? { mechanism: prepareContentMechanism(input.mechanism) } : {}),
    brandReason: requiredText(input.brandReason, "brandReason", 1_200),
    audienceReason: requiredText(input.audienceReason, "audienceReason", 1_200),
    whyNow: requiredText(input.whyNow, "whyNow", 1_200),
    contentGap: requiredText(input.contentGap, "contentGap", 1_200),
    proposedAngle: requiredText(input.proposedAngle, "proposedAngle", 1_200),
    originality: score(input.originality, "originality"),
    actionability: score(input.actionability, "actionability"),
    confidence: score(input.confidence, "confidence"),
  };
}

function weightedKnown(
  values: ReadonlyArray<readonly [number | undefined, number]>,
  normalize = true,
): number {
  let numerator = 0;
  let denominator = 0;
  for (const [value, weight] of values) {
    if (value === undefined) continue;
    numerator += value * weight;
    denominator += weight;
  }
  if (!denominator) return 0;
  return clamp01(normalize ? numerator / denominator : numerator);
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(field + " must be a number from 0 to 1");
  }
  return value;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new DomainValidationError(field + " is required");
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(field + " is required");
  if (normalized.length > maxLength) throw new DomainValidationError(field + " is too long");
  return normalized;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
