import type { BrandBrainFieldDto } from "@kairo/contracts";
import { DomainValidationError } from "./index";

export type DiscoverySourceKey = string;
export type DiscoverySourceCapability = "discovery" | "research" | "verification";

export interface BrandIntelligenceProfile {
  sector?: string;
  subsector?: string;
  geographies: string[];
  languages: string[];
  audiences: string[];
  topics: string[];
  excludedTopics: string[];
  goals: string[];
  /** Persisted Discovery Plan source classes/preferences. Sector packs remain the safe default. */
  sourceClasses?: string[];
}

export interface DiscoverySourceDefinition {
  key: DiscoverySourceKey;
  capabilities: readonly DiscoverySourceCapability[];
  enabled: boolean;
  requiresCredential: boolean;
  maxQueriesPerRun: number;
}

export interface SectorIntelligencePack {
  id: string;
  version: string;
  sector: string;
  subsectors: readonly string[];
  topics: readonly string[];
  sourceWeights: Readonly<Record<DiscoverySourceKey, number>>;
  queryTemplates: readonly string[];
}

export interface BrandSourcePolicyEntry {
  source: DiscoverySourceKey;
  enabled: boolean;
  weight: number;
  maxQueries: number;
  rationale: string;
}

export interface BrandSourcePolicy {
  packId: string;
  packVersion: string;
  entries: BrandSourcePolicyEntry[];
}

export interface SourceQueryPlanItem {
  source: DiscoverySourceKey;
  query: string;
  weight: number;
  rationale: string;
}

const SECTOR_KEYS = new Set(["sector", "category", "brand-category"]);
const SUBSECTOR_KEYS = new Set(["subsector", "sub-sector", "subcategory", "sub-category"]);
const GEOGRAPHY_KEYS = /(geograph|location|market|region|countr)/i;
const LANGUAGE_KEYS = /language/i;
const TOPIC_KEYS = /(topic|pillar)/i;
const EXCLUDED_TOPIC_KEYS = /(excluded|prohibited|avoid|sensitive).*(topic|subject)|(topic|subject).*(excluded|prohibited|avoid|sensitive)/i;

const SOURCE_ALIASES: Readonly<Record<string, DiscoverySourceKey>> = {
  "agent reach": "agent-reach",
  "agent-reach": "agent-reach",
  bluesky: "bluesky",
  "blue sky": "bluesky",
  github: "github",
  "git hub": "github",
  "hacker news": "hacker-news",
  "hacker-news": "hacker-news",
  hn: "hacker-news",
  rss: "rss",
  "rss feed": "rss",
  "rss feeds": "rss",
  youtube: "youtube",
  "you tube": "youtube",
};

const SOURCE_CLASS_PREFERENCES: Readonly<Record<string, readonly DiscoverySourceKey[]>> = {
  "official sources": ["agent-reach", "rss"],
  "industry news": ["agent-reach", "rss"],
  "local news": ["agent-reach", "rss"],
  news: ["agent-reach", "rss"],
  "general web": ["agent-reach", "rss"],
  web: ["agent-reach", "rss"],
  "community discussions": ["agent-reach", "bluesky"],
  community: ["agent-reach", "bluesky"],
  social: ["agent-reach", "bluesky"],
  instagram: ["agent-reach", "bluesky"],
  linkedin: ["agent-reach", "bluesky"],
  video: ["youtube"],
};

