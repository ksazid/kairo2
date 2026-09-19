import { describe, expect, it } from "vitest";
import type { BrandBrainFieldDto } from "@kairo/contracts";
import { DomainValidationError } from "./index";
import {
  planSourceQueries,
  projectBrandIntelligenceProfile,
  resolveBrandSourcePolicy,
  validateSectorIntelligencePack,
} from "./source-policy";
import { SECTOR_INTELLIGENCE_PACKS, selectSectorIntelligencePack } from "./sector-packs";
import { DEFAULT_SOURCE_REGISTRY } from "./source-registry";

function pack(id: keyof typeof SECTOR_INTELLIGENCE_PACKS) {
  return SECTOR_INTELLIGENCE_PACKS[id];
}

function profile(overrides: Partial<ReturnType<typeof projectBrandIntelligenceProfile>> = {}) {
  return {
    geographies: ["global"],
    languages: ["English"],
    audiences: ["technical founders"],
    topics: ["agents", "architecture"],
    excludedTopics: [],
    goals: ["educate"],
    ...overrides,
  };
}

function policyEntry(policy: ReturnType<typeof resolveBrandSourcePolicy>, source: string) {
  const entry = policy.entries.find((item) => item.source === source);
  if (!entry) throw new Error(`Missing ${source} policy entry`);
  return entry;
}

