import { describe, expect, it } from "vitest";
import { buildHunterRetrievalPlan, HUNTER_RETRIEVAL_GENERATORS } from "./hunter-retrieval";
import type { BrandDiscoveryPlan } from "./brand-discovery-plan";
import type { BrandPreferenceState } from "./brand-preference-state";

const discoveryPlan: BrandDiscoveryPlan = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  revision: 2,
  planVersion: "snapshot-1:discovery:2",
  snapshotVersion: "snapshot-1",
  state: "customized",
  topics: [{
    id: "ev-battery-health",
    name: "EV battery health",
    priority: "High",
    audience: "First-time used EV buyers",
    entities: ["EV battery health", "used EV", "Malta EV market"],
    sourceClasses: ["Official sources", "Industry news", "YouTube"],
  }],
  excludedTopics: ["political campaigning"],
  updatedAt: "2026-09-20T01:00:00Z",
};

const preferenceState: BrandPreferenceState = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  snapshotVersion: "snapshot-1",
  longTerm: {
    topicWeights: [{ key: "battery diagnostics", weight: 0.9 }],
    audienceWeights: [],
    formatWeights: [],
    channelWeights: [],
    mechanismWeights: [],
  },
  shortTerm: {
    activeTopics: [{ key: "EV charging etiquette", weight: 0.8 }],
    activeCampaignIds: [],
    updatedAt: "2026-09-20T01:00:00Z",
  },
  negatives: {
    topics: [{ key: "crypto speculation", strength: 0.9, lastObservedAt: "2026-09-20T00:00:00Z" }],
    audiences: [],
    mechanisms: [],
    sourceClasses: [{ key: "low quality forum", strength: 0.7, lastObservedAt: "2026-09-20T00:00:00Z" }],
  },
  performanceMemory: [],
  explorationBudget: 0.12,
  updatedAt: "2026-09-20T01:00:00Z",
};

describe("Hunter retrieval plan", () => {
  it("creates bounded intents across every required generator with provenance", () => {
    const plan = buildHunterRetrievalPlan({ plan: discoveryPlan, preferenceState, maxIntents: 20, maxResultsPerIntent: 8 });
    expect(plan.schemaVersion).toBe("1");
    expect(plan.intents.length).toBeLessThanOrEqual(20);
    const generators = new Set(plan.intents.map((intent) => intent.generator));
    for (const generator of HUNTER_RETRIEVAL_GENERATORS) expect(generators.has(generator)).toBe(true);
    expect(plan.intents.every((intent) => intent.topicId === "ev-battery-health")).toBe(true);
    expect(plan.intents.every((intent) => intent.maxResults >= 1 && intent.maxResults <= 20)).toBe(true);
  });

  it("promotes explicit exclusions and strong negative preferences into hard negatives", () => {
    const plan = buildHunterRetrievalPlan({ plan: discoveryPlan, preferenceState });
    expect(plan.hardNegatives).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "political campaigning", source: "discovery-plan", strength: 1 }),
      expect.objectContaining({ key: "crypto speculation", source: "preference-topic", strength: 0.9 }),
      expect.objectContaining({ key: "low quality forum", source: "preference-source-class", strength: 0.7 }),
    ]));
  });

  it("fails closed when preference state belongs to another Brand", () => {
    expect(() => buildHunterRetrievalPlan({
      plan: discoveryPlan,
      preferenceState: { ...preferenceState, brandId: "other-brand" },
    })).toThrow("same workspace and Brand");
  });
});