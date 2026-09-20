import { DomainValidationError } from "./index";

export const HUNTER_RANKING_SCHEMA_VERSION = "2" as const;

export interface OpportunityValueScores {
  brandFit: number;
  audienceNeed: number;
  evidenceStrength: number;
  trendMomentum: number;
  originality: number;
  actionability: number;
  expectedBrandPerformance: number;
  freshness: number;
  authority: number;
  learningValue: number;

  duplicationPenalty: number;
  saturationPenalty: number;
  weakProvenancePenalty: number;
  manipulationRiskPenalty: number;
  brandBoundaryRiskPenalty: number;
  overexposurePenalty: number;
  lowConfidencePenalty: number;
  recentRejectionSimilarityPenalty: number;

  overall: number;
  rankingVersion: string;
}

export function prepareOpportunityValueScores(input: OpportunityValueScores): OpportunityValueScores {
  const rankingVersion = requiredText(input.rankingVersion, "rankingVersion", 120);
  const values: Array<[keyof Omit<OpportunityValueScores, "rankingVersion">, number]> = [
    ["brandFit", input.brandFit],
    ["audienceNeed", input.audienceNeed],
    ["evidenceStrength", input.evidenceStrength],
    ["trendMomentum", input.trendMomentum],
    ["originality", input.originality],
    ["actionability", input.actionability],
    ["expectedBrandPerformance", input.expectedBrandPerformance],
    ["freshness", input.freshness],
    ["authority", input.authority],
    ["learningValue", input.learningValue],
    ["duplicationPenalty", input.duplicationPenalty],
    ["saturationPenalty", input.saturationPenalty],
    ["weakProvenancePenalty", input.weakProvenancePenalty],
    ["manipulationRiskPenalty", input.manipulationRiskPenalty],
    ["brandBoundaryRiskPenalty", input.brandBoundaryRiskPenalty],
    ["overexposurePenalty", input.overexposurePenalty],
    ["lowConfidencePenalty", input.lowConfidencePenalty],
    ["recentRejectionSimilarityPenalty", input.recentRejectionSimilarityPenalty],
    ["overall", input.overall],
  ];

  for (const [field, value] of values) score(value, field);
  return { ...input, rankingVersion };
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
