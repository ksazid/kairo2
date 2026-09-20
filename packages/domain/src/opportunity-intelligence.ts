import type { BrandOpportunityDto } from "@kairo/contracts";
import { DomainValidationError } from "./index";
import { prepareRecommendationExplanation, type RecommendationExplanation } from "./eei";
import { prepareOpportunityValueScores, type OpportunityValueScores } from "./hunter-ranking";
import { TREND_STAGES, type TrendIntelligenceSummary } from "./trend-intelligence";

export const OPPORTUNITY_INTELLIGENCE_SCHEMA_VERSION = "2" as const;

export interface ContentMechanism {
  hookType?: string;
  promise?: string;
  structure?: string;
  emotion?: string[];
  proofType?: string[];
  visualMechanism?: string[];
  ctaType?: string;
  format?: string;
  confidence: number;
}

export interface OpportunityIntelligence {
  schemaVersion: typeof OPPORTUNITY_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  brandId: string;

  title: string;
  sanitizedSummary: string;
  whyNow: string;
  brandReason: string;
  audienceReason: string;

  trend?: TrendIntelligenceSummary;
  mechanism?: ContentMechanism;

  proposedAngle: string;
  hook?: string;
  targetAudience?: string;
  objective?: string;
  recommendedFormat?: string;
  recommendedChannel?: string;

  evidence: {
    signalIds: string[];
    sourceCount: number;
    independentPublisherCount: number;
    sourceClasses: string[];
    confidence: number;
    confidenceLabel: "High" | "Medium" | "Emerging";
  };

  scores: OpportunityValueScores;
  explanation: RecommendationExplanation;

  provenance: {
    snapshotVersion: string;
    planVersion: string;
    hunterRunId: string;
    rankingVersion: string;
    eeiVersion: string;
  };

  createdAt: string;
}

export type OpportunityIntelligenceInput = Omit<OpportunityIntelligence, "schemaVersion">;

export function prepareOpportunityIntelligence(input: OpportunityIntelligenceInput): OpportunityIntelligence {
  const signalIds = uniqueText(input.evidence.signalIds, "evidence.signalIds", 200, 100);
  if (!signalIds.length) throw new DomainValidationError("Opportunity intelligence requires supporting signals");

  const sourceCount = nonNegativeInteger(input.evidence.sourceCount, "evidence.sourceCount");
  if (sourceCount < 1) throw new DomainValidationError("evidence.sourceCount must be at least 1");

  const independentPublisherCount = nonNegativeInteger(
    input.evidence.independentPublisherCount,
    "evidence.independentPublisherCount",
  );
  if (independentPublisherCount > sourceCount) {
    throw new DomainValidationError("independentPublisherCount cannot exceed sourceCount");
  }

  const confidence = score(input.evidence.confidence, "evidence.confidence");
  const confidenceLabel = confidenceLabelFor(confidence);
  if (input.evidence.confidenceLabel !== confidenceLabel) {
    throw new DomainValidationError(`evidence.confidenceLabel must be ${confidenceLabel} for the supplied confidence`);
  }

  if (input.provenance.rankingVersion.trim() !== input.scores.rankingVersion.trim()) {
    throw new DomainValidationError("provenance.rankingVersion must match scores.rankingVersion");
  }

  return {
    schemaVersion: OPPORTUNITY_INTELLIGENCE_SCHEMA_VERSION,
    id: requiredText(input.id, "id", 200),
    workspaceId: requiredText(input.workspaceId, "workspaceId", 200),
    brandId: requiredText(input.brandId, "brandId", 200),
    title: requiredText(input.title, "title", 300),
    sanitizedSummary: requiredText(input.sanitizedSummary, "sanitizedSummary", 1_200),
    whyNow: requiredText(input.whyNow, "whyNow", 1_200),
    brandReason: requiredText(input.brandReason, "brandReason", 1_200),
    audienceReason: requiredText(input.audienceReason, "audienceReason", 1_200),
    ...(input.trend ? { trend: prepareTrendSummary(input.trend) } : {}),
    ...(input.mechanism ? { mechanism: prepareContentMechanism(input.mechanism) } : {}),
    proposedAngle: requiredText(input.proposedAngle, "proposedAngle", 1_200),
    ...(input.hook ? { hook: requiredText(input.hook, "hook", 500) } : {}),
    ...(input.targetAudience ? { targetAudience: requiredText(input.targetAudience, "targetAudience", 500) } : {}),
    ...(input.objective ? { objective: requiredText(input.objective, "objective", 500) } : {}),
    ...(input.recommendedFormat ? { recommendedFormat: requiredText(input.recommendedFormat, "recommendedFormat", 120) } : {}),
    ...(input.recommendedChannel ? { recommendedChannel: requiredText(input.recommendedChannel, "recommendedChannel", 120) } : {}),
    evidence: {
      signalIds,
      sourceCount,
      independentPublisherCount,
      sourceClasses: uniqueText(input.evidence.sourceClasses, "evidence.sourceClasses", 120, 50),
      confidence,
      confidenceLabel,
    },
    scores: prepareOpportunityValueScores(input.scores),
    explanation: prepareRecommendationExplanation(input.explanation),
    provenance: {
      snapshotVersion: requiredText(input.provenance.snapshotVersion, "provenance.snapshotVersion", 300),
      planVersion: requiredText(input.provenance.planVersion, "provenance.planVersion", 300),
      hunterRunId: requiredText(input.provenance.hunterRunId, "provenance.hunterRunId", 200),
      rankingVersion: requiredText(input.provenance.rankingVersion, "provenance.rankingVersion", 120),
      eeiVersion: requiredText(input.provenance.eeiVersion, "provenance.eeiVersion", 120),
    },
    createdAt: timestamp(input.createdAt, "createdAt"),
  };
}

