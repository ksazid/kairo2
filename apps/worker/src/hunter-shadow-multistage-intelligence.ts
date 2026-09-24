import type { BrandDiscoveryPlan, BrandDiscoveryTopic } from "@kairo/domain/brand-discovery-plan";
import type { BrandPreferenceState, PreferenceWeight } from "@kairo/domain/brand-preference-state";
import {
  prepareHunterDeepAnalysisResult,
  scoreHunterPreRank,
  type HunterDeepAnalysisPort,
  type HunterDeepAnalysisResult,
  type HunterPreRankScore,
  type HunterPreRankUnknownFeature,
} from "@kairo/domain/hunter-multistage";
import type { ShadowTrendCluster } from "./hunter-shadow-trend-intelligence";

export interface ShadowPreRankedTrend {
  candidateId: string;
  cluster: ShadowTrendCluster;
  topicFit: number;
  matchedTopicId?: string;
  audience?: string;
  sourceClasses: string[];
  explorationEligible: boolean;
  preRank: HunterPreRankScore;
}

export interface ShadowDeepIntelligenceItem {
  candidateId: string;
  preRank: HunterPreRankScore;
  analysis: HunterDeepAnalysisResult;
}

export interface ShadowMultiStageDiagnostics {
  inputClusterCount: number;
  boundedInputClusterCount: number;
  preRankSelectedCount: number;
  deepRequestedCount: number;
  deepSucceededCount: number;
  deepFailedCount: number;
  deepSkippedCount: number;
  preRankMin: number;
  preRankMedian: number;
  preRankMax: number;
  unknownFeatureRates: Record<HunterPreRankUnknownFeature, number>;
}

export interface RunShadowMultiStageOptions {
  maxInputClusters?: number;
  preRankLimit?: number;
  deepLimit?: number;
  deepAnalysisConcurrency?: number;
  brandSemanticSimilarityByCandidateId?: Readonly<Record<string, number>>;
  duplicationPenaltyByCandidateId?: Readonly<Record<string, number>>;
  hardNegativeSimilarityByCandidateId?: Readonly<Record<string, number>>;
}

