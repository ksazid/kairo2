import { createHash } from "node:crypto";
import type { BrandBrainFieldDto } from "@kairo/contracts";

export type SectorPackId = "generic" | "ai-tech" | "umrah" | "motorcycles" | "ias-upsc";

export interface BrandBrainV2Snapshot {
  sector?: string;
  subsector?: string;
  products: string[];
  offers: string[];
  authorityAreas: string[];
  coreTopics: string[];
  relatedTopics: string[];
  excludedTopics: string[];
  preferredChannels: string[];
  preferredFormats: string[];
  visualPatterns: string[];
  terminology: string[];
  competitors: string[];
  geography: string[];
  languages: string[];
  evergreenTopics: string[];
  freshnessTopics: string[];
}

export interface TopicGraphNode {
  topic: string;
  aliases: string[];
  parent?: string;
  priority: number;
  confidence?: number;
  sourceIds: string[];
  freshness: "evergreen" | "fresh" | "mixed" | "unspecified";
  freshnessHorizon?: "evergreen" | "7d" | "30d" | "90d";
  preferredSources: string[];
  preferred: boolean;
  excluded: boolean;
  authority: boolean;
  authorityLevel: "none" | "developing" | "established";
  origin: "brand-brain" | "sector-pack";
}

export interface BrandIntelligenceTopicGraph {
  schemaVersion: 2;
  sectorPack: SectorPackId;
  nodes: TopicGraphNode[];
  fingerprint: string;
  interestGraph: Array<{ topic: string; weight: number }>;
  exclusions: string[];
  explorationTopics: string[];
  authorityZones: string[];
  performanceWeights: Record<string, number>;
}

export interface SectorPackTopicSeed {
  topic: string;
  aliases?: string[];
  parent?: string;
  priority?: number;
  freshness?: TopicGraphNode["freshness"];
}

export interface SectorPack {
  id: SectorPackId;
  topics: SectorPackTopicSeed[];
}

const FIELD_ALIASES: Record<string, keyof BrandBrainV2Snapshot> = {
  sector: "sector",
  category: "sector",
  subsector: "subsector",
  products: "products",
  offerings: "products",
  offers: "offers",
  authorityareas: "authorityAreas",
  authority: "authorityAreas",
  coretopics: "coreTopics",
  relatedtopics: "relatedTopics",
  excludedtopics: "excludedTopics",
  topicsavoid: "excludedTopics",
  preferredchannels: "preferredChannels",
  channels: "preferredChannels",
  preferredformats: "preferredFormats",
  formats: "preferredFormats",
  visualpatterns: "visualPatterns",
  visualstyles: "visualPatterns",
  terminology: "terminology",
  competitors: "competitors",
  geography: "geography",
  language: "languages",
  languages: "languages",
  identitysector: "sector",
  identitycategory: "sector",
  identitysubsector: "subsector",
  identityproductsservices: "products",
  identityoffers: "offers",
  contentauthorityareas: "authorityAreas",
  contentcoretopics: "coreTopics",
  contentpreferredtopics: "coreTopics",
  contentpillars: "coreTopics",
  contentrelatedtopics: "relatedTopics",
  boundariesexcludedtopics: "excludedTopics",
  contentchannels: "preferredChannels",
  contentpreferredformats: "preferredFormats",
  contentvisualpatterns: "visualPatterns",
  contentvisualdirection: "visualPatterns",
  contentterminology: "terminology",
  contentcompetitorswatchlist: "competitors",
  identitygeography: "geography",
  identitylanguage: "languages",
  contentevergreentopics: "evergreenTopics",
  contentfreshnesstopics: "freshnessTopics",
  evergreentopics: "evergreenTopics",
  freshnesstopics: "freshnessTopics",
};

export const SECTOR_PACKS: Record<SectorPackId, SectorPack> = {
  generic: { id: "generic", topics: [] },
  "ai-tech": {
    id: "ai-tech",
    topics: [
      { topic: "artificial intelligence", aliases: ["AI"], priority: 0.35, freshness: "mixed" },
      { topic: "software engineering", priority: 0.3, freshness: "mixed" },
      { topic: "technology trends", priority: 0.25, freshness: "fresh" },
    ],
  },
  umrah: {
    id: "umrah",
    topics: [
      { topic: "Umrah planning", aliases: ["pilgrimage planning"], priority: 0.35, freshness: "mixed" },
      { topic: "Umrah travel guidance", priority: 0.3, freshness: "mixed" },
      { topic: "pilgrim preparation", priority: 0.25, freshness: "evergreen" },
    ],
  },
  motorcycles: {
    id: "motorcycles",
    topics: [
      { topic: "motorcycles", aliases: ["motorbikes"], priority: 0.35, freshness: "mixed" },
      { topic: "motorcycle ownership", priority: 0.3, freshness: "evergreen" },
      { topic: "motorcycle products", priority: 0.25, freshness: "mixed" },
    ],
  },
  "ias-upsc": {
    id: "ias-upsc",
    topics: [
      { topic: "UPSC preparation", aliases: ["IAS preparation", "civil services preparation"], priority: 0.35, freshness: "mixed" },
      { topic: "current affairs", priority: 0.3, freshness: "fresh" },
      { topic: "civil services syllabus", priority: 0.25, freshness: "evergreen" },
    ],
  },
};

