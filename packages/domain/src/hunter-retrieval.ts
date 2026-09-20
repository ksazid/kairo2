import { DomainValidationError } from "./index";
import type { BrandDiscoveryPlan, BrandDiscoveryTopic } from "./brand-discovery-plan";
import type { BrandPreferenceState, NegativePreference, PreferenceWeight } from "./brand-preference-state";

export const HUNTER_RETRIEVAL_SCHEMA_VERSION = "1" as const;

export const HUNTER_RETRIEVAL_GENERATORS = [
  "brand-core",
  "audience-problem",
  "category-competitor",
  "rising-breaking",
  "outlier",
  "authority",
  "evergreen",
  "adjacent-exploration",
  "cross-source-confirmation",
] as const;

export type HunterRetrievalGenerator = (typeof HUNTER_RETRIEVAL_GENERATORS)[number];
export type HunterRetrievalMode = "lexical-search" | "semantic-expansion" | "corroboration";

export interface HunterRetrievalIntent {
  id: string;
  generator: HunterRetrievalGenerator;
  mode: HunterRetrievalMode;
  topicId: string;
  topicName: string;
  query: string;
  semanticQuery: string;
  audience: string;
  sourceClasses: string[];
  priority: "high" | "medium" | "exploration";
  maxResults: number;
  reason: string;
}


export interface HunterSemanticReference {
  entityId: string;
  similarity: number;
  provider: string;
  model: string;
}

export interface HunterSemanticExpansionPort {
  expand(input: { brandId: string; queryText: string; limit: number }): Promise<readonly HunterSemanticReference[]>;
}

export interface HunterHardNegative {
  key: string;
  source: "discovery-plan" | "preference-topic" | "preference-audience" | "preference-mechanism" | "preference-source-class";
  strength: number;
}

export interface HunterRetrievalPlan {
  schemaVersion: typeof HUNTER_RETRIEVAL_SCHEMA_VERSION;
  workspaceId: string;
  brandId: string;
  snapshotVersion: string;
  planVersion: string;
  explorationBudget: number;
  intents: HunterRetrievalIntent[];
  hardNegatives: HunterHardNegative[];
}

export interface BuildHunterRetrievalPlanInput {
  plan: BrandDiscoveryPlan;
  preferenceState?: BrandPreferenceState;
  maxIntents?: number;
  maxResultsPerIntent?: number;
}

export function buildHunterRetrievalPlan(input: BuildHunterRetrievalPlanInput): HunterRetrievalPlan {
  const maxIntents = boundedInteger(input.maxIntents ?? 48, "maxIntents", 1, 72);
  const maxResultsPerIntent = boundedInteger(input.maxResultsPerIntent ?? 8, "maxResultsPerIntent", 1, 20);
  const plan = input.plan;
  if (!plan.topics.length) throw new DomainValidationError("Retrieval planning requires at least one discovery topic");
  const preferenceState = input.preferenceState;
  if (preferenceState && (preferenceState.workspaceId !== plan.workspaceId || preferenceState.brandId !== plan.brandId)) {
    throw new DomainValidationError("Brand Preference State must belong to the same workspace and Brand");
  }

  const explorationBudget = preferenceState?.explorationBudget ?? 0.1;
  const intents: HunterRetrievalIntent[] = [];
  const usedIds = new Set<string>();
  for (const topic of plan.topics) {
    for (const intent of intentsForTopic(topic, preferenceState, maxResultsPerIntent)) {
      if (intents.length >= maxIntents) break;
      if (usedIds.has(intent.id)) continue;
      usedIds.add(intent.id);
      intents.push(intent);
    }
    if (intents.length >= maxIntents) break;
  }

  const adjacentTopics = preferenceState?.shortTerm.activeTopics
    .filter((item) => !plan.topics.some((topic) => sameText(topic.name, item.key)))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, Math.ceil(plan.topics.length * Math.max(0.05, explorationBudget))));

  for (const item of adjacentTopics ?? []) {
    if (intents.length >= maxIntents) break;
    const topic = nearestPlanTopic(item, plan.topics) ?? plan.topics[0]!;
    const id = uniqueIntentId("adjacent-exploration", topic.id, item.key);
    if (usedIds.has(id)) continue;
    usedIds.add(id);
    intents.push({
      id,
      generator: "adjacent-exploration",
      mode: "semantic-expansion",
      topicId: topic.id,
      topicName: topic.name,
      query: normalizeQuery(item.key + " " + topic.audience),
      semanticQuery: normalizeQuery(item.key + " " + topic.name + " " + topic.audience),
      audience: topic.audience,
      sourceClasses: [...topic.sourceClasses],
      priority: "exploration",
      maxResults: Math.min(6, maxResultsPerIntent),
      reason: "Explore a recent Brand-adjacent interest without replacing core Brand intent.",
    });
  }

  return {
    schemaVersion: HUNTER_RETRIEVAL_SCHEMA_VERSION,
    workspaceId: requiredText(plan.workspaceId, "workspaceId", 200),
    brandId: requiredText(plan.brandId, "brandId", 200),
    snapshotVersion: requiredText(plan.snapshotVersion, "snapshotVersion", 300),
    planVersion: requiredText(plan.planVersion, "planVersion", 300),
    explorationBudget,
    intents,
    hardNegatives: collectHardNegatives(plan, preferenceState),
  };
}

