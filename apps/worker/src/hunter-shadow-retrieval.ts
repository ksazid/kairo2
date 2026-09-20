import type { DiscoveryEvidence } from "@kairo/agent-contracts";
import type {
  HunterHardNegative,
  HunterRetrievalGenerator,
  HunterRetrievalIntent,
  HunterRetrievalPlan,
} from "@kairo/domain/hunter-retrieval";

export interface ShadowDiscoverySearchPort {
  search(intent: HunterRetrievalIntent): Promise<readonly DiscoveryEvidence[]>;
}

export interface ShadowSemanticReference {
  entityId: string;
  similarity: number;
  provider: string;
  model: string;
}

export interface ShadowSemanticExpansionPort {
  expand(input: { brandId: string; queryText: string; limit: number }): Promise<readonly ShadowSemanticReference[]>;
}

export interface ShadowHardNegativeSemanticPort {
  assess(input: { brandId: string; text: string; negatives: readonly HunterHardNegative[] }): Promise<{ similarity: number; matchedKey?: string }>;
}

export interface ShadowRetrievalCandidate {
  key: string;
  title: string;
  summary?: string;
  sourceUrl: string;
  platform: string;
  provider: string;
  publisher?: string;
  publishedAt?: string;
  generatorKeys: HunterRetrievalGenerator[];
  intentIds: string[];
  topicIds: string[];
  sourceClasses: string[];
  corroboratingKeys: string[];
}

export interface ShadowRetrievalDiagnostics {
  plannedIntentCount: number;
  executedLexicalIntentCount: number;
  executedSemanticIntentCount: number;
  failedIntentCount: number;
  rawCandidateCount: number;
  uniqueCandidateCount: number;
  duplicateCount: number;
  hardNegativeRejectedCount: number;
  semanticReferenceCount: number;
  corroboratedCandidateCount: number;
  topicRecallProxy: number;
  generatorCoverage: Record<string, number>;
  topicCoverage: Record<string, number>;
  sourceCoverage: Record<string, number>;
}

export interface ShadowRetrievalRun {
  candidates: ShadowRetrievalCandidate[];
  semanticReferences: Array<{ intentId: string; generator: HunterRetrievalGenerator; references: ShadowSemanticReference[] }>;
  diagnostics: ShadowRetrievalDiagnostics;
}

export interface RunShadowRetrievalOptions {
  maxExternalCalls?: number;
  maxSemanticCalls?: number;
  semanticHardNegativeThreshold?: number;
}

export async function runShadowRetrieval(
  plan: HunterRetrievalPlan,
  search: ShadowDiscoverySearchPort,
  semantic?: ShadowSemanticExpansionPort,
  semanticHardNegative?: ShadowHardNegativeSemanticPort,
  options: RunShadowRetrievalOptions = {},
): Promise<ShadowRetrievalRun> {
  const maxExternalCalls = boundedInteger(options.maxExternalCalls ?? 24, "maxExternalCalls", 0, 48);
  const maxSemanticCalls = boundedInteger(options.maxSemanticCalls ?? 12, "maxSemanticCalls", 0, 24);
  const semanticHardNegativeThreshold = boundedScore(options.semanticHardNegativeThreshold ?? 0.88, "semanticHardNegativeThreshold");

  const lexical = plan.intents.filter((intent) => intent.mode === "lexical-search").slice(0, maxExternalCalls);
  const semanticIntents = plan.intents.filter((intent) => intent.mode === "semantic-expansion").slice(0, maxSemanticCalls);
  const merged = new Map<string, ShadowRetrievalCandidate>();
  const semanticReferences: ShadowRetrievalRun["semanticReferences"] = [];
  let failedIntentCount = 0;
  let rawCandidateCount = 0;
  let duplicateCount = 0;
  let hardNegativeRejectedCount = 0;

  for (const intent of lexical) {
    let evidence: readonly DiscoveryEvidence[];
    try {
      evidence = await search.search(intent);
    } catch {
      failedIntentCount += 1;
      continue;
    }
    for (const item of evidence.slice(0, intent.maxResults)) {
      rawCandidateCount += 1;
      const text = candidateText(item);
      if (matchesHardNegative(text, item, plan.hardNegatives)) {
        hardNegativeRejectedCount += 1;
        continue;
      }
      if (semanticHardNegative) {
        try {
          const verdict = await semanticHardNegative.assess({ brandId: plan.brandId, text, negatives: plan.hardNegatives });
          if (verdict.similarity >= semanticHardNegativeThreshold) {
            hardNegativeRejectedCount += 1;
            continue;
          }
        } catch {
          // Shadow diagnostics must degrade safely when an optional semantic guard is unavailable.
        }
      }
      const key = candidateKey(item);
      const existing = merged.get(key);
      if (existing) {
        duplicateCount += 1;
        mergeProvenance(existing, intent);
        continue;
      }
      merged.set(key, toCandidate(key, item, intent));
    }
  }

  if (semantic) {
    for (const intent of semanticIntents) {
      try {
        const references = (await semantic.expand({
          brandId: plan.brandId,
          queryText: intent.semanticQuery,
          limit: intent.maxResults,
        }))
          .filter((item) => Number.isFinite(item.similarity) && item.similarity >= -1 && item.similarity <= 1)
          .slice(0, intent.maxResults)
          .map((item) => ({ ...item }));
        semanticReferences.push({ intentId: intent.id, generator: intent.generator, references });
      } catch {
        failedIntentCount += 1;
      }
    }
  }

  const candidates = [...merged.values()].sort((a, b) => a.title.localeCompare(b.title) || a.sourceUrl.localeCompare(b.sourceUrl));
  applyCorroboration(candidates);

  const generatorCoverage: Record<string, number> = {};
  const topicCoverage: Record<string, number> = {};
  const sourceCoverage: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const key of candidate.generatorKeys) generatorCoverage[key] = (generatorCoverage[key] ?? 0) + 1;
    for (const topicId of candidate.topicIds) topicCoverage[topicId] = (topicCoverage[topicId] ?? 0) + 1;
    const sourceKey = normalizeSource(candidate.platform || candidate.provider);
    sourceCoverage[sourceKey] = (sourceCoverage[sourceKey] ?? 0) + 1;
  }
  const plannedTopicIds = [...new Set(plan.intents.map((intent) => intent.topicId))];
  const coveredTopics = plannedTopicIds.filter((topicId) => (topicCoverage[topicId] ?? 0) > 0).length;

  return {
    candidates,
    semanticReferences,
    diagnostics: {
      plannedIntentCount: plan.intents.length,
      executedLexicalIntentCount: lexical.length,
      executedSemanticIntentCount: semantic ? semanticIntents.length : 0,
      failedIntentCount,
      rawCandidateCount,
      uniqueCandidateCount: candidates.length,
      duplicateCount,
      hardNegativeRejectedCount,
      semanticReferenceCount: semanticReferences.reduce((sum, item) => sum + item.references.length, 0),
      corroboratedCandidateCount: candidates.filter((item) => item.corroboratingKeys.length > 0).length,
      topicRecallProxy: plannedTopicIds.length ? coveredTopics / plannedTopicIds.length : 0,
      generatorCoverage,
      topicCoverage,
      sourceCoverage,
    },
  };
}

