import { DomainValidationError } from "./index";
import type { MarketingCapability, MarketingFormat } from "./skill-registry";

export type MarketingBenchmarkStage = "offline" | "shadow" | "live";
export type MarketingBenchmarkVerdict = "insufficient-evidence" | "keep-baseline" | "reject-challenger" | "advance-to-shadow" | "advance-to-live" | "qualified-for-brand";

export interface MarketingQualityScores {
  brandFit: number;
  hookQuality: number;
  originality: number;
  formatQuality: number;
  criticScore: number;
}

export interface MarketingBenchmarkObservation {
  caseId: string;
  inputFingerprint: string;
  workspaceId: string;
  brandId: string;
  capability: MarketingCapability;
  format: MarketingFormat;
  stage: MarketingBenchmarkStage;
  candidateSkillId: string;
  candidateSkillVersion: string;
  truthPassed: boolean;
  scores: MarketingQualityScores;
  humanPreferenceScore?: number;
  editDistancePercent?: number;
  latencyMs: number;
  costUsd: number;
  realWorldPerformance?: {
    normalizedScore: number;
    sampleSize: number;
  };
}

export interface MarketingBenchmarkPolicy {
  minPairedCases: number;
  minQualityDelta: number;
  maxCostRatio: number;
  maxLatencyRatio: number;
  minHumanPreferenceDelta: number;
  maxEditDistanceRegression: number;
  minLiveSampleSize: number;
  minRealWorldPerformanceDelta: number;
}

export interface MarketingBenchmarkResult {
  verdict: MarketingBenchmarkVerdict;
  reasons: string[];
  stage?: MarketingBenchmarkStage;
  workspaceId?: string;
  brandId?: string;
  capability?: MarketingCapability;
  format?: MarketingFormat;
  baselineSkillId: string;
  baselineSkillVersion: string;
  challengerSkillId: string;
  challengerSkillVersion: string;
  pairedCaseCount: number;
  baselineQuality?: number;
  challengerQuality?: number;
  qualityDelta: number;
  costRatio?: number;
  latencyRatio?: number;
  humanPreferenceDelta?: number;
  editDistanceDelta?: number;
  realWorldPerformanceDelta?: number;
}

export const DEFAULT_MARKETING_BENCHMARK_POLICY: MarketingBenchmarkPolicy = Object.freeze({
  minPairedCases: 4,
  minQualityDelta: 5,
  maxCostRatio: 2,
  maxLatencyRatio: 2,
  minHumanPreferenceDelta: 5,
  maxEditDistanceRegression: 0,
  minLiveSampleSize: 10,
  minRealWorldPerformanceDelta: 5,
});

