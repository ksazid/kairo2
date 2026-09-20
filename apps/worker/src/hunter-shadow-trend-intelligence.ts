import { prepareTrendIntelligence, type TrendIntelligence, type TrendStage } from "@kairo/domain/trend-intelligence";
import type { ShadowRetrievalCandidate } from "./hunter-shadow-retrieval";

export const HUNTER_TREND_FEATURE_VERSION = "hunter-trend-v1" as const;

export type UnknownTrendFeature =
  | "velocity"
  | "acceleration"
  | "creatorOutlier"
  | "categoryOutlier";

export interface TrendSignalMetrics {
  engagement?: number;
  recentEngagement?: number;
  earlierEngagement?: number;
  creatorBaseline?: number;
  categoryBaseline?: number;
}

export interface TrendSignalObservation {
  signalId: string;
  title: string;
  summary?: string;
  sourceUrl: string;
  platform: string;
  provider: string;
  publisher?: string;
  publishedAt?: string;
  topicIds: string[];
  generatorKeys: string[];
  corroboratingSignalIds: string[];
  metrics?: TrendSignalMetrics;
}

export interface TrendPairSimilarityPort {
  similarity(
    left: Pick<TrendSignalObservation, "signalId" | "title" | "summary">,
    right: Pick<TrendSignalObservation, "signalId" | "title" | "summary">,
  ): Promise<number>;
}

export interface ShadowTrendFeatureDetails {
  featureVersion: typeof HUNTER_TREND_FEATURE_VERSION;
  signalCount: number;
  independentPublisherCount: number;
  uniqueSourceCount: number;
  uniquePlatformCount: number;
  corroboratedSignalCount: number;
  observationSpanDays: number;
  rawVelocity?: number;
  rawAccelerationRatio?: number;
  rawCreatorOutlierRatio?: number;
  rawCategoryOutlierRatio?: number;
  unknownFeatures: UnknownTrendFeature[];
}

export interface ShadowTrendCluster {
  intelligence: TrendIntelligence;
  features: ShadowTrendFeatureDetails;
  sourceKeys: string[];
  platformKeys: string[];
  publisherKeys: string[];
  generatorKeys: string[];
}

export interface ShadowTrendDiagnostics {
  inputSignalCount: number;
  clusterCount: number;
  singleSignalClusterCount: number;
  corroboratedClusterCount: number;
  multiSourceClusterCount: number;
  multiPlatformClusterCount: number;
  semanticComparisonCount: number;
  lexicalMergeCount: number;
  semanticMergeCount: number;
  stageDistribution: Record<TrendStage, number>;
  unknownFeatureRates: Record<UnknownTrendFeature, number>;
}

export interface RunShadowTrendIntelligenceOptions {
  now?: Date;
  maxSignals?: number;
  lexicalSimilarityThreshold?: number;
  semanticSimilarityThreshold?: number;
  maxSemanticComparisons?: number;
  topicLabels?: Readonly<Record<string, string>>;
  metricsBySignalId?: Readonly<Record<string, TrendSignalMetrics>>;
  semanticSimilarity?: TrendPairSimilarityPort;
}

