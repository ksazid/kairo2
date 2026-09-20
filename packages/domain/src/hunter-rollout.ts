import { DomainValidationError } from "./index";

export const HUNTER_ROLLOUT_POLICY_VERSION = "hunter-rollout-v1" as const;

export type HunterRolloutStage = "off" | "shadow" | "canary" | "production";

export type HunterCriticalViolation =
  | "tenant-isolation"
  | "manipulation-safety"
  | "persistence-authority"
  | "evidence-provenance"
  | "production-guard-bypass";

export interface HunterRolloutPolicy {
  version: typeof HUNTER_ROLLOUT_POLICY_VERSION;
  minShadowRuns: number;
  minShadowBrands: number;
  minShadowQualityDelta: number;
  minRetrievalCoverage: number;
  maxFailureRate: number;
  maxP95LatencyRatio: number;
  maxAverageCostRatio: number;
  explorationMin: number;
  explorationMax: number;
  maximumTopicShare: number;
  minCanaryRuns: number;
  minCanaryBrands: number;
  minCanaryPositiveActionDelta: number;
  maxCanaryNegativeActionDelta: number;
}

export const DEFAULT_HUNTER_ROLLOUT_POLICY: HunterRolloutPolicy = Object.freeze({
  version: HUNTER_ROLLOUT_POLICY_VERSION,
  minShadowRuns: 30,
  minShadowBrands: 3,
  minShadowQualityDelta: -0.02,
  minRetrievalCoverage: 0.85,
  maxFailureRate: 0.05,
  maxP95LatencyRatio: 1.5,
  maxAverageCostRatio: 1.5,
  explorationMin: 0.08,
  explorationMax: 0.2,
  maximumTopicShare: 0.34,
  minCanaryRuns: 50,
  minCanaryBrands: 3,
  minCanaryPositiveActionDelta: -0.02,
  maxCanaryNegativeActionDelta: 0.03,
});

export interface HunterShadowRolloutObservation {
  runId: string;
  brandId: string;
  v1QualityScore: number;
  v2QualityScore: number;
  retrievalCoverage: number;
  v1LatencyMs: number;
  v2LatencyMs: number;
  v1CostUsd: number;
  v2CostUsd: number;
  v2Failure: boolean;
  explorationShare: number;
  maximumTopicShare: number;
  criticalViolations?: HunterCriticalViolation[];
}

export interface HunterCanaryRolloutObservation {
  runId: string;
  brandId: string;
  controlPositiveActionRate: number;
  canaryPositiveActionRate: number;
  controlNegativeActionRate: number;
  canaryNegativeActionRate: number;
  canaryFailure: boolean;
  criticalViolations?: HunterCriticalViolation[];
}

export interface HunterRolloutReadiness {
  policyVersion: typeof HUNTER_ROLLOUT_POLICY_VERSION;
  allowedStage: HunterRolloutStage;
  shadowReady: boolean;
  canaryReady: boolean;
  productionReady: boolean;
  killSwitch: boolean;
  blockers: string[];
  warnings: string[];
  metrics: {
    shadowRuns: number;
    shadowBrands: number;
    averageQualityDelta: number;
    averageRetrievalCoverage: number;
    v2FailureRate: number;
    p95LatencyRatio: number;
    averageCostRatio: number;
    minimumExplorationShare: number;
    maximumExplorationShare: number;
    maximumObservedTopicShare: number;
    canaryRuns: number;
    canaryBrands: number;
    canaryPositiveActionDelta: number;
    canaryNegativeActionDelta: number;
    canaryFailureRate: number;
  };
}

