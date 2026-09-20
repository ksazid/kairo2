import { DomainValidationError } from "./index";
import type {
  HunterCriticalViolation,
  HunterShadowRolloutObservation,
} from "./hunter-rollout";

export const HUNTER_SHADOW_EVIDENCE_SCHEMA_VERSION = "1" as const;

export interface HunterShadowRuntimeSample {
  workspaceId: string;
  brandId: string;
  qualityScore: number;
  latencyMs: number;
  costUsd: number;
}

export interface HunterV2ShadowRuntimeSample extends HunterShadowRuntimeSample {
  retrievalExpected: number;
  retrievalCovered: number;
  failed: boolean;
  explorationRecommendations: number;
  totalRecommendations: number;
  recommendationTopics: string[];
  tenantIsolationVerified: boolean;
  manipulationSafetyVerified: boolean;
  provenanceComplete: boolean;
  persistenceAttempted: boolean;
  productionGuardIntact: boolean;
  criticalViolations?: HunterCriticalViolation[];
}

export interface HunterShadowEvidencePair {
  schemaVersion: typeof HUNTER_SHADOW_EVIDENCE_SCHEMA_VERSION;
  comparisonId: string;
  workspaceId: string;
  brandId: string;
  control: HunterShadowRuntimeSample;
  candidate: HunterV2ShadowRuntimeSample;
}

export interface PreparedHunterShadowEvidence {
  pair: HunterShadowEvidencePair;
  observation: HunterShadowRolloutObservation;
}

export function prepareHunterShadowEvidence(input: HunterShadowEvidencePair): PreparedHunterShadowEvidence {
  if (input.schemaVersion !== HUNTER_SHADOW_EVIDENCE_SCHEMA_VERSION) {
    throw new DomainValidationError("Hunter shadow evidence schema version is not supported");
  }

  const comparisonId = text(input.comparisonId, "comparisonId", 240);
  const workspaceId = text(input.workspaceId, "workspaceId", 200);
  const brandId = text(input.brandId, "brandId", 200);
  const control = prepareRuntimeSample(input.control, "control");
  const candidate = prepareCandidateSample(input.candidate);

  const violations = new Set<HunterCriticalViolation>(candidate.criticalViolations ?? []);
  if (
    control.workspaceId !== workspaceId ||
    candidate.workspaceId !== workspaceId ||
    control.brandId !== brandId ||
    candidate.brandId !== brandId ||
    !candidate.tenantIsolationVerified
  ) {
    violations.add("tenant-isolation");
  }
  if (!candidate.manipulationSafetyVerified) violations.add("manipulation-safety");
  if (candidate.persistenceAttempted) violations.add("persistence-authority");
  if (!candidate.provenanceComplete) violations.add("evidence-provenance");
  if (!candidate.productionGuardIntact) violations.add("production-guard-bypass");

  const observation: HunterShadowRolloutObservation = {
    runId: comparisonId,
    brandId,
    v1QualityScore: control.qualityScore,
    v2QualityScore: candidate.qualityScore,
    retrievalCoverage: candidate.retrievalExpected
      ? candidate.retrievalCovered / candidate.retrievalExpected
      : 0,
    v1LatencyMs: control.latencyMs,
    v2LatencyMs: candidate.latencyMs,
    v1CostUsd: control.costUsd,
    v2CostUsd: candidate.costUsd,
    v2Failure: candidate.failed,
    explorationShare: candidate.totalRecommendations
      ? candidate.explorationRecommendations / candidate.totalRecommendations
      : 0,
    maximumTopicShare: maximumTopicShare(candidate.recommendationTopics),
    ...(violations.size ? { criticalViolations: [...violations].sort() } : {}),
  };

  return {
    pair: {
      schemaVersion: HUNTER_SHADOW_EVIDENCE_SCHEMA_VERSION,
      comparisonId,
      workspaceId,
      brandId,
      control,
      candidate,
    },
    observation,
  };
}

function prepareRuntimeSample(input: HunterShadowRuntimeSample, prefix: string): HunterShadowRuntimeSample {
  return {
    workspaceId: text(input.workspaceId, prefix + ".workspaceId", 200),
    brandId: text(input.brandId, prefix + ".brandId", 200),
    qualityScore: score(input.qualityScore, prefix + ".qualityScore"),
    latencyMs: positive(input.latencyMs, prefix + ".latencyMs"),
    costUsd: nonNegative(input.costUsd, prefix + ".costUsd"),
  };
}

function prepareCandidateSample(input: HunterV2ShadowRuntimeSample): HunterV2ShadowRuntimeSample {
  const base = prepareRuntimeSample(input, "candidate");
  const retrievalExpected = nonNegativeInteger(input.retrievalExpected, "candidate.retrievalExpected");
  const retrievalCovered = nonNegativeInteger(input.retrievalCovered, "candidate.retrievalCovered");
  if (retrievalCovered > retrievalExpected) {
    throw new DomainValidationError("candidate.retrievalCovered cannot exceed candidate.retrievalExpected");
  }

  const totalRecommendations = nonNegativeInteger(input.totalRecommendations, "candidate.totalRecommendations");
  const explorationRecommendations = nonNegativeInteger(
    input.explorationRecommendations,
    "candidate.explorationRecommendations",
  );
  if (explorationRecommendations > totalRecommendations) {
    throw new DomainValidationError(
      "candidate.explorationRecommendations cannot exceed candidate.totalRecommendations",
    );
  }

  const recommendationTopics = input.recommendationTopics.map((value, index) =>
    text(value, "candidate.recommendationTopics[" + index + "]", 240),
  );
  if (recommendationTopics.length !== totalRecommendations) {
    throw new DomainValidationError(
      "candidate.recommendationTopics must contain one topic per recommendation",
    );
  }

  return {
    ...base,
    retrievalExpected,
    retrievalCovered,
    failed: Boolean(input.failed),
    explorationRecommendations,
    totalRecommendations,
    recommendationTopics,
    tenantIsolationVerified: input.tenantIsolationVerified === true,
    manipulationSafetyVerified: input.manipulationSafetyVerified === true,
    provenanceComplete: input.provenanceComplete === true,
    persistenceAttempted: input.persistenceAttempted === true,
    productionGuardIntact: input.productionGuardIntact === true,
    ...(input.criticalViolations?.length
      ? { criticalViolations: [...new Set(input.criticalViolations)] }
      : {}),
  };
}

function maximumTopicShare(topics: readonly string[]): number {
  if (!topics.length) return 0;
  const counts = new Map<string, number>();
  for (const value of topics) {
    const key = value.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / topics.length;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new DomainValidationError(field + " is required");
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(field + " is required");
  if (normalized.length > maxLength) throw new DomainValidationError(field + " is too long");
  return normalized;
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(field + " must be a number from 0 to 1");
  }
  return value;
}

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DomainValidationError(field + " must be a positive number");
  }
  return value;
}

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(field + " must be a non-negative number");
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new DomainValidationError(field + " must be a non-negative integer");
  }
  return value as number;
}
