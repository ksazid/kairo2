import { DomainValidationError } from "./index";

export const TREND_INTELLIGENCE_SCHEMA_VERSION = "1" as const;

export const TREND_STAGES = [
  "emerging",
  "rising",
  "accelerating",
  "mature",
  "saturated",
  "declining",
  "evergreen",
] as const;

export type TrendStage = (typeof TREND_STAGES)[number];

export interface TrendIntelligence {
  schemaVersion: typeof TREND_INTELLIGENCE_SCHEMA_VERSION;
  trendId: string;
  topic: string;
  stage: TrendStage;
  velocity: number;
  acceleration: number;
  crossSourceSpread: number;
  crossPlatformSpread: number;
  creatorOutlier: number;
  categoryOutlier: number;
  saturation: number;
  freshness: number;
  evidenceConfidence: number;
  firstObservedAt: string;
  lastObservedAt: string;
  supportingSignalIds: string[];
}

export type TrendIntelligenceInput = Omit<TrendIntelligence, "schemaVersion">;

export function prepareTrendIntelligence(input: TrendIntelligenceInput): TrendIntelligence {
  const trendId = requiredText(input.trendId, "trendId", 200);
  const topic = requiredText(input.topic, "topic", 300);
  if (!TREND_STAGES.includes(input.stage)) throw new DomainValidationError("trend stage is not supported");

  const firstObservedAt = timestamp(input.firstObservedAt, "firstObservedAt");
  const lastObservedAt = timestamp(input.lastObservedAt, "lastObservedAt");
  if (Date.parse(firstObservedAt) > Date.parse(lastObservedAt)) {
    throw new DomainValidationError("firstObservedAt cannot be after lastObservedAt");
  }

  const supportingSignalIds = uniqueText(input.supportingSignalIds, "supportingSignalIds", 200, 100);
  if (!supportingSignalIds.length) throw new DomainValidationError("Trend intelligence requires supporting signals");

  return {
    schemaVersion: TREND_INTELLIGENCE_SCHEMA_VERSION,
    trendId,
    topic,
    stage: input.stage,
    velocity: score(input.velocity, "velocity"),
    acceleration: score(input.acceleration, "acceleration"),
    crossSourceSpread: score(input.crossSourceSpread, "crossSourceSpread"),
    crossPlatformSpread: score(input.crossPlatformSpread, "crossPlatformSpread"),
    creatorOutlier: score(input.creatorOutlier, "creatorOutlier"),
    categoryOutlier: score(input.categoryOutlier, "categoryOutlier"),
    saturation: score(input.saturation, "saturation"),
    freshness: score(input.freshness, "freshness"),
    evidenceConfidence: score(input.evidenceConfidence, "evidenceConfidence"),
    firstObservedAt,
    lastObservedAt,
    supportingSignalIds,
  };
}

export interface TrendIntelligenceSummary {
  trendId: string;
  topic: string;
  stage: TrendStage;
  velocity: number;
  acceleration: number;
  saturation: number;
  evidenceConfidence: number;
}

export function summarizeTrendIntelligence(value: TrendIntelligence): TrendIntelligenceSummary {
  return {
    trendId: value.trendId,
    topic: value.topic,
    stage: value.stage,
    velocity: value.velocity,
    acceleration: value.acceleration,
    saturation: value.saturation,
    evidenceConfidence: value.evidenceConfidence,
  };
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${field} must be a number from 0 to 1`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(`${field} must be a valid timestamp`);
  return normalized;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(`${field} is required`);
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function uniqueText(values: unknown, field: string, maxLength: number, maxItems: number): string[] {
  if (!Array.isArray(values)) throw new DomainValidationError(`${field} must be a list`);
  if (values.length > maxItems) throw new DomainValidationError(`${field} has too many items`);
  const normalized = values.map((value) => requiredText(value, field, maxLength));
  return [...new Set(normalized)];
}