export function evaluateHunterRolloutReadiness(input: {
  shadow: readonly HunterShadowRolloutObservation[];
  canary?: readonly HunterCanaryRolloutObservation[];
  productionEnableApproved?: boolean;
  policy?: HunterRolloutPolicy;
}): HunterRolloutReadiness {
  const policy = validatePolicy(input.policy ?? DEFAULT_HUNTER_ROLLOUT_POLICY);
  const shadow = input.shadow.map(validateShadowObservation);
  const canary = (input.canary ?? []).map(validateCanaryObservation);

  const critical = [
    ...shadow.flatMap((item) => item.criticalViolations ?? []),
    ...canary.flatMap((item) => item.criticalViolations ?? []),
  ];
  const killSwitch = critical.length > 0;

  const shadowRuns = new Set(shadow.map((item) => item.runId)).size;
  const shadowBrands = new Set(shadow.map((item) => item.brandId)).size;
  const averageQualityDelta = average(shadow.map((item) => item.v2QualityScore - item.v1QualityScore));
  const averageRetrievalCoverage = average(shadow.map((item) => item.retrievalCoverage));
  const v2FailureRate = rate(shadow.filter((item) => item.v2Failure).length, shadow.length);
  const latencyRatios = shadow.map((item) => ratio(item.v2LatencyMs, item.v1LatencyMs));
  const p95LatencyRatio = percentile(latencyRatios, 0.95);
  const averageCostRatio = average(shadow.map((item) => ratio(item.v2CostUsd, item.v1CostUsd)));
  const explorationShares = shadow.map((item) => item.explorationShare);
  const minimumExplorationShare = explorationShares.length ? Math.min(...explorationShares) : 0;
  const maximumExplorationShare = explorationShares.length ? Math.max(...explorationShares) : 0;
  const maximumObservedTopicShare = shadow.length ? Math.max(...shadow.map((item) => item.maximumTopicShare)) : 0;

  const canaryRuns = new Set(canary.map((item) => item.runId)).size;
  const canaryBrands = new Set(canary.map((item) => item.brandId)).size;
  const canaryPositiveActionDelta = average(
    canary.map((item) => item.canaryPositiveActionRate - item.controlPositiveActionRate),
  );
  const canaryNegativeActionDelta = average(
    canary.map((item) => item.canaryNegativeActionRate - item.controlNegativeActionRate),
  );
  const canaryFailureRate = rate(canary.filter((item) => item.canaryFailure).length, canary.length);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (killSwitch) blockers.push("Critical safety or authority violation requires rollout hold and kill-switch.");
  if (shadowRuns < policy.minShadowRuns) blockers.push("Insufficient shadow run coverage.");
  if (shadowBrands < policy.minShadowBrands) blockers.push("Insufficient distinct Brand coverage.");
  if (averageQualityDelta < policy.minShadowQualityDelta) blockers.push("Hunter V2 shadow quality regresses beyond policy.");
  if (averageRetrievalCoverage < policy.minRetrievalCoverage) blockers.push("Hunter V2 retrieval coverage is below policy.");
  if (v2FailureRate > policy.maxFailureRate) blockers.push("Hunter V2 shadow failure rate exceeds policy.");
  if (p95LatencyRatio > policy.maxP95LatencyRatio) blockers.push("Hunter V2 p95 latency ratio exceeds policy.");
  if (averageCostRatio > policy.maxAverageCostRatio) blockers.push("Hunter V2 average cost ratio exceeds policy.");
  if (shadow.length && minimumExplorationShare < policy.explorationMin) blockers.push("Exploration share fell below certified EEI minimum.");
  if (shadow.length && maximumExplorationShare > policy.explorationMax) blockers.push("Exploration share exceeded certified EEI maximum.");
  if (shadow.length && maximumObservedTopicShare > policy.maximumTopicShare) blockers.push("Topic concentration exceeded certified EEI maximum.");

  const shadowReady = blockers.length === 0;
  const canaryReady = shadowReady;

  const productionBlockers: string[] = [];
  if (canaryRuns < policy.minCanaryRuns) productionBlockers.push("Insufficient canary run coverage.");
  if (canaryBrands < policy.minCanaryBrands) productionBlockers.push("Insufficient canary Brand coverage.");
  if (canaryPositiveActionDelta < policy.minCanaryPositiveActionDelta) {
    productionBlockers.push("Canary positive-action rate regresses beyond policy.");
  }
  if (canaryNegativeActionDelta > policy.maxCanaryNegativeActionDelta) {
    productionBlockers.push("Canary negative-action rate regresses beyond policy.");
  }
  if (canaryFailureRate > policy.maxFailureRate) productionBlockers.push("Canary failure rate exceeds policy.");
  if (!input.productionEnableApproved) {
    productionBlockers.push("Explicit human production-enable approval is required.");
  }

  if (shadowReady && productionBlockers.length) warnings.push(...productionBlockers);

  const productionReady = shadowReady && productionBlockers.length === 0 && !killSwitch;
  const allowedStage: HunterRolloutStage = killSwitch
    ? "off"
    : productionReady
      ? "production"
      : canaryReady
        ? "canary"
        : shadow.length
          ? "shadow"
          : "off";

  return {
    policyVersion: HUNTER_ROLLOUT_POLICY_VERSION,
    allowedStage,
    shadowReady,
    canaryReady,
    productionReady,
    killSwitch,
    blockers,
    warnings,
    metrics: {
      shadowRuns,
      shadowBrands,
      averageQualityDelta,
      averageRetrievalCoverage,
      v2FailureRate,
      p95LatencyRatio,
      averageCostRatio,
      minimumExplorationShare,
      maximumExplorationShare,
      maximumObservedTopicShare,
      canaryRuns,
      canaryBrands,
      canaryPositiveActionDelta,
      canaryNegativeActionDelta,
      canaryFailureRate,
    },
  };
}

