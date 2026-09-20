import {
  prepareBrandPreferenceState,
  type BrandPreferenceState,
  type NegativePreference,
  type PreferenceWeight,
} from "./brand-preference-state";
import type { OpportunityFeedbackEventV2 } from "./opportunity-intelligence";

export const FEEDBACK_PREFERENCE_PROJECTOR_VERSION = "feedback-preference-v2-shadow" as const;

export type FeedbackSelectionBucket = "core" | "adjacent" | "exploration";

export interface FeedbackLearningContext {
  event: OpportunityFeedbackEventV2;
  topic: string;
  audience?: string;
  format?: string;
  channel?: string;
  mechanismKeys?: string[];
  sourceClasses?: string[];
  selectionBucket?: FeedbackSelectionBucket;
}

export interface FeedbackProjectionDiagnostics {
  inputEventCount: number;
  appliedEventCount: number;
  duplicateEventCount: number;
  passiveEventCount: number;
  positiveEventCount: number;
  negativeEventCount: number;
  dimensionUpdates: {
    topic: number;
    audience: number;
    format: number;
    channel: number;
    mechanism: number;
    sourceClass: number;
    explorationBudget: number;
  };
}

export interface FeedbackProjectionResult {
  version: typeof FEEDBACK_PREFERENCE_PROJECTOR_VERSION;
  state?: BrandPreferenceState;
  appliedIdempotencyKeys: string[];
  diagnostics: FeedbackProjectionDiagnostics;
}

const POSITIVE: Partial<Record<OpportunityFeedbackEventV2["action"], number>> = {
  saved: 0.04,
  developed: 0.08,
  generated: 0.07,
  approved: 0.10,
  published: 0.12,
};

const TOPIC_NEGATIVE: Partial<Record<OpportunityFeedbackEventV2["action"], number>> = {
  dismissed: 0.06,
  not_relevant: 0.18,
  seen_before: 0.08,
  wrong_brand: 0.26,
  wrong_timing: 0.06,
};

const PASSIVE = new Set<OpportunityFeedbackEventV2["action"]>([
  "impression",
  "opened",
  "performance_observed",
]);

