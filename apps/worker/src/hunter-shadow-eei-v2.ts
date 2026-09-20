import {
  evaluateManipulationRisk,
  prepareEEIPolicy,
  prepareRecommendationExplanation,
  type ManipulationRiskInput,
  type RecommendationExplanation,
} from "@kairo/domain/eei";
import type {
  BrandPreferenceState,
  NegativePreference,
  PreferenceWeight,
} from "@kairo/domain/brand-preference-state";
import type {
  ShadowDeepIntelligenceItem,
  ShadowPreRankedTrend,
} from "./hunter-shadow-multistage-intelligence";

export const HUNTER_EEI_V2_SHADOW_VERSION = "hunter-eei-v2-shadow" as const;

export const HUNTER_EEI_V2_SHADOW_POLICY = prepareEEIPolicy({
  version: HUNTER_EEI_V2_SHADOW_VERSION,
  optimizationObjectives: [
    "save",
    "develop",
    "generate",
    "approve",
    "publish",
    "declared-relevance",
    "brand-relative-performance-lift",
    "successful-completion",
    "sustained-satisfaction",
  ],
  diversityFloor: 0.4,
  maximumTopicShare: 0.34,
  explorationMin: 0.08,
  explorationMax: 0.2,
  manipulationRiskBlockThreshold: 0.5,
});

export type ShadowEEIBucket = "core" | "adjacent" | "exploration";

export interface ShadowEEIRankedItem {
  candidateId: string;
  topic: string;
  bucket: ShadowEEIBucket;
  eeiScore: number;
  preferenceAffinity?: number;
  negativePreferencePenalty: number;
  saturationPenalty: number;
  manipulationRiskScore: number;
  sourceDiversity: number;
  explanation: RecommendationExplanation;
  preRanked: ShadowPreRankedTrend;
  deepIntelligence?: ShadowDeepIntelligenceItem;
}

export interface ShadowEEIDiagnostics {
  inputCount: number;
  eligibleCount: number;
  selectedCount: number;
  blockedManipulationCount: number;
  blockedNegativePreferenceCount: number;
  blockedSaturationCount: number;
  explorationBudget: number;
  explorationTargetCount: number;
  explorationSelectedCount: number;
  adjacentSelectedCount: number;
  coreSelectedCount: number;
  maximumObservedTopicShare: number;
  uniqueSelectedSourceCount: number;
}

export interface RunShadowEEIOptions {
  maxCandidates?: number;
  adjacentShare?: number;
  engagementRisksByCandidateId?: Readonly<Record<string, ManipulationRiskInput>>;
}

