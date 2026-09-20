import {
  evaluateManipulationRisk,
  prepareEEIPolicy,
  type ManipulationRiskInput,
} from "@kairo/domain/eei";

export const HUNTER_EEI_VERSION = "hunter-eei-v1" as const;

export const HUNTER_EEI_POLICY = prepareEEIPolicy({
  version: HUNTER_EEI_VERSION,
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

type Scores = {
  relevance: number;
  evidence: number;
  novelty: number;
  timeliness: number;
  brandAuthority: number;
  audienceFit: number;
};

export type HunterEEICandidate = {
  title: string;
  topic?: string;
  engagementRisks?: ManipulationRiskInput;
};

export type HunterEEIItem<TCandidate extends HunterEEICandidate = HunterEEICandidate> = {
  candidate: TCandidate;
  scores: Scores;
  overall: number;
  topic: string;
};

export interface HunterEEIRerankOptions {
  maxCandidates?: number;
}

/**
 * Final deterministic engagement-safety boundary.
 *
 * This stage is intentionally downstream from Hunter's evidence/Brand quality gate.
 * It never optimizes dwell time, scroll depth or notification opens. Candidates that
 * explicitly rely on prohibited manipulation patterns are blocked; the remaining
 * list is ranked by evidence-backed user value and bounded topic concentration.
 */
export function applyHunterEEIRerank<
  TCandidate extends HunterEEICandidate,
  TItem extends HunterEEIItem<TCandidate>,
>(items: readonly TItem[], options: HunterEEIRerankOptions = {}): TItem[] {
  const maxCandidates = boundMax(options.maxCandidates ?? items.length);
  const evaluated = items.flatMap((item, index) => {
    const risk = evaluateManipulationRisk(
      item.candidate.engagementRisks ?? {},
      HUNTER_EEI_POLICY.manipulationRiskBlockThreshold,
    );
    if (risk.blocked) return [];

    const valueScore = clamp01(
      item.overall * 0.46 +
      item.scores.relevance * 0.12 +
      item.scores.evidence * 0.12 +
      item.scores.audienceFit * 0.10 +
      item.scores.novelty * 0.08 +
      item.scores.brandAuthority * 0.07 +
      item.scores.timeliness * 0.05 -
      risk.score * 0.35,
    );
    return [{ item, valueScore, index }];
  });

  evaluated.sort((left, right) =>
    right.valueScore - left.valueScore ||
    right.item.scores.evidence - left.item.scores.evidence ||
    right.item.scores.relevance - left.item.scores.relevance ||
    left.index - right.index
  );

  const topicLimit = Math.max(1, Math.floor(maxCandidates * HUNTER_EEI_POLICY.maximumTopicShare));
  const selected: TItem[] = [];
  const topicCounts = new Map<string, number>();

  for (const entry of evaluated) {
    const topic = normalize(entry.item.topic || entry.item.candidate.topic || entry.item.candidate.title);
    if ((topicCounts.get(topic) ?? 0) >= topicLimit) continue;
    selected.push(entry.item);
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    if (selected.length >= maxCandidates) break;
  }

  return selected;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160) || "unknown";
}

function boundMax(value: number): number {
  if (!Number.isInteger(value) || value < 1) return 1;
  return Math.min(12, value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