export function projectBrandIntelligenceProfile(fields: readonly BrandBrainFieldDto[]): BrandIntelligenceProfile {
  const active = fields.filter((field) => field.state !== "stale");
  const identity = active.filter((field) => field.section === "identity");
  const sector = firstValue(identity, (field) => SECTOR_KEYS.has(fieldKeyLeaf(field.fieldKey)));
  const subsector = firstValue(identity, (field) => SUBSECTOR_KEYS.has(fieldKeyLeaf(field.fieldKey)));

  const geographies = collectValues(active.filter((field) => field.section === "identity" && GEOGRAPHY_KEYS.test(field.fieldKey)));
  const languages = collectValues(active.filter((field) =>
    (field.section === "identity" || field.section === "voice") && LANGUAGE_KEYS.test(field.fieldKey),
  ));
  const audiences = collectValues(active.filter((field) => field.section === "audience"));
  const topics = collectValues(active.filter((field) => field.section === "content-strategy" && TOPIC_KEYS.test(field.fieldKey)));
  const excludedTopics = collectValues(active.filter((field) => field.section === "boundaries" && EXCLUDED_TOPIC_KEYS.test(field.fieldKey)));
  const goals = collectValues(active.filter((field) => field.section === "goals"));

  return {
    ...(sector ? { sector } : {}),
    ...(subsector ? { subsector } : {}),
    geographies,
    languages,
    audiences,
    topics,
    excludedTopics,
    goals,
  };
}

export function validateSectorIntelligencePack(pack: SectorIntelligencePack): SectorIntelligencePack {
  requireText(pack?.id, "Sector pack id");
  requireText(pack?.version, "Sector pack version");
  requireText(pack?.sector, "Sector pack sector");
  if (!Array.isArray(pack.subsectors)) throw new DomainValidationError("Sector pack subsectors must be an array");
  if (!Array.isArray(pack.topics)) throw new DomainValidationError("Sector pack topics must be an array");
  if (!pack.sourceWeights || typeof pack.sourceWeights !== "object" || Array.isArray(pack.sourceWeights)) {
    throw new DomainValidationError("Sector pack sourceWeights must be an object");
  }
  if (!Array.isArray(pack.queryTemplates) || !pack.queryTemplates.length) {
    throw new DomainValidationError("Sector pack requires at least one query template");
  }
  for (const template of pack.queryTemplates) requireText(template, "Sector pack query template");
  for (const [source, weight] of Object.entries(pack.sourceWeights)) {
    requireText(source, "Sector pack source key");
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new DomainValidationError(`Sector pack source weight for ${source} must be from 0 to 1`);
    }
  }
  return pack;
}

export function resolveBrandSourcePolicy(
  profile: BrandIntelligenceProfile,
  packInput: SectorIntelligencePack,
  sourceRegistry: readonly DiscoverySourceDefinition[],
): BrandSourcePolicy {
  validateProfile(profile);
  const pack = validateSectorIntelligencePack(packInput);
  const registry = validateSourceRegistry(sourceRegistry);
  const registryKeys = new Set(registry.map((source) => source.key));
  for (const source of Object.keys(pack.sourceWeights)) {
    if (!registryKeys.has(source)) throw new DomainValidationError(`Sector pack references unknown source ${source}`);
  }
  const directives = sourceDirectives(profile.sourceClasses ?? [], registryKeys);

  const entries = registry.map((source): BrandSourcePolicyEntry => {
    const baseWeight = pack.sourceWeights[source.key] ?? 0;
    const explicitlyEnabled = directives.explicit.has(source.key);
    const preferred = directives.preferred.has(source.key);
    const denied = directives.denied.has(source.key);
    const configuredWeight = explicitlyEnabled && baseWeight <= 0 ? 0.65 : baseWeight;
    const adjustedWeight = preferred && configuredWeight > 0 ? Math.min(1, configuredWeight + 0.12) : configuredWeight;
    const enabled = source.enabled && !denied && adjustedWeight > 0;
    const weight = enabled ? adjustedWeight : 0;

    let rationale: string;
    if (!source.enabled) {
      rationale = `Source registry disables ${source.key} regardless of sector or Discovery Plan preferences.`;
    } else if (denied) {
      rationale = `Discovery Plan explicitly excludes ${source.key}.`;
    } else if (enabled && explicitlyEnabled && baseWeight <= 0) {
      rationale = `Discovery Plan explicitly enables ${source.key} at weight ${weight.toFixed(2)} over ${pack.id}@${pack.version} default.`;
    } else if (enabled && preferred) {
      rationale = `Discovery Plan prioritizes ${source.key}; ${pack.id}@${pack.version} weight becomes ${weight.toFixed(2)} within registry budget ${source.maxQueriesPerRun}.`;
    } else if (enabled) {
      rationale = `${pack.id}@${pack.version} assigns ${source.key} weight ${weight.toFixed(2)} within registry budget ${source.maxQueriesPerRun}.`;
    } else {
      rationale = `${pack.id}@${pack.version} disables ${source.key} with zero source weight.`;
    }

    return {
      source: source.key,
      enabled,
      weight,
      maxQueries: source.maxQueriesPerRun,
      rationale,
    };
  });

  return { packId: pack.id, packVersion: pack.version, entries };
}