export function projectFeedbackPreferenceStateV2(
  current: BrandPreferenceState | undefined,
  signals: readonly FeedbackLearningContext[],
): FeedbackProjectionResult {
  const ordered = [...signals].sort((left, right) =>
    Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt) ||
    left.event.id.localeCompare(right.event.id),
  );

  const seen = new Set<string>();
  const appliedIdempotencyKeys: string[] = [];
  const diagnostics: FeedbackProjectionDiagnostics = {
    inputEventCount: ordered.length,
    appliedEventCount: 0,
    duplicateEventCount: 0,
    passiveEventCount: 0,
    positiveEventCount: 0,
    negativeEventCount: 0,
    dimensionUpdates: {
      topic: 0,
      audience: 0,
      format: 0,
      channel: 0,
      mechanism: 0,
      sourceClass: 0,
      explorationBudget: 0,
    },
  };

  let state = current ? structuredClone(current) : undefined;

  for (const signal of ordered) {
    validateSignal(signal);
    const key = signal.event.idempotencyKey.trim();
    if (seen.has(key)) {
      diagnostics.duplicateEventCount += 1;
      continue;
    }
    seen.add(key);

    if (PASSIVE.has(signal.event.action)) {
      diagnostics.passiveEventCount += 1;
      appliedIdempotencyKeys.push(key);
      continue;
    }

    state = decayState(state ?? emptyState(signal), signal.event.occurredAt);
    const positive = POSITIVE[signal.event.action] ?? 0;
    const topicNegative = TOPIC_NEGATIVE[signal.event.action] ?? 0;

    if (positive > 0) {
      diagnostics.positiveEventCount += 1;
      state.longTerm.topicWeights = reinforce(
        state.longTerm.topicWeights,
        signal.topic,
        positive,
        signal.event.occurredAt,
      );
      diagnostics.dimensionUpdates.topic += 1;

      if (signal.audience) {
        state.longTerm.audienceWeights = reinforce(
          state.longTerm.audienceWeights,
          signal.audience,
          positive * 0.8,
          signal.event.occurredAt,
        );
        diagnostics.dimensionUpdates.audience += 1;
      }
      if (signal.format) {
        state.longTerm.formatWeights = reinforce(
          state.longTerm.formatWeights,
          signal.format,
          positive * 0.7,
          signal.event.occurredAt,
        );
        diagnostics.dimensionUpdates.format += 1;
      }
      if (signal.channel) {
        state.longTerm.channelWeights = reinforce(
          state.longTerm.channelWeights,
          signal.channel,
          positive * 0.7,
          signal.event.occurredAt,
        );
        diagnostics.dimensionUpdates.channel += 1;
      }
      for (const mechanism of uniqueClean(signal.mechanismKeys ?? [], 120, 12)) {
        state.longTerm.mechanismWeights = reinforce(
          state.longTerm.mechanismWeights,
          mechanism,
          positive * 0.75,
          signal.event.occurredAt,
        );
        diagnostics.dimensionUpdates.mechanism += 1;
      }

      state.shortTerm.activeTopics = reinforce(
        state.shortTerm.activeTopics,
        signal.topic,
        Math.min(0.18, positive * 1.5),
        signal.event.occurredAt,
      );
      state.negatives.topics = softenNegative(state.negatives.topics, signal.topic, positive * 0.5);

      if (signal.selectionBucket === "exploration") {
        const next = clamp(state.explorationBudget + Math.min(0.02, positive * 0.12), 0.08, 0.2);
        if (next !== state.explorationBudget) diagnostics.dimensionUpdates.explorationBudget += 1;
        state.explorationBudget = next;
      }
    }

    if (topicNegative > 0) {
      diagnostics.negativeEventCount += 1;
      state.negatives.topics = reinforceNegative(
        state.negatives.topics,
        signal.topic,
        topicNegative,
        signal.event.reason,
        signal.event.occurredAt,
      );
      diagnostics.dimensionUpdates.topic += 1;
    }

    if (signal.event.action === "wrong_audience" && signal.audience) {
      diagnostics.negativeEventCount += topicNegative > 0 ? 0 : 1;
      state.negatives.audiences = reinforceNegative(
        state.negatives.audiences,
        signal.audience,
        0.22,
        signal.event.reason,
        signal.event.occurredAt,
      );
      diagnostics.dimensionUpdates.audience += 1;
    }

    if (signal.event.action === "not_credible") {
      diagnostics.negativeEventCount += topicNegative > 0 ? 0 : 1;
      for (const sourceClass of uniqueClean(signal.sourceClasses ?? [], 120, 12)) {
        state.negatives.sourceClasses = reinforceNegative(
          state.negatives.sourceClasses,
          sourceClass,
          0.25,
          signal.event.reason,
          signal.event.occurredAt,
        );
        diagnostics.dimensionUpdates.sourceClass += 1;
      }
    }

    if (signal.event.action === "heavily_edited") {
      diagnostics.negativeEventCount += 1;
      for (const mechanism of uniqueClean(signal.mechanismKeys ?? [], 120, 12)) {
        state.negatives.mechanisms = reinforceNegative(
          state.negatives.mechanisms,
          mechanism,
          0.14,
          signal.event.reason,
          signal.event.occurredAt,
        );
        state.longTerm.mechanismWeights = softenPositive(
          state.longTerm.mechanismWeights,
          mechanism,
          0.07,
        );
        diagnostics.dimensionUpdates.mechanism += 1;
      }
    }

    if (signal.event.action === "wrong_brand") {
      state.longTerm.topicWeights = softenPositive(
        state.longTerm.topicWeights,
        signal.topic,
        0.13,
      );
    }

    if (signal.event.action === "wrong_timing") {
      state.shortTerm.activeTopics = softenPositive(
        state.shortTerm.activeTopics,
        signal.topic,
        0.12,
      );
    }

    if (
      signal.selectionBucket === "exploration" &&
      ["dismissed", "not_relevant", "wrong_brand"].includes(signal.event.action)
    ) {
      const next = clamp(state.explorationBudget - 0.01, 0.08, 0.2);
      if (next !== state.explorationBudget) diagnostics.dimensionUpdates.explorationBudget += 1;
      state.explorationBudget = next;
    }

    state.snapshotVersion = "feedback-v2:" + signal.event.occurredAt;
    state.shortTerm.updatedAt = signal.event.occurredAt;
    state.updatedAt = signal.event.occurredAt;
    diagnostics.appliedEventCount += 1;
    appliedIdempotencyKeys.push(key);
    state = prepareBrandPreferenceState(state);
  }

  return {
    version: FEEDBACK_PREFERENCE_PROJECTOR_VERSION,
    ...(state ? { state } : {}),
    appliedIdempotencyKeys,
    diagnostics,
  };
}

function emptyState(signal: FeedbackLearningContext): BrandPreferenceState {
  return prepareBrandPreferenceState({
    workspaceId: signal.event.workspaceId,
    brandId: signal.event.brandId,
    snapshotVersion: "feedback-v2:" + signal.event.occurredAt,
    longTerm: {
      topicWeights: [],
      audienceWeights: [],
      formatWeights: [],
      channelWeights: [],
      mechanismWeights: [],
    },
    shortTerm: {
      activeTopics: [],
      activeCampaignIds: [],
      updatedAt: signal.event.occurredAt,
    },
    negatives: {
      topics: [],
      audiences: [],
      mechanisms: [],
      sourceClasses: [],
    },
    performanceMemory: [],
    explorationBudget: 0.12,
    updatedAt: signal.event.occurredAt,
  });
}