export function runShadowPreferenceAwareEEI(input: {
  preRanked: readonly ShadowPreRankedTrend[];
  deepIntelligence?: readonly ShadowDeepIntelligenceItem[];
  preferenceState?: BrandPreferenceState;
  options?: RunShadowEEIOptions;
}): { selected: ShadowEEIRankedItem[]; diagnostics: ShadowEEIDiagnostics } {
  const maxCandidates = boundedInteger(input.options?.maxCandidates ?? 10, "maxCandidates", 1, 12);
  const adjacentShare = boundedScore(input.options?.adjacentShare ?? 0.2, "adjacentShare");
  if (adjacentShare < 0.1 || adjacentShare > 0.3) {
    throw new Error("adjacentShare must be from 0.1 to 0.3");
  }

  const deepByCandidate = new Map(
    (input.deepIntelligence ?? []).map((item) => [item.candidateId, item] as const),
  );
  const explorationBudget = clamp(
    input.preferenceState?.explorationBudget ?? 0.1,
    HUNTER_EEI_V2_SHADOW_POLICY.explorationMin,
    HUNTER_EEI_V2_SHADOW_POLICY.explorationMax,
  );

  let blockedManipulationCount = 0;
  let blockedNegativePreferenceCount = 0;
  let blockedSaturationCount = 0;

  const eligible: ShadowEEIRankedItem[] = [];

  for (const preRanked of input.preRanked) {
    const candidateId = preRanked.candidateId;
    const deep = deepByCandidate.get(candidateId);
    const risk = evaluateManipulationRisk(
      input.options?.engagementRisksByCandidateId?.[candidateId] ?? {},
      HUNTER_EEI_V2_SHADOW_POLICY.manipulationRiskBlockThreshold,
    );
    if (risk.blocked) {
      blockedManipulationCount += 1;
      continue;
    }

    const preferenceAffinity = calculatePreferenceAffinity(preRanked, deep, input.preferenceState);
    const negativePenalty = calculateNegativePreferencePenalty(preRanked, deep, input.preferenceState);
    if (negativePenalty >= 0.8) {
      blockedNegativePreferenceCount += 1;
      continue;
    }

    const saturation = preRanked.cluster.intelligence.saturation;
    const novelty = clamp01(
      1 -
      saturation * 0.7 -
      (preRanked.preRank.features.duplicationPenalty ?? 0) * 0.3,
    );
    if (saturation >= 0.92 && novelty < 0.28) {
      blockedSaturationCount += 1;
      continue;
    }

    const sourceDiversity = clamp01(
      preRanked.cluster.intelligence.crossSourceSpread * 0.6 +
      preRanked.cluster.intelligence.crossPlatformSpread * 0.4,
    );
    const bucket = classifyBucket(
      preRanked.topicFit,
      preferenceAffinity,
      preRanked.explorationEligible,
    );
    const eeiScore = weightedKnown([
      [preRanked.preRank.overall, 0.5],
      [preRanked.cluster.intelligence.evidenceConfidence, 0.14],
      [preferenceAffinity, 0.14],
      [novelty, 0.08],
      [sourceDiversity, 0.07],
      [deep?.analysis.actionability, 0.07],
    ]) -
      saturation * 0.14 -
      negativePenalty * 0.28 -
      risk.score * 0.35;

    eligible.push({
      candidateId,
      topic: preRanked.cluster.intelligence.topic,
      bucket,
      eeiScore: clamp01(eeiScore),
      ...(preferenceAffinity !== undefined ? { preferenceAffinity } : {}),
      negativePreferencePenalty: negativePenalty,
      saturationPenalty: saturation,
      manipulationRiskScore: risk.score,
      sourceDiversity,
      explanation: buildExplanation(preRanked, deep, bucket, preferenceAffinity),
      preRanked,
      ...(deep ? { deepIntelligence: deep } : {}),
    });
  }

  eligible.sort(compareRankedItems);

  const explorationTargetCount = targetCount(maxCandidates, explorationBudget, true);
  const explorationMaxCount = Math.max(
    explorationTargetCount,
    Math.floor(maxCandidates * HUNTER_EEI_V2_SHADOW_POLICY.explorationMax),
  );
  const adjacentTargetCount = targetCount(maxCandidates, adjacentShare, false);
  const coreTargetCount = Math.max(0, maxCandidates - explorationTargetCount - adjacentTargetCount);

  const buckets: Record<ShadowEEIBucket, ShadowEEIRankedItem[]> = {
    core: eligible.filter((item) => item.bucket === "core"),
    adjacent: eligible.filter((item) => item.bucket === "adjacent"),
    exploration: eligible.filter((item) => item.bucket === "exploration"),
  };

  const selected: ShadowEEIRankedItem[] = [];
  const topicCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const selectedIds = new Set<string>();
  const topicLimit = Math.max(
    1,
    Math.floor(maxCandidates * HUNTER_EEI_V2_SHADOW_POLICY.maximumTopicShare),
  );

  const selectFrom = (pool: readonly ShadowEEIRankedItem[], target: number) => {
    let added = 0;
    while (added < target && selected.length < maxCandidates) {
      const selectedExplorationCount = selected.filter(
        (item) => item.bucket === "exploration",
      ).length;
      const eligiblePool = pool
        .filter((item) => !selectedIds.has(item.candidateId))
        .filter(
          (item) =>
            item.bucket !== "exploration" ||
            selectedExplorationCount < explorationMaxCount,
        )
        .filter((item) => (topicCounts.get(normalize(item.topic)) ?? 0) < topicLimit)
        .sort((left, right) => {
          if (left.bucket === "exploration" && right.bucket === "exploration") {
            const affinityDelta =
              (right.preferenceAffinity ?? 0) - (left.preferenceAffinity ?? 0);
            if (Math.abs(affinityDelta) > 1e-9) return affinityDelta;
          }
          const leftCount = sourceCounts.get(primarySourceKey(left)) ?? 0;
          const rightCount = sourceCounts.get(primarySourceKey(right)) ?? 0;
          return leftCount - rightCount || compareRankedItems(left, right);
        });
      const item = eligiblePool[0];
      if (!item) break;

      selected.push(item);
      selectedIds.add(item.candidateId);
      const topic = normalize(item.topic);
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      const source = primarySourceKey(item);
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      added += 1;
    }
  };

  selectFrom(buckets.core, coreTargetCount);
  selectFrom(buckets.adjacent, adjacentTargetCount);
  selectFrom(buckets.exploration, explorationTargetCount);

  if (selected.length < maxCandidates) {
    selectFrom(
      eligible.filter((item) => !selectedIds.has(item.candidateId)),
      maxCandidates - selected.length,
    );
  }

  enforceFinalTopicShare(selected, HUNTER_EEI_V2_SHADOW_POLICY.maximumTopicShare);

  const selectedTopicCounts = new Map<string, number>();
  for (const item of selected) {
    const topic = normalize(item.topic);
    selectedTopicCounts.set(topic, (selectedTopicCounts.get(topic) ?? 0) + 1);
  }
  const maximumObservedTopicShare = selected.length
    ? Math.max(...selectedTopicCounts.values()) / selected.length
    : 0;

  return {
    selected,
    diagnostics: {
      inputCount: input.preRanked.length,
      eligibleCount: eligible.length,
      selectedCount: selected.length,
      blockedManipulationCount,
      blockedNegativePreferenceCount,
      blockedSaturationCount,
      explorationBudget,
      explorationTargetCount,
      explorationSelectedCount: selected.filter((item) => item.bucket === "exploration").length,
      adjacentSelectedCount: selected.filter((item) => item.bucket === "adjacent").length,
      coreSelectedCount: selected.filter((item) => item.bucket === "core").length,
      maximumObservedTopicShare,
      uniqueSelectedSourceCount: new Set(selected.map(primarySourceKey)).size,
    },
  };
}