export function prepareContentMechanism(input: ContentMechanism): ContentMechanism {
  return {
    ...(input.hookType ? { hookType: requiredText(input.hookType, "hookType", 200) } : {}),
    ...(input.promise ? { promise: requiredText(input.promise, "promise", 500) } : {}),
    ...(input.structure ? { structure: requiredText(input.structure, "structure", 200) } : {}),
    ...(input.emotion ? { emotion: uniqueText(input.emotion, "emotion", 120, 20) } : {}),
    ...(input.proofType ? { proofType: uniqueText(input.proofType, "proofType", 120, 20) } : {}),
    ...(input.visualMechanism ? { visualMechanism: uniqueText(input.visualMechanism, "visualMechanism", 160, 20) } : {}),
    ...(input.ctaType ? { ctaType: requiredText(input.ctaType, "ctaType", 160) } : {}),
    ...(input.format ? { format: requiredText(input.format, "format", 120) } : {}),
    confidence: score(input.confidence, "mechanism.confidence"),
  };
}

export const OPPORTUNITY_FEEDBACK_ACTIONS = [
  "impression",
  "opened",
  "saved",
  "dismissed",
  "not_relevant",
  "seen_before",
  "wrong_audience",
  "wrong_brand",
  "wrong_timing",
  "not_credible",
  "developed",
  "generated",
  "heavily_edited",
  "approved",
  "published",
  "performance_observed",
] as const;

export type OpportunityFeedbackAction = (typeof OPPORTUNITY_FEEDBACK_ACTIONS)[number];

export interface OpportunityFeedbackEventV2 {
  schemaVersion: "2";
  id: string;
  workspaceId: string;
  brandId: string;
  opportunityId: string;
  accountId: string;
  action: OpportunityFeedbackAction;
  surface: string;
  rankingVersion: string;
  occurredAt: string;
  position?: number;
  reason?: string;
  contentId?: string;
  idempotencyKey: string;
}

export type OpportunityFeedbackEventV2Input = Omit<OpportunityFeedbackEventV2, "schemaVersion" | "action"> & {
  action: string;
};

export function prepareOpportunityFeedbackEventV2(input: OpportunityFeedbackEventV2Input): OpportunityFeedbackEventV2 {
  if (!(OPPORTUNITY_FEEDBACK_ACTIONS as readonly string[]).includes(input.action)) {
    throw new DomainValidationError(`Opportunity feedback action is not supported: ${input.action}`);
  }
  if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
    throw new DomainValidationError("position must be a non-negative integer");
  }

  return {
    schemaVersion: "2",
    id: requiredText(input.id, "id", 200),
    workspaceId: requiredText(input.workspaceId, "workspaceId", 200),
    brandId: requiredText(input.brandId, "brandId", 200),
    opportunityId: requiredText(input.opportunityId, "opportunityId", 200),
    accountId: requiredText(input.accountId, "accountId", 200),
    action: input.action as OpportunityFeedbackAction,
    surface: requiredText(input.surface, "surface", 120),
    rankingVersion: requiredText(input.rankingVersion, "rankingVersion", 120),
    occurredAt: timestamp(input.occurredAt, "occurredAt"),
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(input.reason ? { reason: requiredText(input.reason, "reason", 500) } : {}),
    ...(input.contentId ? { contentId: requiredText(input.contentId, "contentId", 200) } : {}),
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey", 300),
  };
}

export function projectOpportunityFromIntelligence<T extends BrandOpportunityDto>(
  base: T,
  intelligence: OpportunityIntelligence,
): T {
  const details = base.details ? {
    ...base.details,
    proposedAngle: intelligence.proposedAngle,
    ...(intelligence.hook ? { hook: intelligence.hook } : {}),
    ...(intelligence.targetAudience ? { targetAudience: intelligence.targetAudience } : {}),
    ...(intelligence.objective ? { objective: intelligence.objective } : {}),
    ...(intelligence.recommendedFormat ? { recommendedFormat: intelligence.recommendedFormat } : {}),
    ...(intelligence.recommendedChannel ? { recommendedChannel: intelligence.recommendedChannel } : {}),
    supportingSourceIds: [...intelligence.evidence.signalIds],
    confidence: intelligence.evidence.confidence,
  } : undefined;

  return {
    ...base,
    title: intelligence.title,
    rationale: intelligence.sanitizedSummary,
    whyNow: intelligence.whyNow,
    developmentDirection: intelligence.proposedAngle,
    ...(details ? { details } : {}),
    intelligence,
  };
}

export function confidenceLabelFor(confidence: number): OpportunityIntelligence["evidence"]["confidenceLabel"] {
  score(confidence, "confidence");
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.55) return "Medium";
  return "Emerging";
}

function prepareTrendSummary(input: TrendIntelligenceSummary): TrendIntelligenceSummary {
  if (!TREND_STAGES.includes(input.stage)) throw new DomainValidationError("trend.stage is not supported");
  return {
    trendId: requiredText(input.trendId, "trend.trendId", 200),
    topic: requiredText(input.topic, "trend.topic", 300),
    stage: input.stage,
    velocity: score(input.velocity, "trend.velocity"),
    acceleration: score(input.acceleration, "trend.acceleration"),
    saturation: score(input.saturation, "trend.saturation"),
    evidenceConfidence: score(input.evidenceConfidence, "trend.evidenceConfidence"),
  };
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${field} must be a number from 0 to 1`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new DomainValidationError(`${field} must be a non-negative integer`);
  }
  return value as number;
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
