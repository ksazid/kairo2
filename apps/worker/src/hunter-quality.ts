import type { DiscoveryEvidence, NormalizedSourceDocument } from "@kairo/agent-contracts";
import type { BrandIntelligenceTopicGraph } from "@kairo/domain/brand-intelligence";
import {
  evaluateOpportunity,
  materiallySimilarOpportunity,
  type OpportunityEvaluationInput,
} from "@kairo/domain/discovery";
import type { BrandIntelligenceProfile } from "@kairo/domain/source-policy";

export const HUNTER_QUALITY_VERSION = "hunter-quality-v1" as const;

export interface HunterQualityCandidate {
  sourceUrl: string;
  title: string;
  rationale: string;
  whyNow: string;
  developmentDirection: string;
  topic?: string;
  proposedAngle?: string;
  targetAudience?: string;
  scores: OpportunityEvaluationInput;
}

export interface HunterQualityContext {
  evidenceByUrl: ReadonlyMap<string, DiscoveryEvidence>;
  documentsByUrl: ReadonlyMap<string, NormalizedSourceDocument>;
  intelligenceProfile?: BrandIntelligenceProfile;
  intelligenceGraph?: BrandIntelligenceTopicGraph;
  existingOpportunityTitles?: readonly string[];
  referenceTime?: string;
  maxCandidates?: number;
}

export interface RankedHunterCandidate<TCandidate extends HunterQualityCandidate = HunterQualityCandidate> {
  candidate: TCandidate;
  source: DiscoveryEvidence;
  scores: OpportunityEvaluationInput;
  overall: number;
  topic: string;
}

/**
 * Deterministic post-model quality boundary for Hunter.
 *
 * The model may propose and self-score candidates, but it cannot decide persistence order or
 * qualification by itself. This boundary binds every candidate back to supplied evidence,
 * adjusts scores using observable evidence/Brand context, rejects exclusions and repeats,
 * then applies stable ranking + diversity before DiscoveryService performs its final domain gate.
 */
export function rankAndFilterHunterCandidates<TCandidate extends HunterQualityCandidate>(
  candidates: readonly TCandidate[],
  context: HunterQualityContext,
): RankedHunterCandidate<TCandidate>[] {
  const maxCandidates = boundedMaxCandidates(context.maxCandidates);
  const referenceMs = referenceTimeMs(context.referenceTime);
  const prepared: RankedHunterCandidate<TCandidate>[] = [];

  for (const candidate of candidates.slice(0, 36)) {
    const source = context.evidenceByUrl.get(candidate.sourceUrl);
    if (!source) continue;
    if (matchesExcludedTopic(candidate, context.intelligenceProfile)) continue;

    const previousSimilarity = maxPreviousSimilarity(candidate.title, context.existingOpportunityTitles);
    if (previousSimilarity >= 0.72) continue;

    const signals = deterministicSignals(candidate, source, context, referenceMs);
    const scores = adjustScores(candidate.scores, signals, previousSimilarity, Boolean(context.intelligenceProfile));
    const evaluation = evaluateOpportunity(scores);
    if (!passesHunterQualityFloor(evaluation, signals.brandFit, Boolean(context.intelligenceProfile))) continue;

    prepared.push({
      candidate,
      source,
      scores,
      overall: evaluation.overall,
      topic: bestCandidateTopic(candidate, source, context),
    });
  }

  prepared.sort((left, right) =>
    right.overall - left.overall ||
    right.scores.relevance - left.scores.relevance ||
    right.scores.evidence - left.scores.evidence ||
    right.scores.timeliness - left.scores.timeliness ||
    left.candidate.title.localeCompare(right.candidate.title) ||
    left.candidate.sourceUrl.localeCompare(right.candidate.sourceUrl),
  );

  const accepted: RankedHunterCandidate<TCandidate>[] = [];
  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();

  for (const item of prepared) {
    if (accepted.some((existing) => materiallyDuplicate(item, existing))) continue;

    const sourceKey = canonicalEvidenceKey(item.source.sourceUrl);
    const topicKey = normalizedKey(item.topic);
    if ((sourceCounts.get(sourceKey) ?? 0) >= 2) continue;
    if (topicKey && (topicCounts.get(topicKey) ?? 0) >= 3) continue;

    accepted.push(item);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
    if (topicKey) topicCounts.set(topicKey, (topicCounts.get(topicKey) ?? 0) + 1);
    if (accepted.length >= maxCandidates) break;
  }

  return accepted;
}