function intentsForTopic(topic: BrandDiscoveryTopic, preferenceState: BrandPreferenceState | undefined, maxResults: number): HunterRetrievalIntent[] {
  const entities = topic.entities.slice(0, 3).join(" ");
  const sourceClasses = [...topic.sourceClasses];
  const priority = topic.priority === "High" ? "high" as const : "medium" as const;
  const base = normalizeQuery(topic.name + " " + entities);
  const audience = requiredText(topic.audience, "topic audience", 240);
  const categoryEntity = topic.entities.find((value) => !sameText(value, topic.name)) ?? topic.name;
  const recentPositive = strongestPreference(preferenceState?.longTerm.topicWeights, topic.name);
  const preferenceHint = recentPositive ? recentPositive.key : topic.name;

  const make = (generator: HunterRetrievalGenerator, mode: HunterRetrievalMode, query: string, semanticQuery: string, reason: string, intentPriority: HunterRetrievalIntent["priority"] = priority, boundedMax = maxResults): HunterRetrievalIntent => ({
    id: uniqueIntentId(generator, topic.id, query),
    generator, mode, topicId: requiredText(topic.id, "topic id", 120), topicName: requiredText(topic.name, "topic name", 180),
    query: normalizeQuery(query), semanticQuery: normalizeQuery(semanticQuery), audience, sourceClasses,
    priority: intentPriority, maxResults: boundedInteger(boundedMax, "intent.maxResults", 1, 20), reason,
  });

  return [
    make("brand-core", "lexical-search", base + " " + audience, topic.name + " " + preferenceHint + " " + audience, "Retrieve direct Brand-topic signals aligned to the declared audience."),
    make("audience-problem", "lexical-search", topic.name + " " + audience + " problems questions mistakes", topic.name + " audience pain points objections questions " + audience, "Look for repeated audience problems, objections and questions."),
    make("category-competitor", "lexical-search", categoryEntity + " " + topic.name + " category examples competitors", topic.name + " category movement comparable brands public examples", "Observe category movement and comparable public activity without copying competitors."),
    make("rising-breaking", "lexical-search", topic.name + " latest emerging rising new", topic.name + " recent acceleration emerging discussion", "Search for newly accelerating or emerging discussion.", priority, Math.min(maxResults, 10)),
    make("outlier", "lexical-search", topic.name + " unusual performance breakout case study", topic.name + " creator-relative outlier category-relative outlier", "Find public examples that may be performing unusually well relative to their context."),
    make("authority", "lexical-search", topic.name + " official research report data", topic.name + " primary source research evidence", "Increase authoritative and primary-source recall."),
    make("evergreen", "lexical-search", topic.name + " guide checklist common mistakes questions", topic.name + " durable educational questions checklist", "Retrieve durable, recurring educational opportunities.", priority, Math.min(maxResults, 6)),
    make("adjacent-exploration", "semantic-expansion", topic.name + " adjacent topics " + audience, topic.name + " " + audience + " adjacent related interests", "Expand semantically around the core topic within a bounded exploration budget.", "exploration", Math.min(maxResults, 6)),
    make("cross-source-confirmation", "corroboration", topic.name + " corroboration", topic.name + " independent cross-source confirmation", "Measure whether independently retrieved signals converge on the same subject.", priority, Math.min(maxResults, 8)),
  ];
}