export function compareMarketingBenchmark(input: {
  baselineSkillId: string;
  baselineSkillVersion: string;
  challengerSkillId: string;
  challengerSkillVersion: string;
  observations: readonly MarketingBenchmarkObservation[];
  policy?: MarketingBenchmarkPolicy;
}): MarketingBenchmarkResult {
  const baselineSkillId = text(input.baselineSkillId, "baselineSkillId");
  const baselineSkillVersion = text(input.baselineSkillVersion, "baselineSkillVersion");
  const challengerSkillId = text(input.challengerSkillId, "challengerSkillId");
  const challengerSkillVersion = text(input.challengerSkillVersion, "challengerSkillVersion");
  if (baselineSkillId === challengerSkillId && baselineSkillVersion === challengerSkillVersion) throw new DomainValidationError("Benchmark requires different baseline and challenger skill versions");
  const policy = validatePolicy(input.policy ?? DEFAULT_MARKETING_BENCHMARK_POLICY);
  const observations = input.observations.map(validateObservation);
  const baseResult = { baselineSkillId, baselineSkillVersion, challengerSkillId, challengerSkillVersion, pairedCaseCount: 0, qualityDelta: 0 };
  if (observations.length === 0) return result("insufficient-evidence", ["no-observations"], baseResult);

  const relevant = observations.filter((item) =>
    (item.candidateSkillId === baselineSkillId && item.candidateSkillVersion === baselineSkillVersion) ||
    (item.candidateSkillId === challengerSkillId && item.candidateSkillVersion === challengerSkillVersion));
  if (relevant.length === 0) return result("insufficient-evidence", ["no-candidate-observations"], baseResult);

  const scopes = new Set(relevant.map(scopeKey));
  const stages = new Set(relevant.map((item) => item.stage));
  if (scopes.size !== 1 || stages.size !== 1) return result("insufficient-evidence", ["mixed-benchmark-scope"], baseResult);

  const stage = relevant[0]!.stage;
  const workspaceId = relevant[0]!.workspaceId;
  const brandId = relevant[0]!.brandId;
  const capability = relevant[0]!.capability;
  const format = relevant[0]!.format;
  const pairs = pairObservations(relevant, baselineSkillId, baselineSkillVersion, challengerSkillId, challengerSkillVersion);
  const pairedCaseCount = pairs.length;
  const scoped = { ...baseResult, stage, workspaceId, brandId, capability, format, pairedCaseCount };

  if (pairedCaseCount < policy.minPairedCases) return result("insufficient-evidence", ["insufficient-paired-cases"], scoped);
  if (pairs.some((pair) => !pair.baseline.truthPassed)) return result("insufficient-evidence", ["baseline-truth-failure"], scoped);
  if (pairs.some((pair) => !pair.challenger.truthPassed)) return result("reject-challenger", ["challenger-truth-failure"], scoped);

  const baselineQuality = mean(pairs.map((pair) => quality(pair.baseline.scores)));
  const challengerQuality = mean(pairs.map((pair) => quality(pair.challenger.scores)));
  const qualityDelta = challengerQuality - baselineQuality;
  const baselineCost = mean(pairs.map((pair) => pair.baseline.costUsd));
  const challengerCost = mean(pairs.map((pair) => pair.challenger.costUsd));
  const baselineLatency = mean(pairs.map((pair) => pair.baseline.latencyMs));
  const challengerLatency = mean(pairs.map((pair) => pair.challenger.latencyMs));
  const costRatio = ratio(challengerCost, baselineCost);
  const latencyRatio = ratio(challengerLatency, baselineLatency);
  const measured = { ...scoped, baselineQuality, challengerQuality, qualityDelta, costRatio, latencyRatio };

  const guardReasons: string[] = [];
  if (qualityDelta < policy.minQualityDelta) guardReasons.push("quality-improvement-not-material");
  if (costRatio > policy.maxCostRatio) guardReasons.push("cost-regression");
  if (latencyRatio > policy.maxLatencyRatio) guardReasons.push("latency-regression");
  if (guardReasons.length) return result("keep-baseline", guardReasons, measured);

  if (stage === "offline") return result("advance-to-shadow", ["offline-thresholds-passed"], measured);

  const humanReady = pairs.every((pair) =>
    hasNumber(pair.baseline.humanPreferenceScore) &&
    hasNumber(pair.challenger.humanPreferenceScore) &&
    hasNumber(pair.baseline.editDistancePercent) &&
    hasNumber(pair.challenger.editDistancePercent));
  if (!humanReady) return result("insufficient-evidence", ["human-evidence-required"], measured);
  const baselineHuman = mean(pairs.map((pair) => pair.baseline.humanPreferenceScore!));
  const challengerHuman = mean(pairs.map((pair) => pair.challenger.humanPreferenceScore!));
  const humanPreferenceDelta = challengerHuman - baselineHuman;
  const baselineEdit = mean(pairs.map((pair) => pair.baseline.editDistancePercent!));
  const challengerEdit = mean(pairs.map((pair) => pair.challenger.editDistancePercent!));
  const editDistanceDelta = challengerEdit - baselineEdit;
  const humanMeasured = { ...measured, humanPreferenceDelta, editDistanceDelta };
  const humanReasons: string[] = [];
  if (humanPreferenceDelta < policy.minHumanPreferenceDelta) humanReasons.push("human-preference-not-improved");
  if (editDistanceDelta > policy.maxEditDistanceRegression) humanReasons.push("edit-distance-regression");
  if (humanReasons.length) return result("keep-baseline", humanReasons, humanMeasured);

  if (stage === "shadow") return result("advance-to-live", ["shadow-thresholds-passed"], humanMeasured);

  const liveReady = pairs.every((pair) =>
    pair.baseline.realWorldPerformance &&
    pair.challenger.realWorldPerformance &&
    pair.baseline.realWorldPerformance.sampleSize >= policy.minLiveSampleSize &&
    pair.challenger.realWorldPerformance.sampleSize >= policy.minLiveSampleSize);
  if (!liveReady) return result("insufficient-evidence", ["comparable-live-samples-required"], humanMeasured);
  const baselinePerformance = mean(pairs.map((pair) => pair.baseline.realWorldPerformance!.normalizedScore));
  const challengerPerformance = mean(pairs.map((pair) => pair.challenger.realWorldPerformance!.normalizedScore));
  const realWorldPerformanceDelta = challengerPerformance - baselinePerformance;
  const liveMeasured = { ...humanMeasured, realWorldPerformanceDelta };
  if (realWorldPerformanceDelta < policy.minRealWorldPerformanceDelta) return result("keep-baseline", ["real-world-improvement-not-material"], liveMeasured);
  return result("qualified-for-brand", ["live-thresholds-passed", "correlation-evidence-only"], liveMeasured);
}