interface DeterministicSignals {
  brandFit: number;
  audienceFit: number;
  graphFit: number;
  evidenceQuality: number;
  sourceAuthority: number;
  freshness: number | undefined;
}

function deterministicSignals<TCandidate extends HunterQualityCandidate>(
  candidate: TCandidate,
  source: DiscoveryEvidence,
  context: HunterQualityContext,
  referenceMs: number,
): DeterministicSignals {
  const profile = context.intelligenceProfile;
  const text = candidateEvidenceText(candidate, source);
  const brandTargets = profile ? [
    ...profile.topics,
    ...profile.audiences,
    ...profile.goals,
    profile.sector,
    profile.subsector,
  ].filter((value): value is string => Boolean(value)) : [];
  const brandFit = profile ? bestTermFit(text, brandTargets) : candidate.scores.relevance;
  const audienceText = `${candidate.targetAudience ?? ""} ${text}`;
  const audienceFit = profile
    ? Math.max(bestTermFit(audienceText, profile.audiences), brandFit * 0.5)
    : candidate.scores.audienceFit;

  return {
    brandFit,
    audienceFit,
    graphFit: graphFitScore(text, context.intelligenceGraph),
    evidenceQuality: evidenceQualityScore(source, context.documentsByUrl.get(source.sourceUrl)),
    sourceAuthority: sourceAuthorityScore(source.platform),
    freshness: freshnessScore(source.publishedAt, referenceMs),
  };
}

function adjustScores(
  model: OpportunityEvaluationInput,
  signals: DeterministicSignals,
  previousSimilarity: number,
  hasProfile: boolean,
): OpportunityEvaluationInput {
  const relevance = hasProfile
    ? model.relevance * 0.62 + signals.brandFit * 0.23 + signals.graphFit * 0.15
    : model.relevance;
  const evidence = model.evidence * 0.65 + signals.evidenceQuality * 0.20 + signals.sourceAuthority * 0.15;
  const audienceFit = hasProfile
    ? model.audienceFit * 0.78 + signals.audienceFit * 0.22
    : model.audienceFit;
  const noveltyPenalty = previousSimilarity <= 0.35 ? 1 : 1 - Math.min(0.30, (previousSimilarity - 0.35) * 0.55);
  const timeliness = signals.freshness === undefined
    ? Math.min(model.timeliness, 0.75)
    : model.timeliness * 0.65 + signals.freshness * 0.35;
  const brandAuthority = model.brandAuthority * 0.70 + signals.sourceAuthority * 0.20 + signals.graphFit * 0.10;

  return {
    relevance: clamp01(relevance),
    evidence: clamp01(evidence),
    novelty: clamp01(model.novelty * noveltyPenalty),
    timeliness: clamp01(timeliness),
    brandAuthority: clamp01(brandAuthority),
    audienceFit: clamp01(audienceFit),
  };
}

function passesHunterQualityFloor(
  evaluation: ReturnType<typeof evaluateOpportunity>,
  brandFit: number,
  hasProfile: boolean,
): boolean {
  if (!evaluation.qualifies) return false;
  if (evaluation.overall < 0.70) return false;
  if (evaluation.relevance < 0.62 || evaluation.evidence < 0.52) return false;
  if (evaluation.audienceFit < 0.58 || evaluation.novelty < 0.45 || evaluation.brandAuthority < 0.50) return false;
  if (hasProfile && brandFit < 0.20) return false;
  return true;
}

function matchesExcludedTopic(candidate: HunterQualityCandidate, profile: BrandIntelligenceProfile | undefined): boolean {
  if (!profile?.excludedTopics.length) return false;
  const text = `${candidate.title} ${candidate.topic ?? ""} ${candidate.proposedAngle ?? ""} ${candidate.developmentDirection}`;
  return profile.excludedTopics.some((excluded) => termFit(text, excluded) >= 0.75);
}

function materiallyDuplicate(
  candidate: RankedHunterCandidate,
  existing: RankedHunterCandidate,
): boolean {
  if (materiallySimilarOpportunity(
    { topic: candidate.candidate.title, developmentDirection: candidate.candidate.developmentDirection },
    { topic: existing.candidate.title, developmentDirection: existing.candidate.developmentDirection },
  )) return true;

  return canonicalEvidenceKey(candidate.source.sourceUrl) === canonicalEvidenceKey(existing.source.sourceUrl) &&
    titleSimilarity(candidate.candidate.title, existing.candidate.title) >= 0.65;
}