function collectHardNegatives(plan: BrandDiscoveryPlan, preferenceState?: BrandPreferenceState): HunterHardNegative[] {
  const result: HunterHardNegative[] = [];
  const seen = new Set<string>();
  const add = (key: string, source: HunterHardNegative["source"], strength: number) => {
    const normalized = key.trim(); if (!normalized) return;
    const identity = source + ":" + normalized.toLowerCase(); if (seen.has(identity)) return;
    seen.add(identity); result.push({ key: normalized, source, strength: clamp01(strength) });
  };
  for (const key of plan.excludedTopics) add(key, "discovery-plan", 1);
  for (const item of preferenceState?.negatives.topics ?? []) addNegative(add, item, "preference-topic");
  for (const item of preferenceState?.negatives.audiences ?? []) addNegative(add, item, "preference-audience");
  for (const item of preferenceState?.negatives.mechanisms ?? []) addNegative(add, item, "preference-mechanism");
  for (const item of preferenceState?.negatives.sourceClasses ?? []) addNegative(add, item, "preference-source-class");
  return result.filter((item) => item.source === "discovery-plan" || item.strength >= 0.65)
    .sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key)).slice(0, 80);
}

function addNegative(add: (key: string, source: HunterHardNegative["source"], strength: number) => void, item: NegativePreference, source: HunterHardNegative["source"]): void { add(item.key, source, item.strength); }
function strongestPreference(values: readonly PreferenceWeight[] | undefined, topicName: string): PreferenceWeight | undefined { return values?.filter((item) => tokenOverlap(item.key, topicName) > 0).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))[0]; }
function nearestPlanTopic(item: PreferenceWeight, topics: readonly BrandDiscoveryTopic[]): BrandDiscoveryTopic | undefined { return [...topics].sort((a, b) => tokenOverlap(b.name, item.key) - tokenOverlap(a.name, item.key) || a.name.localeCompare(b.name))[0]; }
function tokenOverlap(a: string, b: string): number { const left=tokens(a), right=tokens(b); let score=0; for (const token of left) if (right.has(token)) score += 1; return score; }
function tokens(value: string): Set<string> { return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((item) => item.length > 1) ?? []); }
function uniqueIntentId(generator: HunterRetrievalGenerator, topicId: string, query: string): string { const suffix=query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,48); return generator + ":" + topicId + ":" + (suffix || "intent"); }
function normalizeQuery(value: string): string { const normalized=value.replace(/\s+/g, " ").trim(); if (!normalized) throw new DomainValidationError("retrieval query is required"); return normalized.slice(0,500); }
function requiredText(value: unknown, field: string, max: number): string { if (typeof value !== "string") throw new DomainValidationError(field + " is required"); const normalized=value.trim(); if (!normalized) throw new DomainValidationError(field + " is required"); if (normalized.length > max) throw new DomainValidationError(field + " is too long"); return normalized; }
function boundedInteger(value: unknown, field: string, min: number, max: number): number { if (!Number.isInteger(value) || (value as number)<min || (value as number)>max) throw new DomainValidationError(field + " must be an integer from " + min + " to " + max); return value as number; }
function sameText(a: string, b: string): boolean { return a.trim().toLowerCase() === b.trim().toLowerCase(); }
function clamp01(value: number): number { if (!Number.isFinite(value)) return 0; return Math.max(0,Math.min(1,value)); }