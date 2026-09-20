import {
  prepareBrandPreferenceState,
  type BrandPreferenceState,
  type NegativePreference,
  type PreferenceWeight,
} from "@kairo/domain/brand-preference-state";
import type { RecommendationFeedbackAction } from "./batch7-closed-loop-store";

export interface FeedbackPreferenceSignal {
  workspaceId: string;
  brandId: string;
  action: RecommendationFeedbackAction;
  at: string;
  topic: string;
  audience?: string;
  format?: string;
  channel?: string;
  reason?: string;
}

const POSITIVE: Partial<Record<RecommendationFeedbackAction, number>> = {
  saved: 0.04,
  developed: 0.08,
  generated: 0.07,
  approved: 0.10,
  published: 0.12,
};

const NEGATIVE: Partial<Record<RecommendationFeedbackAction, number>> = {
  dismissed: 0.08,
  not_relevant: 0.18,
  seen_before: 0.16,
  wrong_audience: 0.22,
  wrong_brand: 0.26,
  wrong_timing: 0.12,
  not_credible: 0.25,
};

export function evolveBrandPreferenceState(
  current: BrandPreferenceState | undefined,
  signal: FeedbackPreferenceSignal,
): BrandPreferenceState | undefined {
  const positive = POSITIVE[signal.action] ?? 0;
  const negative = NEGATIVE[signal.action] ?? 0;
  if (!positive && !negative) return current;

  const base = decayState(current ?? emptyState(signal), signal.at);
  const topic = clean(signal.topic);
  const audience = clean(signal.audience);
  const format = clean(signal.format);
  const channel = clean(signal.channel);

  if (positive) {
    base.longTerm.topicWeights = reinforce(base.longTerm.topicWeights, topic, positive, signal.at);
    if (audience) base.longTerm.audienceWeights = reinforce(base.longTerm.audienceWeights, audience, positive * 0.8, signal.at);
    if (format) base.longTerm.formatWeights = reinforce(base.longTerm.formatWeights, format, positive * 0.7, signal.at);
    if (channel) base.longTerm.channelWeights = reinforce(base.longTerm.channelWeights, channel, positive * 0.7, signal.at);
    base.shortTerm.activeTopics = reinforce(base.shortTerm.activeTopics, topic, Math.min(0.18, positive * 1.5), signal.at);
    base.negatives.topics = softenNegative(base.negatives.topics, topic, positive * 0.5);
  }

  if (negative) {
    base.negatives.topics = reinforceNegative(base.negatives.topics, topic, negative, signal.reason, signal.at);
    if (signal.action === "wrong_audience" && audience) {
      base.negatives.audiences = reinforceNegative(base.negatives.audiences, audience, negative, signal.reason, signal.at);
    }
    if (signal.action === "wrong_brand") {
      base.longTerm.topicWeights = softenPositive(base.longTerm.topicWeights, topic, negative * 0.5);
    }
  }

  base.snapshotVersion = `feedback:${signal.at}`;
  base.shortTerm.updatedAt = signal.at;
  base.updatedAt = signal.at;
  return prepareBrandPreferenceState(base);
}

export function summarizeBrandPreferenceState(state: BrandPreferenceState | undefined): string | undefined {
  if (!state) return undefined;
  const preferredTopics = state.longTerm.topicWeights.filter((item) => item.weight >= 0.08).slice(0, 6);
  const activeTopics = state.shortTerm.activeTopics.filter((item) => item.weight >= 0.08).slice(0, 5);
  const avoidedTopics = state.negatives.topics.filter((item) => item.strength >= 0.12).slice(0, 6);
  const formats = state.longTerm.formatWeights.filter((item) => item.weight >= 0.08).slice(0, 4);
  const channels = state.longTerm.channelWeights.filter((item) => item.weight >= 0.08).slice(0, 4);
  const parts: string[] = [];
  if (preferredTopics.length) parts.push(`preferred topics: ${preferredTopics.map(showWeight).join(", ")}`);
  if (activeTopics.length) parts.push(`currently active topics: ${activeTopics.map(showWeight).join(", ")}`);
  if (avoidedTopics.length) parts.push(`explicit negative topics: ${avoidedTopics.map((item) => `${item.key} (${item.strength.toFixed(2)})`).join(", ")}`);
  if (formats.length) parts.push(`preferred formats: ${formats.map(showWeight).join(", ")}`);
  if (channels.length) parts.push(`preferred channels: ${channels.map(showWeight).join(", ")}`);
  return parts.length ? `Brand preference state (bounded, explicit feedback only): ${parts.join(" | ")}` : undefined;
}