export async function runShadowMultiStageIntelligence(input: {
  clusters: readonly ShadowTrendCluster[];
  plan: BrandDiscoveryPlan;
  preferenceState?: BrandPreferenceState;
  deepAnalysis?: HunterDeepAnalysisPort;
  options?: RunShadowMultiStageOptions;
}): Promise<{
  preRanked: ShadowPreRankedTrend[];
  deepIntelligence: ShadowDeepIntelligenceItem[];
  diagnostics: ShadowMultiStageDiagnostics;
}> {
  if (input.plan.brandId.trim() === "") throw new Error("Discovery plan Brand is required");
  if (input.preferenceState && (
    input.preferenceState.brandId !== input.plan.brandId ||
    input.preferenceState.workspaceId !== input.plan.workspaceId
  )) {
    throw new Error("Brand Preference State must belong to the same workspace and Brand");
  }

  const options = input.options ?? {};
  const maxInputClusters = boundedInteger(options.maxInputClusters ?? 200, "maxInputClusters", 1, 500);
  const preRankLimit = boundedInteger(options.preRankLimit ?? 40, "preRankLimit", 1, 60);
  const deepLimit = boundedInteger(options.deepLimit ?? 12, "deepLimit", 0, 20);
  if (deepLimit > preRankLimit) throw new Error("deepLimit cannot exceed preRankLimit");

  const boundedClusters = input.clusters.slice(0, maxInputClusters);
  const allPreRanked = boundedClusters.map((cluster) => {
    const topicMatch = bestTopicMatch(cluster.intelligence.topic, input.plan.topics);
    const candidateId = cluster.intelligence.trendId;
    const explorationEligible =
      cluster.generatorKeys.includes("adjacent-exploration") &&
      cluster.generatorKeys.every(
        (generator) =>
          generator === "adjacent-exploration" ||
          generator === "cross-source-confirmation",
      );
    const topicFit = explorationEligible
      ? Math.min(topicMatch?.fit ?? 0, 0.25)
      : topicMatch?.fit ?? 0;
    const preferenceAffinity = preferenceAffinityFor(
      cluster.intelligence.topic,
      topicMatch?.topic,
      input.preferenceState,
    );
    const trendMomentum = momentumScore(cluster);
    const sourceDiversity = clamp01(
      (cluster.intelligence.crossSourceSpread * 0.6) +
      (cluster.intelligence.crossPlatformSpread * 0.4),
    );

    const preRank = scoreHunterPreRank(candidateId, {
      ...(lookupOptionalScore(options.brandSemanticSimilarityByCandidateId, candidateId) !== undefined
        ? { brandSemanticSimilarity: lookupOptionalScore(options.brandSemanticSimilarityByCandidateId, candidateId)! }
        : {}),
      topicFit,
      evidenceStrength: cluster.intelligence.evidenceConfidence,
      freshness: cluster.intelligence.freshness,
      trendMomentum,
      sourceDiversity,
      ...(preferenceAffinity !== undefined ? { preferenceAffinity } : {}),
      saturationPenalty: cluster.intelligence.saturation,
      ...(lookupOptionalScore(options.duplicationPenaltyByCandidateId, candidateId) !== undefined
        ? { duplicationPenalty: lookupOptionalScore(options.duplicationPenaltyByCandidateId, candidateId)! }
        : {}),
      ...(lookupOptionalScore(options.hardNegativeSimilarityByCandidateId, candidateId) !== undefined
        ? { hardNegativeSimilarity: lookupOptionalScore(options.hardNegativeSimilarityByCandidateId, candidateId)! }
        : {}),
    });

    return {
      candidateId,
      cluster,
      topicFit,
      ...(topicMatch ? { matchedTopicId: topicMatch.topic.id, audience: topicMatch.topic.audience } : {}),
      sourceClasses: topicMatch ? [...topicMatch.topic.sourceClasses] : [],
      explorationEligible,
      preRank,
    } satisfies ShadowPreRankedTrend;
  });

  const preRanked = allPreRanked
    .sort((a, b) =>
      b.preRank.overall - a.preRank.overall ||
      b.cluster.intelligence.evidenceConfidence - a.cluster.intelligence.evidenceConfidence ||
      a.candidateId.localeCompare(b.candidateId),
    )
    .slice(0, preRankLimit);

  const deepCandidates = preRanked.slice(0, deepLimit);
  const deepAnalysisConcurrency = boundedInteger(
    options.deepAnalysisConcurrency ?? Math.max(1, deepCandidates.length || 1),
    "deepAnalysisConcurrency",
    1,
    20,
  );
  const deepIntelligence: ShadowDeepIntelligenceItem[] = [];
  let deepFailedCount = 0;

  if (input.deepAnalysis) {
    const outcomes = await mapWithConcurrency(
      deepCandidates,
      Math.min(deepAnalysisConcurrency, Math.max(1, deepCandidates.length)),
      async (item) => {
        try {
          const raw = await input.deepAnalysis!.analyze({
            candidateId: item.candidateId,
            topic: item.cluster.intelligence.topic,
            stage: item.cluster.intelligence.stage,
            ...(item.audience ? { audience: item.audience } : {}),
            evidenceSummary: evidenceSummary(item.cluster),
            supportingSignalIds: [...item.cluster.intelligence.supportingSignalIds],
            sourceClasses: [...item.sourceClasses],
            preRankScore: item.preRank.overall,
          });
          const analysis = prepareHunterDeepAnalysisResult(raw);
          if (analysis.candidateId !== item.candidateId) {
            throw new Error("Deep analysis candidateId must match request");
          }
          return {
            ok: true as const,
            item: { candidateId: item.candidateId, preRank: item.preRank, analysis },
          };
        } catch {
          return { ok: false as const };
        }
      },
    );
    for (const outcome of outcomes) {
      if (outcome.ok) deepIntelligence.push(outcome.item);
      else deepFailedCount += 1;
    }
  }

  const overallScores = preRanked.map((item) => item.preRank.overall);
  const unknownCounts: Record<HunterPreRankUnknownFeature, number> = {
    brandSemanticSimilarity: 0,
    preferenceAffinity: 0,
    duplicationPenalty: 0,
    hardNegativeSimilarity: 0,
  };
  for (const item of preRanked) {
    for (const feature of item.preRank.unknownFeatures) unknownCounts[feature] += 1;
  }

  return {
    preRanked,
    deepIntelligence,
    diagnostics: {
      inputClusterCount: input.clusters.length,
      boundedInputClusterCount: boundedClusters.length,
      preRankSelectedCount: preRanked.length,
      deepRequestedCount: input.deepAnalysis ? deepCandidates.length : 0,
      deepSucceededCount: deepIntelligence.length,
      deepFailedCount,
      deepSkippedCount: input.deepAnalysis ? Math.max(0, preRanked.length - deepCandidates.length) : preRanked.length,
      preRankMin: overallScores.length ? Math.min(...overallScores) : 0,
      preRankMedian: median(overallScores) ?? 0,
      preRankMax: overallScores.length ? Math.max(...overallScores) : 0,
      unknownFeatureRates: {
        brandSemanticSimilarity: rate(unknownCounts.brandSemanticSimilarity, preRanked.length),
        preferenceAffinity: rate(unknownCounts.preferenceAffinity, preRanked.length),
        duplicationPenalty: rate(unknownCounts.duplicationPenalty, preRanked.length),
        hardNegativeSimilarity: rate(unknownCounts.hardNegativeSimilarity, preRanked.length),
      },
    },
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (!items.length) return [];
  const output = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        output[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return output;
}

function bestTopicMatch(value: string, topics: readonly BrandDiscoveryTopic[]): { topic: BrandDiscoveryTopic; fit: number } | undefined {
  let best: { topic: BrandDiscoveryTopic; fit: number } | undefined;
  for (const topic of topics) {
    const overlap = Math.max(
      tokenSimilarity(value, topic.name),
      ...topic.entities.map((entity) => tokenSimilarity(value, entity)),
      value.trim().toLowerCase() === topic.id.trim().toLowerCase() ? 1 : 0,
    );
    const priority = topic.priority === "High" ? 1 : 0.78;
    const fit = clamp01(overlap * priority);
    if (!best || fit > best.fit || (fit === best.fit && topic.id.localeCompare(best.topic.id) < 0)) {
      best = { topic, fit };
    }
  }
  return best && best.fit > 0 ? best : undefined;
}

function preferenceAffinityFor(
  trendTopic: string,
  matchedTopic: BrandDiscoveryTopic | undefined,
  state: BrandPreferenceState | undefined,
): number | undefined {
  if (!state) return undefined;
  const keys = [
    trendTopic,
    matchedTopic?.name ?? "",
    ...(matchedTopic?.entities ?? []),
  ].filter(Boolean);

  const candidates: number[] = [];
  collectPreferenceMatches(candidates, keys, state.longTerm.topicWeights, 1);
  collectPreferenceMatches(candidates, keys, state.shortTerm.activeTopics, 1);
  collectPreferenceMatches(candidates, matchedTopic ? [matchedTopic.audience] : [], state.longTerm.audienceWeights, 0.85);

  return candidates.length ? Math.max(...candidates) : undefined;
}

function collectPreferenceMatches(
  output: number[],
  keys: readonly string[],
  weights: readonly PreferenceWeight[],
  multiplier: number,
): void {
  for (const preference of weights) {
    const similarity = Math.max(0, ...keys.map((key) => tokenSimilarity(preference.key, key)));
    if (similarity <= 0) continue;
    output.push(clamp01(preference.weight * similarity * multiplier));
  }
}

function momentumScore(cluster: ShadowTrendCluster): number {
  const stageBase: Record<string, number> = {
    emerging: 0.58,
    rising: 0.75,
    accelerating: 1,
    mature: 0.48,
    saturated: 0.28,
    declining: 0.12,
    evergreen: 0.52,
  };
  const stage = stageBase[cluster.intelligence.stage] ?? 0;
  const knownVelocity = cluster.features.unknownFeatures.includes("velocity") ? undefined : cluster.intelligence.velocity;
  const knownAcceleration = cluster.features.unknownFeatures.includes("acceleration") ? undefined : cluster.intelligence.acceleration;
  const values: Array<[number | undefined, number]> = [
    [stage, 0.45],
    [knownVelocity, 0.25],
    [knownAcceleration, 0.30],
  ];
  let numerator = 0;
  let denominator = 0;
  for (const [value, weight] of values) {
    if (value === undefined) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator ? clamp01(numerator / denominator) : 0;
}

function evidenceSummary(cluster: ShadowTrendCluster): string {
  const unknown = cluster.features.unknownFeatures.length
    ? " Unknown metrics: " + cluster.features.unknownFeatures.join(", ") + "."
    : "";
  return [
    cluster.features.signalCount + " supporting signals",
    cluster.features.independentPublisherCount + " independent publishers",
    cluster.features.uniqueSourceCount + " source groups",
    cluster.features.uniquePlatformCount + " platforms",
    "evidence confidence " + cluster.intelligence.evidenceConfidence.toFixed(3),
    "freshness " + cluster.intelligence.freshness.toFixed(3),
  ].join("; ") + "." + unknown;
}

function lookupOptionalScore(values: Readonly<Record<string, number>> | undefined, key: string): number | undefined {
  const value = values?.[key];
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Optional score for " + key + " must be from 0 to 1");
  return value;
}

function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1) ?? []);
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function rate(count: number, total: number): number {
  return total ? count / total : 0;
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