function calculatePreferenceAffinity(
  item: ShadowPreRankedTrend,
  deep: ShadowDeepIntelligenceItem | undefined,
  state: BrandPreferenceState | undefined,
): number | undefined {
  if (!state) return undefined;
  const topicKeys = [item.cluster.intelligence.topic];
  const audienceKeys = item.audience ? [item.audience] : [];
  const mechanismKeys = mechanismTerms(deep);

  const values: number[] = [];
  collectPositive(values, topicKeys, state.longTerm.topicWeights, 1);
  collectPositive(values, topicKeys, state.shortTerm.activeTopics, 0.9);
  collectPositive(values, audienceKeys, state.longTerm.audienceWeights, 0.85);
  collectPositive(values, mechanismKeys, state.longTerm.mechanismWeights, 0.8);

  for (const memory of state.performanceMemory) {
    const keys = memory.dimension === "topic"
      ? topicKeys
      : memory.dimension === "audience"
        ? audienceKeys
        : memory.dimension === "mechanism"
          ? mechanismKeys
          : [];
    const similarity = maxSimilarity(memory.key, keys);
    if (similarity > 0) values.push(clamp01(memory.weight * memory.confidence * similarity));
  }

  return values.length ? Math.max(...values) : undefined;
}

function calculateNegativePreferencePenalty(
  item: ShadowPreRankedTrend,
  deep: ShadowDeepIntelligenceItem | undefined,
  state: BrandPreferenceState | undefined,
): number {
  if (!state) return 0;
  const topicKeys = [item.cluster.intelligence.topic];
  const audienceKeys = item.audience ? [item.audience] : [];
  const mechanismKeys = mechanismTerms(deep);
  const sourceKeys = [
    ...item.sourceClasses,
    ...item.cluster.sourceKeys,
    ...item.cluster.platformKeys,
  ];

  return Math.max(
    negativePenalty(topicKeys, state.negatives.topics),
    negativePenalty(audienceKeys, state.negatives.audiences),
    negativePenalty(mechanismKeys, state.negatives.mechanisms),
    negativePenalty(sourceKeys, state.negatives.sourceClasses),
  );
}

function collectPositive(
  output: number[],
  keys: readonly string[],
  preferences: readonly PreferenceWeight[],
  multiplier: number,
): void {
  for (const preference of preferences) {
    const similarity = maxSimilarity(preference.key, keys);
    if (similarity > 0) output.push(clamp01(preference.weight * similarity * multiplier));
  }
}

function negativePenalty(keys: readonly string[], preferences: readonly NegativePreference[]): number {
  let strongest = 0;
  for (const preference of preferences) {
    const similarity = maxSimilarity(preference.key, keys);
    strongest = Math.max(strongest, preference.strength * similarity);
  }
  return clamp01(strongest);
}