export function planSourceQueries(
  profile: BrandIntelligenceProfile,
  packInput: SectorIntelligencePack,
  policy: BrandSourcePolicy,
  sourceRegistry: readonly DiscoverySourceDefinition[],
): SourceQueryPlanItem[] {
  validateProfile(profile);
  const pack = validateSectorIntelligencePack(packInput);
  if (policy.packId !== pack.id || policy.packVersion !== pack.version) {
    throw new DomainValidationError("Source policy does not match Sector Intelligence Pack version");
  }

  const registry = validateSourceRegistry(sourceRegistry);
  const registryByKey = new Map(registry.map((source) => [source.key, source]));
  const excluded = new Set(profile.excludedTopics.map(normalizeComparable).filter(Boolean));
  const brandTopics = uniqueText(profile.topics).filter((topic) => !excluded.has(normalizeComparable(topic)));
  const fallbackTopics = uniqueText(pack.topics).filter((topic) => !excluded.has(normalizeComparable(topic)));
  const topics = brandTopics.length ? brandTopics : fallbackTopics;
  if (!topics.length) return [];

  const entries = [...policy.entries]
    .filter((entry) => entry.enabled && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));
  const result: SourceQueryPlanItem[] = [];

  for (const entry of entries) {
    const source = registryByKey.get(entry.source);
    if (!source || !source.enabled || !source.capabilities.includes("discovery")) continue;
    const ceiling = Math.min(entry.maxQueries, source.maxQueriesPerRun);
    if (ceiling <= 0) continue;

    const seen = new Set<string>();
    for (const template of pack.queryTemplates) {
      const templateUsesTopic = template.includes("{topic}");
      const candidates = templateUsesTopic ? topics : [topics[0]!];
      for (const topic of candidates) {
        const query = renderQuery(template, profile, pack, topic);
        if (!query || containsExcludedTopic(query, excluded)) continue;
        const key = normalizeComparable(query);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push({ source: entry.source, query, weight: entry.weight, rationale: entry.rationale });
        if (seen.size >= ceiling) break;
      }
      if (seen.size >= ceiling) break;
    }
  }

  return result;
}

function sourceDirectives(sourceClasses: readonly string[], registryKeys: ReadonlySet<string>) {
  const preferred = new Set<DiscoverySourceKey>();
  const explicit = new Set<DiscoverySourceKey>();
  const denied = new Set<DiscoverySourceKey>();

  for (const value of sourceClasses) {
    const normalized = normalizeSourceLabel(value);
    if (!normalized) continue;
    const negative = /^(?:no|exclude|without)\s+/.test(normalized) || normalized.startsWith("-") || normalized.startsWith("!");
    const label = negative
      ? normalized.replace(/^(?:no|exclude|without)\s+/, "").replace(/^[-!]+/, "").trim()
      : normalized;
    const provider = SOURCE_ALIASES[label];
    if (provider && registryKeys.has(provider)) {
      if (negative) denied.add(provider);
      else {
        explicit.add(provider);
        preferred.add(provider);
      }
      continue;
    }
    if (negative) continue;
    for (const source of SOURCE_CLASS_PREFERENCES[label] ?? []) {
      if (registryKeys.has(source)) preferred.add(source);
    }
  }

  for (const source of denied) {
    explicit.delete(source);
    preferred.delete(source);
  }
  return { preferred, explicit, denied };
}

