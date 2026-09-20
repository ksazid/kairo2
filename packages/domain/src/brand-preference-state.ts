import { DomainValidationError } from "./index";

export const BRAND_PREFERENCE_STATE_SCHEMA_VERSION = "1" as const;

export interface PreferenceWeight {
  key: string;
  weight: number;
  evidenceCount?: number;
  lastReinforcedAt?: string;
}

export interface NegativePreference {
  key: string;
  strength: number;
  reason?: string;
  lastObservedAt: string;
}

export interface PerformancePreference {
  key: string;
  dimension: "topic" | "hook" | "structure" | "template" | "format" | "timing" | "channel" | "audience" | "mechanism";
  weight: number;
  confidence: number;
  learningId?: string;
}

export interface BrandPreferenceState {
  schemaVersion: typeof BRAND_PREFERENCE_STATE_SCHEMA_VERSION;
  workspaceId: string;
  brandId: string;
  snapshotVersion: string;

  longTerm: {
    topicWeights: PreferenceWeight[];
    audienceWeights: PreferenceWeight[];
    formatWeights: PreferenceWeight[];
    channelWeights: PreferenceWeight[];
    mechanismWeights: PreferenceWeight[];
  };

  shortTerm: {
    activeTopics: PreferenceWeight[];
    activeCampaignIds: string[];
    currentGoal?: string;
    currentChannel?: string;
    updatedAt: string;
  };

  negatives: {
    topics: NegativePreference[];
    audiences: NegativePreference[];
    mechanisms: NegativePreference[];
    sourceClasses: NegativePreference[];
  };

  performanceMemory: PerformancePreference[];
  explorationBudget: number;
  updatedAt: string;
}

export type BrandPreferenceStateInput = Omit<BrandPreferenceState, "schemaVersion">;

export function prepareBrandPreferenceState(input: BrandPreferenceStateInput): BrandPreferenceState {
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 200);
  const brandId = requiredText(input.brandId, "brandId", 200);
  const snapshotVersion = requiredText(input.snapshotVersion, "snapshotVersion", 300);
  const explorationBudget = score(input.explorationBudget, "explorationBudget");
  const updatedAt = timestamp(input.updatedAt, "updatedAt");
  const shortTermUpdatedAt = timestamp(input.shortTerm.updatedAt, "shortTerm.updatedAt");

  if (Date.parse(shortTermUpdatedAt) > Date.parse(updatedAt)) {
    throw new DomainValidationError("shortTerm.updatedAt cannot be after state updatedAt");
  }

  return {
    schemaVersion: BRAND_PREFERENCE_STATE_SCHEMA_VERSION,
    workspaceId,
    brandId,
    snapshotVersion,
    longTerm: {
      topicWeights: preferenceWeights(input.longTerm.topicWeights, "longTerm.topicWeights"),
      audienceWeights: preferenceWeights(input.longTerm.audienceWeights, "longTerm.audienceWeights"),
      formatWeights: preferenceWeights(input.longTerm.formatWeights, "longTerm.formatWeights"),
      channelWeights: preferenceWeights(input.longTerm.channelWeights, "longTerm.channelWeights"),
      mechanismWeights: preferenceWeights(input.longTerm.mechanismWeights, "longTerm.mechanismWeights"),
    },
    shortTerm: {
      activeTopics: preferenceWeights(input.shortTerm.activeTopics, "shortTerm.activeTopics"),
      activeCampaignIds: uniqueText(input.shortTerm.activeCampaignIds, "shortTerm.activeCampaignIds", 200, 100),
      ...(input.shortTerm.currentGoal ? { currentGoal: requiredText(input.shortTerm.currentGoal, "shortTerm.currentGoal", 500) } : {}),
      ...(input.shortTerm.currentChannel ? { currentChannel: requiredText(input.shortTerm.currentChannel, "shortTerm.currentChannel", 120) } : {}),
      updatedAt: shortTermUpdatedAt,
    },
    negatives: {
      topics: negativePreferences(input.negatives.topics, "negatives.topics"),
      audiences: negativePreferences(input.negatives.audiences, "negatives.audiences"),
      mechanisms: negativePreferences(input.negatives.mechanisms, "negatives.mechanisms"),
      sourceClasses: negativePreferences(input.negatives.sourceClasses, "negatives.sourceClasses"),
    },
    performanceMemory: performancePreferences(input.performanceMemory),
    explorationBudget,
    updatedAt,
  };
}

function preferenceWeights(values: readonly PreferenceWeight[], field: string): PreferenceWeight[] {
  if (!Array.isArray(values) || values.length > 200) throw new DomainValidationError(`${field} is invalid`);
  const seen = new Set<string>();
  return values.map((value, index) => {
    const key = requiredText(value.key, `${field}[${index}].key`, 300);
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) throw new DomainValidationError(`${field} contains duplicate keys`);
    seen.add(normalized);
    const evidenceCount = value.evidenceCount;
    if (evidenceCount !== undefined && (!Number.isInteger(evidenceCount) || evidenceCount < 0)) {
      throw new DomainValidationError(`${field}[${index}].evidenceCount must be a non-negative integer`);
    }
    return {
      key,
      weight: score(value.weight, `${field}[${index}].weight`),
      ...(evidenceCount !== undefined ? { evidenceCount } : {}),
      ...(value.lastReinforcedAt ? { lastReinforcedAt: timestamp(value.lastReinforcedAt, `${field}[${index}].lastReinforcedAt`) } : {}),
    };
  });
}

function negativePreferences(values: readonly NegativePreference[], field: string): NegativePreference[] {
  if (!Array.isArray(values) || values.length > 200) throw new DomainValidationError(`${field} is invalid`);
  const seen = new Set<string>();
  return values.map((value, index) => {
    const key = requiredText(value.key, `${field}[${index}].key`, 300);
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) throw new DomainValidationError(`${field} contains duplicate keys`);
    seen.add(normalized);
    return {
      key,
      strength: score(value.strength, `${field}[${index}].strength`),
      ...(value.reason ? { reason: requiredText(value.reason, `${field}[${index}].reason`, 500) } : {}),
      lastObservedAt: timestamp(value.lastObservedAt, `${field}[${index}].lastObservedAt`),
    };
  });
}

function performancePreferences(values: readonly PerformancePreference[]): PerformancePreference[] {
  if (!Array.isArray(values) || values.length > 200) throw new DomainValidationError("performanceMemory is invalid");
  return values.map((value, index) => ({
    key: requiredText(value.key, `performanceMemory[${index}].key`, 300),
    dimension: performanceDimension(value.dimension),
    weight: score(value.weight, `performanceMemory[${index}].weight`),
    confidence: score(value.confidence, `performanceMemory[${index}].confidence`),
    ...(value.learningId ? { learningId: requiredText(value.learningId, `performanceMemory[${index}].learningId`, 200) } : {}),
  }));
}

function performanceDimension(value: unknown): PerformancePreference["dimension"] {
  const supported: readonly PerformancePreference["dimension"][] = [
    "topic", "hook", "structure", "template", "format", "timing", "channel", "audience", "mechanism",
  ];
  if (typeof value !== "string" || !supported.includes(value as PerformancePreference["dimension"])) {
    throw new DomainValidationError("performanceMemory dimension is not supported");
  }
  return value as PerformancePreference["dimension"];
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