export async function runShadowTrendIntelligence(
  candidates: readonly ShadowRetrievalCandidate[],
  options: RunShadowTrendIntelligenceOptions = {},
): Promise<{ clusters: ShadowTrendCluster[]; diagnostics: ShadowTrendDiagnostics }> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("now must be a valid Date");

  const maxSignals = boundedInteger(options.maxSignals ?? 120, "maxSignals", 1, 250);
  const lexicalThreshold = boundedScore(options.lexicalSimilarityThreshold ?? 0.5, "lexicalSimilarityThreshold");
  const semanticThreshold = boundedScore(options.semanticSimilarityThreshold ?? 0.82, "semanticSimilarityThreshold");
  const maxSemanticComparisons = boundedInteger(options.maxSemanticComparisons ?? 120, "maxSemanticComparisons", 0, 500);

  const observations = candidates.slice(0, maxSignals).map((candidate) =>
    toObservation(candidate, options.metricsBySignalId?.[candidate.key]),
  );
  const parent = observations.map((_, index) => index);
  let semanticComparisonCount = 0;
  let lexicalMergeCount = 0;
  let semanticMergeCount = 0;

  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };

  const union = (left: number, right: number): boolean => {
    const a = find(left);
    const b = find(right);
    if (a === b) return false;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    parent[high] = low;
    return true;
  };

  for (let left = 0; left < observations.length; left += 1) {
    for (let right = left + 1; right < observations.length; right += 1) {
      const a = observations[left]!;
      const b = observations[right]!;
      if (a.corroboratingSignalIds.includes(b.signalId) || b.corroboratingSignalIds.includes(a.signalId)) {
        if (union(left, right)) lexicalMergeCount += 1;
        continue;
      }

      const lexical = jaccard(tokens(signalText(a)), tokens(signalText(b)));
      if (lexical >= lexicalThreshold) {
        if (union(left, right)) lexicalMergeCount += 1;
        continue;
      }

      if (
        options.semanticSimilarity &&
        semanticComparisonCount < maxSemanticComparisons &&
        lexical >= Math.max(0.18, lexicalThreshold * 0.45)
      ) {
        semanticComparisonCount += 1;
        let semantic = -1;
        try {
          semantic = await options.semanticSimilarity.similarity(a, b);
        } catch {
          semantic = -1;
        }
        if (Number.isFinite(semantic) && semantic >= semanticThreshold && semantic <= 1) {
          if (union(left, right)) semanticMergeCount += 1;
        }
      }
    }
  }

  const groups = new Map<number, TrendSignalObservation[]>();
  observations.forEach((observation, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(observation);
    groups.set(root, list);
  });

  const clusters = [...groups.values()]
    .map((signals) => buildCluster(signals, now, options.topicLabels))
    .sort((a, b) =>
      b.intelligence.evidenceConfidence - a.intelligence.evidenceConfidence ||
      b.features.signalCount - a.features.signalCount ||
      a.intelligence.trendId.localeCompare(b.intelligence.trendId),
    );

  const stageDistribution = emptyStageDistribution();
  const unknownCounts: Record<UnknownTrendFeature, number> = {
    velocity: 0,
    acceleration: 0,
    creatorOutlier: 0,
    categoryOutlier: 0,
  };

  for (const cluster of clusters) {
    stageDistribution[cluster.intelligence.stage] += 1;
    for (const feature of cluster.features.unknownFeatures) unknownCounts[feature] += 1;
  }

  const clusterCount = clusters.length;
  return {
    clusters,
    diagnostics: {
      inputSignalCount: observations.length,
      clusterCount,
      singleSignalClusterCount: clusters.filter((cluster) => cluster.features.signalCount === 1).length,
      corroboratedClusterCount: clusters.filter((cluster) => cluster.features.corroboratedSignalCount > 0).length,
      multiSourceClusterCount: clusters.filter((cluster) => cluster.features.uniqueSourceCount > 1).length,
      multiPlatformClusterCount: clusters.filter((cluster) => cluster.features.uniquePlatformCount > 1).length,
      semanticComparisonCount,
      lexicalMergeCount,
      semanticMergeCount,
      stageDistribution,
      unknownFeatureRates: {
        velocity: rate(unknownCounts.velocity, clusterCount),
        acceleration: rate(unknownCounts.acceleration, clusterCount),
        creatorOutlier: rate(unknownCounts.creatorOutlier, clusterCount),
        categoryOutlier: rate(unknownCounts.categoryOutlier, clusterCount),
      },
    },
  };
}

