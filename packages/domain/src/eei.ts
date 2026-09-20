import { DomainValidationError } from "./index";

export const EEI_SCHEMA_VERSION = "1" as const;

export const EEI_ALLOWED_OBJECTIVES = [
  "save",
  "develop",
  "generate",
  "approve",
  "publish",
  "declared-relevance",
  "brand-relative-performance-lift",
  "successful-completion",
  "sustained-satisfaction",
] as const;

export type EEIAllowedObjective = (typeof EEI_ALLOWED_OBJECTIVES)[number];

export const EEI_PROHIBITED_OBJECTIVES = [
  "time-in-app",
  "infinite-scroll-depth",
  "compulsive-refresh",
  "notification-opens",
  "artificial-urgency",
  "fear-anxiety-exploitation",
  "sensitive-trait-targeting",
  "rage-outrage-amplification",
] as const;

export interface EEIPolicy {
  schemaVersion: typeof EEI_SCHEMA_VERSION;
  version: string;
  optimizationObjectives: EEIAllowedObjective[];
  diversityFloor: number;
  maximumTopicShare: number;
  explorationMin: number;
  explorationMax: number;
  manipulationRiskBlockThreshold: number;
}

export type EEIPolicyInput = Omit<EEIPolicy, "schemaVersion" | "optimizationObjectives"> & {
  optimizationObjectives: string[];
};

export function prepareEEIPolicy(input: EEIPolicyInput): EEIPolicy {
  const version = requiredText(input.version, "version", 120);
  if (!Array.isArray(input.optimizationObjectives) || !input.optimizationObjectives.length) {
    throw new DomainValidationError("EEI requires at least one optimization objective");
  }

  const objectives = [...new Set(input.optimizationObjectives.map((value) => requiredText(value, "optimizationObjective", 120)))];
  for (const objective of objectives) {
    if (!(EEI_ALLOWED_OBJECTIVES as readonly string[]).includes(objective)) {
      throw new DomainValidationError(`EEI optimization objective is not allowed: ${objective}`);
    }
  }

  const explorationMin = score(input.explorationMin, "explorationMin");
  const explorationMax = score(input.explorationMax, "explorationMax");
  if (explorationMin > explorationMax) throw new DomainValidationError("explorationMin cannot exceed explorationMax");

  return {
    schemaVersion: EEI_SCHEMA_VERSION,
    version,
    optimizationObjectives: objectives as EEIAllowedObjective[],
    diversityFloor: score(input.diversityFloor, "diversityFloor"),
    maximumTopicShare: score(input.maximumTopicShare, "maximumTopicShare"),
    explorationMin,
    explorationMax,
    manipulationRiskBlockThreshold: score(input.manipulationRiskBlockThreshold, "manipulationRiskBlockThreshold"),
  };
}

export interface ManipulationRiskInput {
  artificialUrgency?: boolean;
  fearOrAnxietyExploitation?: boolean;
  deceptiveReengagement?: boolean;
  hiddenOptOut?: boolean;
  sensitiveTraitTargeting?: boolean;
  outrageAmplificationObjective?: boolean;
  compulsiveRewardLoop?: boolean;
}

export interface ManipulationRisk {
  score: number;
  blocked: boolean;
  reasons: string[];
}

export function evaluateManipulationRisk(input: ManipulationRiskInput, blockThreshold = 0.5): ManipulationRisk {
  score(blockThreshold, "blockThreshold");
  const reasons: string[] = [];
  const hard = [
    ["artificialUrgency", input.artificialUrgency],
    ["fearOrAnxietyExploitation", input.fearOrAnxietyExploitation],
    ["deceptiveReengagement", input.deceptiveReengagement],
    ["hiddenOptOut", input.hiddenOptOut],
    ["sensitiveTraitTargeting", input.sensitiveTraitTargeting],
    ["outrageAmplificationObjective", input.outrageAmplificationObjective],
    ["compulsiveRewardLoop", input.compulsiveRewardLoop],
  ] as const;

  for (const [reason, active] of hard) if (active) reasons.push(reason);

  const riskScore = Math.min(1, reasons.length / 2);
  return { score: riskScore, blocked: reasons.length > 0 && riskScore >= blockThreshold, reasons };
}

export interface RecommendationExplanation {
  whyRecommended: string;
  evidenceSummary: string;
  brandFitReason: string;
  uncertainty?: string;
  userControl: string;
}

export function prepareRecommendationExplanation(input: RecommendationExplanation): RecommendationExplanation {
  return {
    whyRecommended: requiredText(input.whyRecommended, "whyRecommended", 1_000),
    evidenceSummary: requiredText(input.evidenceSummary, "evidenceSummary", 1_000),
    brandFitReason: requiredText(input.brandFitReason, "brandFitReason", 1_000),
    ...(input.uncertainty ? { uncertainty: requiredText(input.uncertainty, "uncertainty", 1_000) } : {}),
    userControl: requiredText(input.userControl, "userControl", 500),
  };
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${field} must be a number from 0 to 1`);
  }
  return value;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(`${field} is required`);
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}