function renderQuery(
  template: string,
  profile: BrandIntelligenceProfile,
  pack: SectorIntelligencePack,
  topic: string,
): string {
  const geography = uniqueText(profile.geographies).find((value) => normalizeComparable(value) !== "global") ?? "";
  const audience = uniqueText(profile.audiences)[0] ?? "";
  const subsector = profile.subsector?.trim() || pack.subsectors[0]?.trim() || "";
  return template
    .replaceAll("{topic}", topic)
    .replaceAll("{geography}", geography)
    .replaceAll("{audience}", audience)
    .replaceAll("{sector}", pack.sector)
    .replaceAll("{subsector}", subsector)
    .replace(/\s+/g, " ")
    .trim();
}

function containsExcludedTopic(query: string, excluded: ReadonlySet<string>): boolean {
  const normalized = normalizeComparable(query);
  for (const topic of excluded) {
    if (topic && normalized.includes(topic)) return true;
  }
  return false;
}

function validateProfile(profile: BrandIntelligenceProfile): void {
  if (!profile || typeof profile !== "object") throw new DomainValidationError("Brand Intelligence Profile is required");
  for (const [name, values] of Object.entries({
    geographies: profile.geographies,
    languages: profile.languages,
    audiences: profile.audiences,
    topics: profile.topics,
    excludedTopics: profile.excludedTopics,
    goals: profile.goals,
  })) {
    if (!Array.isArray(values)) throw new DomainValidationError(`Brand Intelligence Profile ${name} must be an array`);
  }
  if (profile.sourceClasses !== undefined) {
    if (!Array.isArray(profile.sourceClasses) || profile.sourceClasses.some((value) => typeof value !== "string" || !value.trim())) {
      throw new DomainValidationError("Brand Intelligence Profile sourceClasses must be a list of non-empty strings");
    }
  }
}

function validateSourceRegistry(sourceRegistry: readonly DiscoverySourceDefinition[]): readonly DiscoverySourceDefinition[] {
  if (!Array.isArray(sourceRegistry) || !sourceRegistry.length) throw new DomainValidationError("Source Registry must not be empty");
  const seen = new Set<string>();
  for (const source of sourceRegistry) {
    requireText(source.key, "Source Registry key");
    if (seen.has(source.key)) throw new DomainValidationError(`Duplicate Source Registry key ${source.key}`);
    seen.add(source.key);
    const capabilities = source.capabilities;
    if (!Array.isArray(capabilities) || !capabilities.length || capabilities.some((capability: DiscoverySourceCapability) => !["discovery", "research", "verification"].includes(capability))) {
      throw new DomainValidationError(`Source Registry capabilities are invalid for ${source.key}`);
    }
    if (!Number.isInteger(source.maxQueriesPerRun) || source.maxQueriesPerRun < 0 || source.maxQueriesPerRun > 100) {
      throw new DomainValidationError(`Source Registry query budget is invalid for ${source.key}`);
    }
  }
  return sourceRegistry;
}

function firstValue(fields: readonly BrandBrainFieldDto[], predicate: (field: BrandBrainFieldDto) => boolean): string | undefined {
  for (const field of fields) {
    if (!predicate(field)) continue;
    const value = field.value.trim();
    if (value) return value;
  }
  return undefined;
}

function collectValues(fields: readonly BrandBrainFieldDto[]): string[] {
  return uniqueText(fields.flatMap((field) => splitExplicitList(field.value)));
}

function splitExplicitList(value: string): string[] {
  return value.split(/[\n,;|]+/g).map((item) => item.trim()).filter(Boolean);
}

function uniqueText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeComparable(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSourceLabel(value: string): string {
  return value.toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${label} is required`);
  return value.trim();
}
function fieldKeyLeaf(value: string) { return value.toLowerCase().split(".").at(-1) ?? value.toLowerCase(); }