function mechanismTerms(deep: ShadowDeepIntelligenceItem | undefined): string[] {
  const mechanism = deep?.analysis.mechanism;
  if (!mechanism) return [];
  return [
    mechanism.hookType,
    mechanism.promise,
    mechanism.structure,
    mechanism.ctaType,
    mechanism.format,
    ...(mechanism.emotion ?? []),
    ...(mechanism.proofType ?? []),
    ...(mechanism.visualMechanism ?? []),
  ].filter((value): value is string => Boolean(value));
}

function classifyBucket(
  topicFit: number,
  affinity: number | undefined,
  explorationEligible: boolean,
): ShadowEEIBucket {
  if (explorationEligible) return "exploration";
  const preference = affinity ?? 0;
  if (topicFit >= 0.72 || preference >= 0.68) return "core";
  if (topicFit >= 0.32 || preference >= 0.35) return "adjacent";
  return "exploration";
}

function enforceFinalTopicShare(items: ShadowEEIRankedItem[], maximumShare: number): void {
  if (items.length < 3) return;

  while (items.length >= 3) {
    const counts = new Map<string, number>();
    for (const item of items) {
      const topic = normalize(item.topic);
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }

    const overrepresented = [...counts.entries()]
      .filter(([, count]) => count / items.length > maximumShare)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];

    if (!overrepresented) return;

    const [topic] = overrepresented;
    const removable = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => normalize(item.topic) === topic)
      .sort((left, right) =>
        left.item.eeiScore - right.item.eeiScore ||
        right.index - left.index
      )[0];

    if (!removable) return;
    items.splice(removable.index, 1);
  }
}

function buildExplanation(
  item: ShadowPreRankedTrend,
  deep: ShadowDeepIntelligenceItem | undefined,
  bucket: ShadowEEIBucket,
  affinity: number | undefined,
): RecommendationExplanation {
  const reason = bucket === "exploration"
    ? "Selected as a bounded exploration opportunity to avoid preference collapse."
    : bucket === "adjacent"
      ? "Selected as an adjacent opportunity with enough Brand relevance to broaden coverage."
      : "Selected as a core Brand-relevant opportunity.";

  const preferenceText = affinity === undefined
    ? "Preference affinity is not yet observed."
    : "Preference affinity " + affinity.toFixed(2) + ".";

  return prepareRecommendationExplanation({
    whyRecommended: reason + " " + (deep?.analysis.whyNow ?? "Current trend evidence supports timely consideration."),
    evidenceSummary:
      item.cluster.features.signalCount + " signals across " +
      item.cluster.features.uniqueSourceCount + " source groups with confidence " +
      item.cluster.intelligence.evidenceConfidence.toFixed(2) + ".",
    brandFitReason:
      (deep?.analysis.brandReason ?? "Brand fit is derived from the approved discovery topic and deterministic pre-rank.") +
      " " + preferenceText,
    ...(bucket === "exploration"
      ? { uncertainty: "Exploration items intentionally have lower known preference affinity and should be judged by the user." }
      : item.preRank.unknownFeatures.length
        ? { uncertainty: "Some ranking features remain unobserved: " + item.preRank.unknownFeatures.join(", ") + "." }
        : {}),
    userControl: "You can save, develop, dismiss or mark this recommendation not relevant; explicit feedback remains authoritative.",
  });
}

function weightedKnown(values: ReadonlyArray<readonly [number | undefined, number]>): number {
  let numerator = 0;
  let denominator = 0;
  for (const [value, weight] of values) {
    if (value === undefined) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : 0;
}

function targetCount(total: number, share: number, ensureWhenPositive: boolean): number {
  if (total <= 0 || share <= 0) return 0;
  const rounded = Math.round(total * share);
  return ensureWhenPositive ? Math.max(1, rounded) : rounded;
}

function primarySourceKey(item: ShadowEEIRankedItem): string {
  return item.preRanked.cluster.sourceKeys[0] ?? "unknown";
}

function compareRankedItems(left: ShadowEEIRankedItem, right: ShadowEEIRankedItem): number {
  return (
    right.eeiScore - left.eeiScore ||
    right.preRanked.cluster.intelligence.evidenceConfidence -
      left.preRanked.cluster.intelligence.evidenceConfidence ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function maxSimilarity(value: string, keys: readonly string[]): number {
  if (!keys.length) return 0;
  return Math.max(...keys.map((key) => tokenSimilarity(value, key)));
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160) || "unknown";
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