export function buildBrandBrainV2(fields: readonly BrandBrainFieldDto[]): BrandBrainV2Snapshot {
  const snapshot: BrandBrainV2Snapshot = {
    products: [], offers: [], authorityAreas: [], coreTopics: [], relatedTopics: [], excludedTopics: [],
    preferredChannels: [], preferredFormats: [], visualPatterns: [], terminology: [], competitors: [],
    geography: [], languages: [], evergreenTopics: [], freshnessTopics: [],
  };
  const ordered = [...fields].sort((a, b) => stateRank(a.state) - stateRank(b.state) || a.updatedAt.localeCompare(b.updatedAt));
  for (const field of ordered) {
    if (field.state === "stale") continue;
    const key = FIELD_ALIASES[normalizeKey(field.fieldKey)];
    if (!key) continue;
    const values = parseValues(field.value);
    if (key === "sector" || key === "subsector") {
      const value = values[0];
      if (value) snapshot[key] = value;
    } else {
      snapshot[key] = dedupe([...(snapshot[key] as string[]), ...values]);
    }
  }
  return snapshot;
}

export function buildTopicGraph(
  fields: readonly BrandBrainFieldDto[],
  sectorPackId: SectorPackId = "generic",
  sectorPacks: Readonly<Record<SectorPackId, SectorPack>> = SECTOR_PACKS,
): BrandIntelligenceTopicGraph {
  const brain = buildBrandBrainV2(fields);
  const excluded = new Set(brain.excludedTopics.map(normalizeTopic));
  const preferred = new Set([...brain.coreTopics, ...brain.relatedTopics].map(normalizeTopic));
  const authority = new Set(brain.authorityAreas.map(normalizeTopic));
  const evergreen = new Set(brain.evergreenTopics.map(normalizeTopic));
  const fresh = new Set(brain.freshnessTopics.map(normalizeTopic));
  const evidenceByTopic = evidenceIndex(fields);
  const nodes = new Map<string, TopicGraphNode>();

  const addBrandTopic = (topic: string, priority: number) => {
    const normalized = normalizeTopic(topic);
    if (!normalized) return;
    const evidence = evidenceByTopic.get(normalized);
    nodes.set(normalized, {
      topic: cleanTopic(topic), aliases: [], priority, ...(evidence?.confidence !== undefined ? { confidence: evidence.confidence } : {}),
      sourceIds: evidence?.sourceIds ?? [], freshness: freshnessOf(normalized, evergreen, fresh), ...freshnessHorizon(freshnessOf(normalized, evergreen, fresh)), preferredSources: [], preferred: preferred.has(normalized),
      excluded: excluded.has(normalized), authority: authority.has(normalized), authorityLevel: authority.has(normalized) ? "established" : "none", origin: "brand-brain",
    });
  };

  brain.coreTopics.forEach((topic) => addBrandTopic(topic, 1));
  brain.authorityAreas.forEach((topic) => addBrandTopic(topic, 0.95));
  brain.relatedTopics.forEach((topic) => addBrandTopic(topic, 0.75));
  brain.evergreenTopics.forEach((topic) => addBrandTopic(topic, 0.65));
  brain.freshnessTopics.forEach((topic) => addBrandTopic(topic, 0.7));
  brain.excludedTopics.forEach((topic) => addBrandTopic(topic, 1));

  const pack = sectorPacks[sectorPackId] ?? sectorPacks.generic;
  for (const seed of pack.topics) {
    const normalized = normalizeTopic(seed.topic);
    if (!normalized || excluded.has(normalized)) continue;
    const existing = nodes.get(normalized);
    if (existing) {
      existing.aliases = dedupe([...existing.aliases, ...(seed.aliases ?? [])]).filter((alias) => normalizeTopic(alias) !== normalized);
      continue;
    }
    nodes.set(normalized, {
      topic: cleanTopic(seed.topic), aliases: dedupe(seed.aliases ?? []).filter((alias) => normalizeTopic(alias) !== normalized),
      ...(seed.parent ? { parent: cleanTopic(seed.parent) } : {}), priority: clamp(seed.priority ?? 0.25), sourceIds: [],
      freshness: seed.freshness ?? "unspecified", ...freshnessHorizon(seed.freshness ?? "unspecified"), preferredSources: [], preferred: false, excluded: false, authority: false, authorityLevel: "none", origin: "sector-pack",
    });
  }

  for (const normalized of excluded) {
    const node = nodes.get(normalized);
    if (node) { node.excluded = true; node.preferred = false; node.priority = 1; }
  }

  const sorted = [...nodes.values()].map((node) => ({ ...node, aliases: dedupe(node.aliases).sort(compareText), sourceIds: dedupe(node.sourceIds).sort(compareText) }))
    .sort((a, b) => Number(b.excluded) - Number(a.excluded) || b.priority - a.priority || compareText(a.topic, b.topic));
  const interestGraph = sorted.filter((node) => !node.excluded).map((node) => ({ topic: node.topic, weight: node.priority }));
  const exclusions = sorted.filter((node) => node.excluded).map((node) => node.topic);
  const explorationTopics = sorted.filter((node) => node.origin === "sector-pack" && !node.excluded).map((node) => node.topic);
  const authorityZones = sorted.filter((node) => node.authority).map((node) => node.topic);
  const performanceWeights: Record<string, number> = {};
  const canonical = JSON.stringify({ schemaVersion: 2, sectorPack: pack.id, nodes: sorted, interestGraph, exclusions, explorationTopics, authorityZones, performanceWeights });
  return { schemaVersion: 2, sectorPack: pack.id, nodes: sorted, interestGraph, exclusions, explorationTopics, authorityZones, performanceWeights, fingerprint: createHash("sha256").update(canonical).digest("hex") };
}