function validateShadowObservation(input: HunterShadowRolloutObservation): HunterShadowRolloutObservation {
  return {
    runId: text(input.runId, "shadow.runId"),
    brandId: text(input.brandId, "shadow.brandId"),
    v1QualityScore: score(input.v1QualityScore, "shadow.v1QualityScore"),
    v2QualityScore: score(input.v2QualityScore, "shadow.v2QualityScore"),
    retrievalCoverage: score(input.retrievalCoverage, "shadow.retrievalCoverage"),
    v1LatencyMs: positive(input.v1LatencyMs, "shadow.v1LatencyMs"),
    v2LatencyMs: positive(input.v2LatencyMs, "shadow.v2LatencyMs"),
    v1CostUsd: nonNegative(input.v1CostUsd, "shadow.v1CostUsd"),
    v2CostUsd: nonNegative(input.v2CostUsd, "shadow.v2CostUsd"),
    v2Failure: Boolean(input.v2Failure),
    explorationShare: score(input.explorationShare, "shadow.explorationShare"),
    maximumTopicShare: score(input.maximumTopicShare, "shadow.maximumTopicShare"),
    ...(input.criticalViolations?.length
      ? { criticalViolations: [...new Set(input.criticalViolations.map(criticalViolation))] }
      : {}),
  };
}

function validateCanaryObservation(input: HunterCanaryRolloutObservation): HunterCanaryRolloutObservation {
  return {
    runId: text(input.runId, "canary.runId"),
    brandId: text(input.brandId, "canary.brandId"),
    controlPositiveActionRate: score(input.controlPositiveActionRate, "canary.controlPositiveActionRate"),
    canaryPositiveActionRate: score(input.canaryPositiveActionRate, "canary.canaryPositiveActionRate"),
    controlNegativeActionRate: score(input.controlNegativeActionRate, "canary.controlNegativeActionRate"),
    canaryNegativeActionRate: score(input.canaryNegativeActionRate, "canary.canaryNegativeActionRate"),
    canaryFailure: Boolean(input.canaryFailure),
    ...(input.criticalViolations?.length
      ? { criticalViolations: [...new Set(input.criticalViolations.map(criticalViolation))] }
      : {}),
  };
}

function validatePolicy(input: HunterRolloutPolicy): HunterRolloutPolicy {
  if (input.version !== HUNTER_ROLLOUT_POLICY_VERSION) {
    throw new DomainValidationError("Hunter rollout policy version is not supported");
  }
  positiveInteger(input.minShadowRuns, "minShadowRuns");
  positiveInteger(input.minShadowBrands, "minShadowBrands");
  signedScore(input.minShadowQualityDelta, "minShadowQualityDelta");
  score(input.minRetrievalCoverage, "minRetrievalCoverage");
  score(input.maxFailureRate, "maxFailureRate");
  positive(input.maxP95LatencyRatio, "maxP95LatencyRatio");
  positive(input.maxAverageCostRatio, "maxAverageCostRatio");
  score(input.explorationMin, "explorationMin");
  score(input.explorationMax, "explorationMax");
  if (input.explorationMin > input.explorationMax) {
    throw new DomainValidationError("explorationMin cannot exceed explorationMax");
  }
  score(input.maximumTopicShare, "maximumTopicShare");
  positiveInteger(input.minCanaryRuns, "minCanaryRuns");
  positiveInteger(input.minCanaryBrands, "minCanaryBrands");
  signedScore(input.minCanaryPositiveActionDelta, "minCanaryPositiveActionDelta");
  signedScore(input.maxCanaryNegativeActionDelta, "maxCanaryNegativeActionDelta");
  return { ...input };
}

function criticalViolation(value: HunterCriticalViolation): HunterCriticalViolation {
  const allowed: readonly HunterCriticalViolation[] = [
    "tenant-isolation",
    "manipulation-safety",
    "persistence-authority",
    "evidence-provenance",
    "production-guard-bypass",
  ];
  if (!allowed.includes(value)) throw new DomainValidationError("Critical rollout violation is not supported");
  return value;
}

function percentile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index]!;
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rate(count: number, total: number): number {
  return total ? count / total : 0;
}

function ratio(value: number, baseline: number): number {
  if (baseline === 0) return value === 0 ? 1 : Number.POSITIVE_INFINITY;
  return value / baseline;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(field + " is required");
  return value.trim().slice(0, 240);
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(field + " must be a number from 0 to 1");
  }
  return value;
}

function signedScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new DomainValidationError(field + " must be a number from -1 to 1");
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

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new DomainValidationError(field + " must be a positive integer");
  }
  return value as number;
}