function bestCandidateTopic(
  candidate: HunterQualityCandidate,
  source: DiscoveryEvidence,
  context: HunterQualityContext,
): string {
  if (candidate.topic?.trim()) return candidate.topic.trim();
  const text = candidateEvidenceText(candidate, source);
  const graphTopic = context.intelligenceGraph?.nodes
    .filter((node) => !node.excluded)
    .map((node) => ({ node, fit: Math.max(termFit(text, node.topic), ...node.aliases.map((alias) => termFit(text, alias))) }))
    .filter((item) => item.fit >= 0.5)
    .sort((left, right) => (right.node.priority * right.fit) - (left.node.priority * left.fit))[0]?.node.topic;
  return graphTopic ?? context.intelligenceProfile?.topics.find((topic) => termFit(text, topic) >= 0.5) ?? candidate.title;
}

function graphFitScore(text: string, graph: BrandIntelligenceTopicGraph | undefined): number {
  if (!graph) return 0;
  let best = 0;
  for (const node of graph.nodes) {
    if (node.excluded) continue;
    const fit = Math.max(termFit(text, node.topic), ...node.aliases.map((alias) => termFit(text, alias)));
    best = Math.max(best, clamp01(node.priority) * fit);
  }
  return clamp01(best);
}

function evidenceQualityScore(source: DiscoveryEvidence, document: NormalizedSourceDocument | undefined): number {
  let score = 0.20;
  if ((source.summary?.trim().length ?? 0) >= 40) score += 0.20;
  const documentText = document?.transcript ?? document?.body ?? document?.description ?? "";
  if (documentText.trim().length >= 40) score += 0.25;
  if (source.publishedAt) score += 0.10;
  if (source.publisher || source.author) score += 0.05;
  if (source.contentHash || document?.contentHash) score += 0.10;
  if (source.providerVersion || document?.providerVersion) score += 0.05;
  return clamp01(score);
}

function freshnessScore(publishedAt: string | undefined, referenceMs: number): number | undefined {
  if (!publishedAt) return undefined;
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedMs)) return undefined;
  const ageDays = Math.max(0, (referenceMs - publishedMs) / 86_400_000);
  return clamp01(1 - ageDays / 180);
}

function sourceAuthorityScore(platform: string): number {
  const normalized = platform.trim().toLowerCase();
  if (["github", "hacker-news", "rss"].includes(normalized)) return 0.90;
  if (normalized === "youtube") return 0.75;
  if (["bluesky", "linkedin", "instagram"].includes(normalized)) return 0.65;
  return 0.60;
}

function maxPreviousSimilarity(title: string, previous: readonly string[] | undefined): number {
  if (!previous?.length) return 0;
  return previous.reduce((best, item) => Math.max(best, titleSimilarity(title, item)), 0);
}

function titleSimilarity(left: string, right: string): number {
  const a = new Set(meaningfulTokens(left));
  const b = new Set(meaningfulTokens(right));
  if (!a.size || !b.size) return left.trim().toLowerCase() === right.trim().toLowerCase() ? 1 : 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
}

function bestTermFit(text: string, terms: readonly string[]): number {
  return terms.reduce((best, term) => Math.max(best, termFit(text, term)), 0);
}

function termFit(text: string, term: string): number {
  const target = meaningfulTokens(term);
  if (!target.length) return 0;
  const haystack = new Set(meaningfulTokens(text));
  const matched = target.filter((token) => haystack.has(token)).length;
  return matched / target.length;
}

function meaningfulTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) =>
    token.length >= 3 && !STOP_WORDS.has(token),
  ) ?? [];
}

function candidateEvidenceText(candidate: HunterQualityCandidate, source: DiscoveryEvidence): string {
  return `${candidate.title} ${candidate.rationale} ${candidate.developmentDirection} ${candidate.topic ?? ""} ${candidate.proposedAngle ?? ""} ${source.title} ${source.summary ?? ""}`;
}

function canonicalEvidenceKey(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || TRACKING_PARAMS.has(normalized)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\?$/, "");
  } catch {
    return sourceUrl.trim();
  }
}

function normalizedKey(value: string): string {
  return meaningfulTokens(value).slice(0, 8).sort().join("|");
}

function referenceTimeMs(value: string | undefined): number {
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function boundedMaxCandidates(value: number | undefined): number {
  if (value === undefined) return 12;
  if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error("maxCandidates must be an integer from 1 to 12");
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "dclid", "msclkid"]);
const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "and", "are", "because", "been", "before", "being", "between", "from", "have", "into", "more", "most", "over", "that", "the", "their", "them", "then", "there", "these", "this", "those", "through", "using", "what", "when", "where", "which", "with", "would", "your",
]);