export function nextGraphVersion(current: { version: number; fingerprint: string } | undefined, nextFingerprint: string): number {
  if (!current) return 1;
  return current.fingerprint === nextFingerprint ? current.version : current.version + 1;
}

function evidenceIndex(fields: readonly BrandBrainFieldDto[]) {
  const result = new Map<string, { sourceIds: string[]; confidence?: number }>();
  for (const field of fields) {
    if (field.state === "stale") continue;
    const key = FIELD_ALIASES[normalizeKey(field.fieldKey)];
    if (!["coreTopics", "relatedTopics", "excludedTopics", "authorityAreas", "evergreenTopics", "freshnessTopics"].includes(String(key))) continue;
    for (const value of parseValues(field.value)) {
      const normalized = normalizeTopic(value);
      if (!normalized) continue;
      const previous = result.get(normalized);
      result.set(normalized, { sourceIds: dedupe([...(previous?.sourceIds ?? []), ...field.sourceIds]) });
    }
  }
  return result;
}
function freshnessOf(topic: string, evergreen: Set<string>, fresh: Set<string>): TopicGraphNode["freshness"] {
  if (evergreen.has(topic) && fresh.has(topic)) return "mixed";
  if (fresh.has(topic)) return "fresh";
  if (evergreen.has(topic)) return "evergreen";
  return "unspecified";
}
function freshnessHorizon(value: TopicGraphNode["freshness"]): Pick<TopicGraphNode, "freshnessHorizon"> | {} { if (value === "evergreen") return { freshnessHorizon: "evergreen" }; if (value === "fresh") return { freshnessHorizon: "7d" }; if (value === "mixed") return { freshnessHorizon: "30d" }; return {}; }
function stateRank(state: BrandBrainFieldDto["state"]) { return state === "confirmed" ? 2 : state === "inferred" ? 1 : 0; }
function parseValues(value: string): string[] {
  const text = value.trim(); if (!text) return [];
  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return dedupe(parsed.filter((v): v is string => typeof v === "string").map(cleanTopic).filter(Boolean)); } catch { /* plain text */ }
  return dedupe(text.split(/\r?\n|[,;|•]+/).map(cleanTopic).filter(Boolean));
}
function normalizeKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function normalizeTopic(value: string) { return cleanTopic(value).toLowerCase(); }
function cleanTopic(value: string) { return value.trim().replace(/\s+/g, " "); }
function dedupe(values: readonly string[]) { const seen = new Set<string>(); return values.filter((value) => { const key = normalizeTopic(value); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function compareText(a: string, b: string) { return a.localeCompare(b, "en", { sensitivity: "base" }); }