function validateSignal(signal: FeedbackLearningContext): void {
  if (!signal.topic.trim()) throw new Error("Feedback learning topic is required");
  if (!signal.event.idempotencyKey.trim()) throw new Error("Feedback event idempotency key is required");
}

function decayState(state: BrandPreferenceState, at: string): BrandPreferenceState {
  const days = Math.max(0, (Date.parse(at) - Date.parse(state.updatedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return structuredClone(state);

  const longFactor = Math.pow(0.98, days / 7);
  const shortFactor = Math.pow(0.88, days / 7);
  const negativeFactor = Math.pow(0.97, days / 7);

  return {
    ...structuredClone(state),
    longTerm: {
      ...state.longTerm,
      topicWeights: decayWeights(state.longTerm.topicWeights, longFactor),
      audienceWeights: decayWeights(state.longTerm.audienceWeights, longFactor),
      formatWeights: decayWeights(state.longTerm.formatWeights, longFactor),
      channelWeights: decayWeights(state.longTerm.channelWeights, longFactor),
      mechanismWeights: decayWeights(state.longTerm.mechanismWeights, longFactor),
    },
    shortTerm: {
      ...state.shortTerm,
      activeTopics: decayWeights(state.shortTerm.activeTopics, shortFactor),
      updatedAt: at,
    },
    negatives: {
      topics: decayNegatives(state.negatives.topics, negativeFactor),
      audiences: decayNegatives(state.negatives.audiences, negativeFactor),
      mechanisms: decayNegatives(state.negatives.mechanisms, negativeFactor),
      sourceClasses: decayNegatives(state.negatives.sourceClasses, negativeFactor),
    },
    updatedAt: at,
  };
}

function reinforce(values: PreferenceWeight[], key: string, delta: number, at: string): PreferenceWeight[] {
  const cleanKey = clean(key, 300);
  if (!cleanKey) return values;
  const normalized = cleanKey.toLowerCase();
  const current = values.find((item) => item.key.toLowerCase() === normalized);
  const next: PreferenceWeight = {
    key: current?.key ?? cleanKey,
    weight: Math.min(0.95, (current?.weight ?? 0) * 0.92 + delta),
    evidenceCount: (current?.evidenceCount ?? 0) + 1,
    lastReinforcedAt: at,
  };
  return [...values.filter((item) => item.key.toLowerCase() !== normalized), next]
    .filter((item) => item.weight >= 0.02)
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, 50);
}

function reinforceNegative(
  values: NegativePreference[],
  key: string,
  delta: number,
  reason: string | undefined,
  at: string,
): NegativePreference[] {
  const cleanKey = clean(key, 300);
  if (!cleanKey) return values;
  const normalized = cleanKey.toLowerCase();
  const current = values.find((item) => item.key.toLowerCase() === normalized);
  const next: NegativePreference = {
    key: current?.key ?? cleanKey,
    strength: Math.min(0.95, (current?.strength ?? 0) * 0.9 + delta),
    ...(clean(reason ?? "", 500)
      ? { reason: clean(reason ?? "", 500) }
      : current?.reason ? { reason: current.reason } : {}),
    lastObservedAt: at,
  };
  return [...values.filter((item) => item.key.toLowerCase() !== normalized), next]
    .filter((item) => item.strength >= 0.02)
    .sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key))
    .slice(0, 50);
}

function softenNegative(values: NegativePreference[], key: string, amount: number): NegativePreference[] {
  const normalized = clean(key, 300).toLowerCase();
  return values
    .map((item) => item.key.toLowerCase() === normalized
      ? { ...item, strength: Math.max(0, item.strength - amount) }
      : item)
    .filter((item) => item.strength >= 0.02);
}

function softenPositive(values: PreferenceWeight[], key: string, amount: number): PreferenceWeight[] {
  const normalized = clean(key, 300).toLowerCase();
  return values
    .map((item) => item.key.toLowerCase() === normalized
      ? { ...item, weight: Math.max(0, item.weight - amount) }
      : item)
    .filter((item) => item.weight >= 0.02);
}

function decayWeights(values: PreferenceWeight[], factor: number): PreferenceWeight[] {
  return values
    .map((item) => ({ ...item, weight: item.weight * factor }))
    .filter((item) => item.weight >= 0.02);
}

function decayNegatives(values: NegativePreference[], factor: number): NegativePreference[] {
  return values
    .map((item) => ({ ...item, strength: item.strength * factor }))
    .filter((item) => item.strength >= 0.02);
}

function uniqueClean(values: readonly string[], maxLength: number, maxItems: number): string[] {
  return [...new Set(values.map((value) => clean(value, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function clean(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