describe("VS-12A sector-aware source policy", () => {
  it("projects only active Brand Brain intelligence and does not invent missing classification", () => {
    const fields: BrandBrainFieldDto[] = [
      field("identity", "category", "Developer Technology"),
      field("identity", "geography", "Malta, Europe"),
      field("voice", "language", "English"),
      field("audience", "primary-audience", "Technical founders; SaaS builders"),
      field("content-strategy", "preferred-topics", "AI agents\nsoftware architecture"),
      field("boundaries", "excluded-topics", "political endorsements, medical advice"),
      field("goals", "primary-goal", "Educate founders"),
      field("identity", "sector", "stale value", "stale"),
      field("identity", "identity.subsector", "AI infrastructure"),
    ];

    expect(projectBrandIntelligenceProfile(fields)).toEqual({
      sector: "Developer Technology",
      subsector: "AI infrastructure",
      geographies: ["Malta", "Europe"],
      languages: ["English"],
      audiences: ["Technical founders", "SaaS builders"],
      topics: ["AI agents", "software architecture"],
      excludedTopics: ["political endorsements", "medical advice"],
      goals: ["Educate founders"],
    });

    expect(projectBrandIntelligenceProfile([])).toEqual({
      geographies: [],
      languages: [],
      audiences: [],
      topics: [],
      excludedTopics: [],
      goals: [],
    });
  });

  it("selects proof-sector packs and hospitality from metadata instead of resolver branches", () => {
    expect(selectSectorIntelligencePack(profile({ sector: "Developer Technology" }))?.id).toBe("ai-technology");
    expect(selectSectorIntelligencePack(profile({ sector: "Religious Travel" }))?.id).toBe("umrah-religious-travel");
    expect(selectSectorIntelligencePack(profile({ sector: "Motorcycles" }))?.id).toBe("motorcycles");
    expect(selectSectorIntelligencePack(profile({ sector: "IAS" }))?.id).toBe("ias-upsc-education");
    expect(selectSectorIntelligencePack(profile({ sector: "Restaurant" }))?.id).toBe("hospitality");
    expect(selectSectorIntelligencePack(profile({ sector: undefined, subsector: undefined })).id).toBe("generic");
  });

  it("uses the same resolver to produce a technology policy with Hacker News, YouTube and RSS weighted high", () => {
    const policy = resolveBrandSourcePolicy(profile({ sector: "Developer Technology" }), pack("ai-technology"), DEFAULT_SOURCE_REGISTRY);

    expect(policyEntry(policy, "hacker-news")).toMatchObject({ enabled: true });
    expect(policyEntry(policy, "hacker-news").weight).toBeGreaterThanOrEqual(0.9);
    expect(policyEntry(policy, "youtube").weight).toBeGreaterThanOrEqual(0.85);
    expect(policyEntry(policy, "rss").weight).toBeGreaterThanOrEqual(0.9);
  });

  it("disables Hacker News exactly for Umrah while keeping RSS and YouTube strong", () => {
    const policy = resolveBrandSourcePolicy(
      profile({ sector: "Religious Travel", topics: ["Umrah visa", "pilgrimage guidance"] }),
      pack("umrah-religious-travel"),
      DEFAULT_SOURCE_REGISTRY,
    );

    expect(policyEntry(policy, "hacker-news")).toMatchObject({ enabled: false, weight: 0 });
    expect(policyEntry(policy, "rss").weight).toBe(1);
    expect(policyEntry(policy, "youtube").weight).toBeGreaterThanOrEqual(0.85);
  });

  it("keeps Hacker News off by default for motorcycles and UPSC", () => {
    const motorcycle = resolveBrandSourcePolicy(
      profile({ sector: "Motorcycles", topics: ["EV motorcycles", "new launches"] }),
      pack("motorcycles"),
      DEFAULT_SOURCE_REGISTRY,
    );
    const ias = resolveBrandSourcePolicy(
      profile({ sector: "Education", topics: ["UPSC current affairs", "public policy"] }),
      pack("ias-upsc-education"),
      DEFAULT_SOURCE_REGISTRY,
    );

    expect(policyEntry(motorcycle, "rss").weight).toBeGreaterThanOrEqual(0.9);
    expect(policyEntry(motorcycle, "youtube").weight).toBeGreaterThanOrEqual(0.9);
    expect(policyEntry(motorcycle, "hacker-news")).toMatchObject({ enabled: false, weight: 0 });

    expect(policyEntry(ias, "rss").weight).toBe(1);
    expect(policyEntry(ias, "youtube").weight).toBeGreaterThanOrEqual(0.8);
    expect(policyEntry(ias, "hacker-news")).toMatchObject({ enabled: false, weight: 0 });
  });

  it("keeps generic and hospitality defaults free of GitHub and Hacker News", () => {
    for (const sectorPack of [pack("generic"), pack("hospitality")]) {
      const policy = resolveBrandSourcePolicy(profile({ sector: "Restaurant" }), sectorPack, DEFAULT_SOURCE_REGISTRY);
      expect(policyEntry(policy, "github")).toMatchObject({ enabled: false, weight: 0 });
      expect(policyEntry(policy, "hacker-news")).toMatchObject({ enabled: false, weight: 0 });
    }
  });

  it("lets Discovery Plan source classes prioritize defaults, explicitly opt providers in, and deny providers", () => {
    const restaurant = profile({
      sector: "Restaurant",
      topics: ["seasonal menus"],
      sourceClasses: ["Industry news", "GitHub", "No YouTube"],
    });
    const policy = resolveBrandSourcePolicy(restaurant, pack("hospitality"), DEFAULT_SOURCE_REGISTRY);

    expect(policyEntry(policy, "rss")).toMatchObject({ enabled: true, weight: 1 });
    expect(policyEntry(policy, "agent-reach")).toMatchObject({ enabled: true, weight: 1 });
    expect(policyEntry(policy, "github")).toMatchObject({ enabled: true, weight: 0.77 });
    expect(policyEntry(policy, "youtube")).toMatchObject({ enabled: false, weight: 0 });
    expect(policyEntry(policy, "hacker-news")).toMatchObject({ enabled: false, weight: 0 });
  });

  it("lets the registry fail closed even when a sector pack or Discovery Plan enables a source", () => {
    const registry = DEFAULT_SOURCE_REGISTRY.map((source) => source.key === "youtube" ? { ...source, enabled: false } : source);
    const policy = resolveBrandSourcePolicy(profile({ sourceClasses: ["YouTube"] }), pack("ai-technology"), registry);

    expect(policyEntry(policy, "youtube")).toMatchObject({ enabled: false, weight: 0 });
  });

  it("fails deterministic validation for invalid sector weights and malformed source classes", () => {
    const invalid = { ...pack("ai-technology"), sourceWeights: { ...pack("ai-technology").sourceWeights, rss: 1.1 } };
    expect(() => validateSectorIntelligencePack(invalid)).toThrow(DomainValidationError);
    expect(() => resolveBrandSourcePolicy({ ...profile(), sourceClasses: [""] }, pack("generic"), DEFAULT_SOURCE_REGISTRY)).toThrow(DomainValidationError);
  });

  it("bounds query plans per source, removes research-only sources and deduplicates equivalent intents", () => {
    const aiProfile = profile({ topics: ["AI agents", " ai   agents ", "Architecture"] });
    const policy = resolveBrandSourcePolicy(aiProfile, pack("ai-technology"), DEFAULT_SOURCE_REGISTRY);
    const queries = planSourceQueries(aiProfile, pack("ai-technology"), policy, DEFAULT_SOURCE_REGISTRY);

    expect(queries.some((item) => item.source === "openalex")).toBe(false);
    expect(queries.some((item) => item.source === "crossref")).toBe(false);

    for (const source of DEFAULT_SOURCE_REGISTRY.filter((item) => item.capabilities.some((capability) => capability === "discovery"))) {
      expect(queries.filter((item) => item.source === source.key).length).toBeLessThanOrEqual(source.maxQueriesPerRun);
    }

    const normalized = queries.map((item) => `${item.source}:${item.query.toLowerCase().replace(/\s+/g, " ").trim()}`);
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it("never emits an excluded topic into a planned query", () => {
    const brand = profile({ topics: ["AI agents", "crypto speculation"], excludedTopics: ["crypto speculation"] });
    const policy = resolveBrandSourcePolicy(brand, pack("ai-technology"), DEFAULT_SOURCE_REGISTRY);
    const queries = planSourceQueries(brand, pack("ai-technology"), policy, DEFAULT_SOURCE_REGISTRY);

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((item) => !item.query.toLowerCase().includes("crypto speculation"))).toBe(true);
  });
});

function field(
  section: BrandBrainFieldDto["section"],
  fieldKey: string,
  value: string,
  state: BrandBrainFieldDto["state"] = "confirmed",
): BrandBrainFieldDto {
  return {
    id: `${section}-${fieldKey}`,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    section,
    fieldKey,
    value,
    state,
    sourceIds: [],
    version: 1,
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}