function toCandidate(key: string, item: DiscoveryEvidence, intent: HunterRetrievalIntent): ShadowRetrievalCandidate {
  return {
    key,
    title: item.title.trim(),
    ...(item.summary?.trim() ? { summary: item.summary.trim() } : {}),
    sourceUrl: item.sourceUrl,
    platform: item.platform,
    provider: item.provider,
    ...(item.publisher?.trim() ? { publisher: item.publisher.trim() } : {}),
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    generatorKeys: [intent.generator],
    intentIds: [intent.id],
    topicIds: [intent.topicId],
    sourceClasses: [...new Set(intent.sourceClasses)],
    corroboratingKeys: [],
  };
}

function mergeProvenance(candidate: ShadowRetrievalCandidate, intent: HunterRetrievalIntent): void {
  candidate.generatorKeys = unique([...candidate.generatorKeys, intent.generator]);
  candidate.intentIds = unique([...candidate.intentIds, intent.id]);
  candidate.topicIds = unique([...candidate.topicIds, intent.topicId]);
  candidate.sourceClasses = unique([...candidate.sourceClasses, ...intent.sourceClasses]);
}

function matchesHardNegative(text: string, item: DiscoveryEvidence, negatives: readonly HunterHardNegative[]): boolean {
  const textTokens = tokens(text);
  const sourceTokens = tokens([item.platform, item.provider, item.publisher ?? ""].join(" "));
  for (const negative of negatives) {
    const negativeTokens = tokens(negative.key);
    if (!negativeTokens.size) continue;
    const haystack = negative.source === "preference-source-class" ? sourceTokens : textTokens;
    let all = true;
    for (const token of negativeTokens) if (!haystack.has(token)) { all = false; break; }
    if (all) return true;
  }
  return false;
}

function candidateText(item: DiscoveryEvidence): string {
  return [item.title, item.summary ?? "", item.publisher ?? "", item.author ?? "", item.platform].join(" ");
}

function candidateKey(item: DiscoveryEvidence): string {
  if (item.contentHash?.trim()) return "hash:" + item.contentHash.trim().toLowerCase();
  const url = canonicalUrl(item.sourceUrl);
  if (url) return "url:" + url;
  return "title:" + normalizeTitle(item.title);
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function applyCorroboration(candidates: ShadowRetrievalCandidate[]): void {
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i]!;
      const right = candidates[j]!;
      if (normalizeSource(left.platform || left.provider) === normalizeSource(right.platform || right.provider)) continue;
      if (jaccard(tokens(left.title + " " + (left.summary ?? "")), tokens(right.title + " " + (right.summary ?? ""))) < 0.45) continue;
      left.corroboratingKeys = unique([...left.corroboratingKeys, right.key]);
      right.corroboratingKeys = unique([...right.corroboratingKeys, left.key]);
      left.generatorKeys = unique([...left.generatorKeys, "cross-source-confirmation"]);
      right.generatorKeys = unique([...right.generatorKeys, "cross-source-confirmation"]);
    }
  }
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((item) => item.length > 2) ?? []);
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 240);
}

function normalizeSource(value: string): string {
  return value.trim().toLowerCase() || "unknown";
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(field + " must be an integer from " + min + " to " + max);
  return value as number;
}

function boundedScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(field + " must be a number from 0 to 1");
  return value;
}