function buildCluster(
  signals: readonly TrendSignalObservation[],
  now: Date,
  topicLabels: Readonly<Record<string, string>> | undefined,
): ShadowTrendCluster {
  const sorted = [...signals].sort((a, b) => a.signalId.localeCompare(b.signalId));
  const supportingSignalIds = sorted.map((signal) => signal.signalId);
  const sourceKeys = unique(sorted.map(sourceIdentity));
  const platformKeys = unique(sorted.map((signal) => normalizeKey(signal.platform || signal.provider)));
  const publisherKeys = unique(sorted.map(publisherIdentity));
  const generatorKeys = unique(sorted.flatMap((signal) => signal.generatorKeys));
  const corroboratedSignalCount = sorted.filter((signal) => signal.corroboratingSignalIds.length > 0).length;

  const observedTimes = sorted
    .map((signal) => parseTimestamp(signal.publishedAt)?.getTime())
    .filter((value): value is number => value !== undefined);
  const firstMs = observedTimes.length ? Math.min(...observedTimes) : now.getTime();
  const lastMs = observedTimes.length ? Math.max(...observedTimes) : now.getTime();
  const newestAgeDays = Math.max(0, (now.getTime() - lastMs) / 86_400_000);
  const observationSpanDays = Math.max(0, (lastMs - firstMs) / 86_400_000);

  const freshness = clamp01(1 / (1 + newestAgeDays / 7));
  const crossSourceSpread = clamp01(sourceKeys.length / 3);
  const crossPlatformSpread = clamp01(platformKeys.length / 3);
  const saturation = clamp01(Math.log2(sorted.length + 1) / 3);

  const velocityValues: number[] = [];
  const accelerationRatios: number[] = [];
  const creatorRatios: number[] = [];
  const categoryRatios: number[] = [];

  for (const signal of sorted) {
    const metrics = signal.metrics;
    if (!metrics) continue;
    const ageHours = Math.max(1, (now.getTime() - (parseTimestamp(signal.publishedAt)?.getTime() ?? now.getTime())) / 3_600_000);
    if (validNonNegative(metrics.engagement)) velocityValues.push(metrics.engagement / ageHours);
    if (validPositive(metrics.earlierEngagement) && validNonNegative(metrics.recentEngagement)) {
      accelerationRatios.push(metrics.recentEngagement / metrics.earlierEngagement);
    }
    if (validPositive(metrics.creatorBaseline) && validNonNegative(metrics.engagement)) {
      creatorRatios.push(metrics.engagement / metrics.creatorBaseline);
    }
    if (validPositive(metrics.categoryBaseline) && validNonNegative(metrics.engagement)) {
      categoryRatios.push(metrics.engagement / metrics.categoryBaseline);
    }
  }

  const rawVelocity = median(velocityValues);
  const rawAccelerationRatio = median(accelerationRatios);
  const rawCreatorOutlierRatio = median(creatorRatios);
  const rawCategoryOutlierRatio = median(categoryRatios);

  const unknownFeatures: UnknownTrendFeature[] = [];
  if (rawVelocity === undefined) unknownFeatures.push("velocity");
  if (rawAccelerationRatio === undefined) unknownFeatures.push("acceleration");
  if (rawCreatorOutlierRatio === undefined) unknownFeatures.push("creatorOutlier");
  if (rawCategoryOutlierRatio === undefined) unknownFeatures.push("categoryOutlier");

  const velocity = rawVelocity === undefined ? 0 : positiveMagnitudeScore(rawVelocity);
  const acceleration = rawAccelerationRatio === undefined ? 0 : ratioScore(rawAccelerationRatio);
  const creatorOutlier = rawCreatorOutlierRatio === undefined ? 0 : ratioScore(rawCreatorOutlierRatio);
  const categoryOutlier = rawCategoryOutlierRatio === undefined ? 0 : ratioScore(rawCategoryOutlierRatio);

  const independentPublisherScore = clamp01(publisherKeys.length / 3);
  const corroborationScore = clamp01(corroboratedSignalCount / Math.max(1, sorted.length));
  const evidenceConfidence = clamp01(
    independentPublisherScore * 0.35 +
    crossSourceSpread * 0.25 +
    crossPlatformSpread * 0.15 +
    freshness * 0.15 +
    corroborationScore * 0.10,
  );

  const topicId = dominantTopicId(sorted);
  const topic = topicLabels?.[topicId] ?? topicId ?? sorted[0]?.title ?? "Untitled trend";
  const stage = classifyStage({
    signalCount: sorted.length,
    freshness,
    velocity: rawVelocity === undefined ? undefined : velocity,
    acceleration: rawAccelerationRatio === undefined ? undefined : acceleration,
    saturation,
    crossSourceSpread,
    observationSpanDays,
  });

  const trendId = stableTrendId(topicId || topic, supportingSignalIds);
  const intelligence = prepareTrendIntelligence({
    trendId,
    topic,
    stage,
    velocity,
    acceleration,
    crossSourceSpread,
    crossPlatformSpread,
    creatorOutlier,
    categoryOutlier,
    saturation,
    freshness,
    evidenceConfidence,
    firstObservedAt: new Date(firstMs).toISOString(),
    lastObservedAt: new Date(lastMs).toISOString(),
    supportingSignalIds,
  });

  return {
    intelligence,
    features: {
      featureVersion: HUNTER_TREND_FEATURE_VERSION,
      signalCount: sorted.length,
      independentPublisherCount: publisherKeys.length,
      uniqueSourceCount: sourceKeys.length,
      uniquePlatformCount: platformKeys.length,
      corroboratedSignalCount,
      observationSpanDays,
      ...(rawVelocity !== undefined ? { rawVelocity } : {}),
      ...(rawAccelerationRatio !== undefined ? { rawAccelerationRatio } : {}),
      ...(rawCreatorOutlierRatio !== undefined ? { rawCreatorOutlierRatio } : {}),
      ...(rawCategoryOutlierRatio !== undefined ? { rawCategoryOutlierRatio } : {}),
      unknownFeatures,
    },
    sourceKeys,
    platformKeys,
    publisherKeys,
    generatorKeys,
  };
}