function emptyState(signal: FeedbackPreferenceSignal): BrandPreferenceState {
  return prepareBrandPreferenceState({
    workspaceId: signal.workspaceId,
    brandId: signal.brandId,
    snapshotVersion: `feedback:${signal.at}`,
    longTerm: { topicWeights: [], audienceWeights: [], formatWeights: [], channelWeights: [], mechanismWeights: [] },
    shortTerm: { activeTopics: [], activeCampaignIds: [], updatedAt: signal.at },
    negatives: { topics: [], audiences: [], mechanisms: [], sourceClasses: [] },
    performanceMemory: [],
    explorationBudget: 0.12,
    updatedAt: signal.at,
  });
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
  if (!key) return values;
  const normalized = key.toLowerCase();
  const current = values.find((item) => item.key.toLowerCase() === normalized);
  const next: PreferenceWeight = {
    key: current?.key ?? key,
    weight: Math.min(0.95, (current?.weight ?? 0) * 0.92 + delta),
    evidenceCount: (current?.evidenceCount ?? 0) + 1,
    lastReinforcedAt: at,
  };
  return [...values.filter((item) => item.key.toLowerCase() !== normalized), next]
    .filter((item) => item.weight >= 0.02)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 50);
}

function reinforceNegative(values: NegativePreference[], key: string, delta: number, reason: string | undefined, at: string): NegativePreference[] {
  if (!key) return values;
  const normalized = key.toLowerCase();
  const current = values.find((item) => item.key.toLowerCase() === normalized);
  const next: NegativePreference = {
    key: current?.key ?? key,
    strength: Math.min(0.95, (current?.strength ?? 0) * 0.9 + delta),
    ...(clean(reason) ? { reason: clean(reason).slice(0, 500) } : current?.reason ? { reason: current.reason } : {}),
    lastObservedAt: at,
  };
  return [...values.filter((item) => item.key.toLowerCase() !== normalized), next]
    .filter((item) => item.strength >= 0.02)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 50);
}

function softenNegative(values: NegativePreference[], key: string, amount: number): NegativePreference[] {
  const normalized = key.toLowerCase();
  return values.map((item) => item.key.toLowerCase() === normalized ? { ...item, strength: Math.max(0, item.strength - amount) } : item)
    .filter((item) => item.strength >= 0.02);
}

function softenPositive(values: PreferenceWeight[], key: string, amount: number): PreferenceWeight[] {
  const normalized = key.toLowerCase();
  return values.map((item) => item.key.toLowerCase() === normalized ? { ...item, weight: Math.max(0, item.weight - amount) } : item)
    .filter((item) => item.weight >= 0.02);
}

function decayWeights(values: PreferenceWeight[], factor: number): PreferenceWeight[] {
  return values.map((item) => ({ ...item, weight: item.weight * factor })).filter((item) => item.weight >= 0.02);
}

function decayNegatives(values: NegativePreference[], factor: number): NegativePreference[] {
  return values.map((item) => ({ ...item, strength: item.strength * factor })).filter((item) => item.strength >= 0.02);
}

function showWeight(item: PreferenceWeight): string {
  return `${item.key} (${item.weight.toFixed(2)}, n=${item.evidenceCount ?? 0})`;
}

function clean(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "";
}