function validateObservation(value: MarketingBenchmarkObservation): MarketingBenchmarkObservation {
  if (!value || typeof value !== "object") throw new DomainValidationError("Benchmark observation is required");
  const scores = value.scores;
  if (!scores || typeof scores !== "object") throw new DomainValidationError("Benchmark scores are required");
  for (const [key, score] of Object.entries(scores)) boundedScore(score, `scores.${key}`);
  if (typeof value.truthPassed !== "boolean") throw new DomainValidationError("truthPassed must be boolean");
  nonNegative(value.latencyMs, "latencyMs");
  nonNegative(value.costUsd, "costUsd");
  if (value.humanPreferenceScore !== undefined) boundedScore(value.humanPreferenceScore, "humanPreferenceScore");
  if (value.editDistancePercent !== undefined) boundedScore(value.editDistancePercent, "editDistancePercent");
  if (value.realWorldPerformance) {
    boundedScore(value.realWorldPerformance.normalizedScore, "realWorldPerformance.normalizedScore");
    if (!Number.isInteger(value.realWorldPerformance.sampleSize) || value.realWorldPerformance.sampleSize < 1) throw new DomainValidationError("realWorldPerformance.sampleSize must be a positive integer");
  }
  return {
    ...value,
    caseId: text(value.caseId, "caseId"),
    inputFingerprint: text(value.inputFingerprint, "inputFingerprint"),
    workspaceId: text(value.workspaceId, "workspaceId"),
    brandId: text(value.brandId, "brandId"),
    candidateSkillId: text(value.candidateSkillId, "candidateSkillId"),
    candidateSkillVersion: text(value.candidateSkillVersion, "candidateSkillVersion"),
  };
}

function validatePolicy(value: MarketingBenchmarkPolicy): MarketingBenchmarkPolicy {
  if (!Number.isInteger(value.minPairedCases) || value.minPairedCases < 1) throw new DomainValidationError("minPairedCases must be positive");
  for (const [key, number] of Object.entries(value)) if (key !== "minPairedCases" && (!Number.isFinite(number) || number < 0)) throw new DomainValidationError(`${key} must be non-negative`);
  return { ...value };
}

function pairObservations(
  observations: readonly MarketingBenchmarkObservation[],
  baselineSkillId: string,
  baselineSkillVersion: string,
  challengerSkillId: string,
  challengerSkillVersion: string,
): Array<{ baseline: MarketingBenchmarkObservation; challenger: MarketingBenchmarkObservation }> {
  const byCase = new Map<string, MarketingBenchmarkObservation[]>();
  for (const item of observations) byCase.set(item.caseId, [...(byCase.get(item.caseId) ?? []), item]);
  const pairs: Array<{ baseline: MarketingBenchmarkObservation; challenger: MarketingBenchmarkObservation }> = [];
  for (const items of byCase.values()) {
    const baselines = items.filter((item) => item.candidateSkillId === baselineSkillId && item.candidateSkillVersion === baselineSkillVersion);
    const challengers = items.filter((item) => item.candidateSkillId === challengerSkillId && item.candidateSkillVersion === challengerSkillVersion);
    if (baselines.length === 1 && challengers.length === 1 && baselines[0]!.inputFingerprint === challengers[0]!.inputFingerprint) {
      pairs.push({ baseline: baselines[0]!, challenger: challengers[0]! });
    }
  }
  return pairs;
}
function scopeKey(item: MarketingBenchmarkObservation): string { return [item.workspaceId, item.brandId, item.capability, item.format].join("|"); }
function quality(scores: MarketingQualityScores): number { return mean([scores.brandFit, scores.hookQuality, scores.originality, scores.formatQuality, scores.criticScore]); }
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function ratio(challenger: number, baseline: number): number { return baseline === 0 ? (challenger === 0 ? 1 : Number.POSITIVE_INFINITY) : challenger / baseline; }
function boundedScore(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new DomainValidationError(`${field} must be between 0 and 100`); return value; }
function nonNegative(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new DomainValidationError(`${field} must be non-negative`); return value; }
function hasNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function text(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`); return value.trim(); }
function result(verdict: MarketingBenchmarkVerdict, reasons: string[], fields: Omit<MarketingBenchmarkResult, "verdict" | "reasons">): MarketingBenchmarkResult { return { verdict, reasons, ...fields }; }
