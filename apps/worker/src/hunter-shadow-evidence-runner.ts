import {
  prepareHunterShadowEvidence,
  type PreparedHunterShadowEvidence,
} from "@kairo/domain/hunter-shadow-evidence";
import {
  evaluateHunterRolloutReadiness,
  type HunterRolloutReadiness,
} from "@kairo/domain/hunter-rollout";

export interface HunterShadowRunCase {
  comparisonId: string;
  workspaceId: string;
  brandId: string;
  inputFingerprint: string;
}

export interface HunterShadowMeasuredMetadata {
  latencyMs: number;
  costUsd: number;
}

export interface HunterShadowControlLaneResult {
  inputFingerprint: string;
  workspaceId: string;
  brandId: string;
  qualityScore: number;
  recommendationCount: number;
  metadata: HunterShadowMeasuredMetadata;
}

export interface HunterShadowCandidateLaneResult extends HunterShadowControlLaneResult {
  retrievalExpected: number;
  retrievalCovered: number;
  failed: boolean;
  explorationRecommendations: number;
  recommendationTopics: string[];
  tenantIsolationVerified: boolean;
  manipulationSafetyVerified: boolean;
  provenanceComplete: boolean;
  persistenceAttempted: boolean;
  productionGuardIntact: boolean;
}

export interface HunterShadowLaneExecutor {
  runControl(run: HunterShadowRunCase): Promise<HunterShadowControlLaneResult>;
  runCandidate(run: HunterShadowRunCase): Promise<HunterShadowCandidateLaneResult>;
}

export interface HunterShadowEvidenceBatch {
  schemaVersion: 1;
  evidenceKind: "hunter-v2-shadow-readiness";
  pairs: PreparedHunterShadowEvidence[];
  readiness: HunterRolloutReadiness;
}

export async function runHunterShadowEvidencePair(
  run: HunterShadowRunCase,
  executor: HunterShadowLaneExecutor,
): Promise<PreparedHunterShadowEvidence> {
  const normalized = prepareRunCase(run);
  const control = await executor.runControl(normalized);
  const candidate = await executor.runCandidate(normalized);

  requireMeasuredMetadata(control.metadata, "control");
  requireComparableControl(control);
  requireMeasuredMetadata(candidate.metadata, "candidate");

  const fingerprintMatches =
    control.inputFingerprint === normalized.inputFingerprint &&
    candidate.inputFingerprint === normalized.inputFingerprint &&
    control.inputFingerprint === candidate.inputFingerprint;

  return prepareHunterShadowEvidence({
    schemaVersion: "1",
    comparisonId: normalized.comparisonId,
    workspaceId: normalized.workspaceId,
    brandId: normalized.brandId,
    control: {
      workspaceId: control.workspaceId,
      brandId: control.brandId,
      qualityScore: control.qualityScore,
      latencyMs: control.metadata.latencyMs,
      costUsd: control.metadata.costUsd,
    },
    candidate: {
      workspaceId: candidate.workspaceId,
      brandId: candidate.brandId,
      qualityScore: candidate.qualityScore,
      latencyMs: candidate.metadata.latencyMs,
      costUsd: candidate.metadata.costUsd,
      retrievalExpected: candidate.retrievalExpected,
      retrievalCovered: candidate.retrievalCovered,
      failed: candidate.failed,
      explorationRecommendations: candidate.explorationRecommendations,
      totalRecommendations: candidate.recommendationTopics.length,
      recommendationTopics: [...candidate.recommendationTopics],
      tenantIsolationVerified: candidate.tenantIsolationVerified,
      manipulationSafetyVerified: candidate.manipulationSafetyVerified,
      provenanceComplete: candidate.provenanceComplete && fingerprintMatches,
      persistenceAttempted: candidate.persistenceAttempted,
      productionGuardIntact: candidate.productionGuardIntact,
    },
  });
}

export async function runHunterShadowEvidenceBatch(
  runs: readonly HunterShadowRunCase[],
  executor: HunterShadowLaneExecutor,
): Promise<HunterShadowEvidenceBatch> {
  const bounded = runs.slice(0, 200);
  const pairs: PreparedHunterShadowEvidence[] = [];
  for (const run of bounded) {
    pairs.push(await runHunterShadowEvidencePair(run, executor));
  }

  return {
    schemaVersion: 1,
    evidenceKind: "hunter-v2-shadow-readiness",
    pairs,
    readiness: evaluateHunterRolloutReadiness({
      shadow: pairs.map((pair) => pair.observation),
      productionEnableApproved: false,
    }),
  };
}

function prepareRunCase(input: HunterShadowRunCase): HunterShadowRunCase {
  return {
    comparisonId: text(input.comparisonId, "comparisonId", 240),
    workspaceId: text(input.workspaceId, "workspaceId", 200),
    brandId: text(input.brandId, "brandId", 200),
    inputFingerprint: fingerprint(input.inputFingerprint),
  };
}

export function isHunterShadowControlComparable(
  control: HunterShadowControlLaneResult,
): boolean {
  return Number.isInteger(control.recommendationCount) && control.recommendationCount > 0;
}

function requireComparableControl(control: HunterShadowControlLaneResult): void {
  if (!isHunterShadowControlComparable(control)) {
    throw new Error(
      "Comparable Hunter V1 control requires at least one measured recommendation",
    );
  }
}

function requireMeasuredMetadata(metadata: HunterShadowMeasuredMetadata, lane: string): void {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Measured metadata is required for " + lane);
  }
  if (!Number.isFinite(metadata.latencyMs) || metadata.latencyMs <= 0) {
    throw new Error("Measured positive latency is required for " + lane);
  }
  if (!Number.isFinite(metadata.costUsd) || metadata.costUsd < 0) {
    throw new Error("Measured non-negative cost is required for " + lane);
  }
}

function fingerprint(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("inputFingerprint must be an exact lowercase SHA-256 hex digest");
  }
  return value;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(field + " is required");
  const normalized = value.trim();
  if (!normalized) throw new Error(field + " is required");
  if (normalized.length > maxLength) throw new Error(field + " is too long");
  return normalized;
}