function classifyStage(input: {
  signalCount: number;
  freshness: number;
  velocity?: number;
  acceleration?: number;
  saturation: number;
  crossSourceSpread: number;
  observationSpanDays: number;
}): TrendStage {
  if (input.acceleration !== undefined && input.acceleration >= 0.67 && input.freshness >= 0.58) return "accelerating";
  if (input.saturation >= 0.82 && (input.acceleration === undefined || input.acceleration < 0.62)) return "saturated";
  if (input.freshness >= 0.62 && ((input.velocity ?? 0) >= 0.55 || input.crossSourceSpread >= 0.66)) return "rising";
  if (input.freshness >= 0.72 && input.signalCount <= 2) return "emerging";
  if (
    input.observationSpanDays >= 21 &&
    input.signalCount >= 3 &&
    input.freshness >= 0.28 &&
    input.freshness <= 0.72 &&
    (input.acceleration === undefined || (input.acceleration >= 0.42 && input.acceleration <= 0.58))
  ) return "evergreen";
  if (input.freshness < 0.28 && (input.velocity === undefined || input.velocity < 0.4)) return "declining";
  return "mature";
}

function toObservation(candidate: ShadowRetrievalCandidate, metrics?: TrendSignalMetrics): TrendSignalObservation {
  return {
    signalId: candidate.key,
    title: candidate.title,
    ...(candidate.summary ? { summary: candidate.summary } : {}),
    sourceUrl: candidate.sourceUrl,
    platform: candidate.platform,
    provider: candidate.provider,
    ...(candidate.publisher ? { publisher: candidate.publisher } : {}),
    ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
    topicIds: [...candidate.topicIds],
    generatorKeys: [...candidate.generatorKeys],
    corroboratingSignalIds: [...candidate.corroboratingKeys],
    ...(metrics ? { metrics: { ...metrics } } : {}),
  };
}

function dominantTopicId(signals: readonly TrendSignalObservation[]): string {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    for (const topicId of signal.topicIds) counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

function sourceIdentity(signal: TrendSignalObservation): string {
  return normalizeKey(signal.provider + ":" + signal.platform);
}

function publisherIdentity(signal: TrendSignalObservation): string {
  if (signal.publisher?.trim()) return normalizeKey(signal.publisher);
  try {
    return normalizeKey(new URL(signal.sourceUrl).hostname);
  } catch {
    return sourceIdentity(signal);
  }
}

function stableTrendId(topic: string, signalIds: readonly string[]): string {
  const base = (topic || "trend").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "trend";
  const suffix = hashString([...signalIds].sort().join("|"));
  return "trend:" + base + ":" + suffix;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function signalText(signal: Pick<TrendSignalObservation, "title" | "summary">): string {
  return signal.title + " " + (signal.summary ?? "");
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function parseTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function positiveMagnitudeScore(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  const transformed = Math.log1p(value);
  return clamp01(transformed / (transformed + 4));
}

function ratioScore(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return clamp01(value / (value + 1));
}

function validNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase() || "unknown";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function rate(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(field + " must be an integer from " + min + " to " + max);
  }
  return value as number;
}

function boundedScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(field + " must be a number from 0 to 1");
  }
  return value;
}

function emptyStageDistribution(): Record<TrendStage, number> {
  return {
    emerging: 0,
    rising: 0,
    accelerating: 0,
    mature: 0,
    saturated: 0,
    declining: 0,
    evergreen: 0,
  };
}
