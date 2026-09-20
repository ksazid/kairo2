import { describe, expect, it, vi } from "vitest";
import type { ShadowRetrievalCandidate } from "./hunter-shadow-retrieval";
import {
  hunterTrendSignalReference,
  runShadowTrendIntelligence,
} from "./hunter-shadow-trend-intelligence";

function candidate(overrides: Partial<ShadowRetrievalCandidate> = {}): ShadowRetrievalCandidate {
  return {
    key: "signal-a",
    title: "Used EV battery health checks before buying",
    summary: "Battery health checks help used EV buyers avoid expensive surprises.",
    sourceUrl: "https://example.com/a",
    platform: "web",
    provider: "agent-reach",
    publisher: "Publisher A",
    publishedAt: "2026-09-19T08:00:00Z",
    generatorKeys: ["brand-core"],
    intentIds: ["intent-1"],
    topicIds: ["ev-battery-health"],
    sourceClasses: ["Industry news"],
    corroboratingKeys: [],
    ...overrides,
  };
}

describe("runShadowTrendIntelligence", () => {
  it("clusters corroborating multi-source signals and calculates observable trend features", async () => {
    const candidates = [
      candidate({
        key: "signal-a",
        platform: "web",
        provider: "agent-reach",
        publisher: "Publisher A",
        sourceUrl: "https://a.example/story",
        corroboratingKeys: ["signal-b"],
      }),
      candidate({
        key: "signal-b",
        title: "Used EV battery health checks before purchase",
        summary: "A practical battery health checklist for used EV buyers.",
        platform: "rss",
        provider: "rss",
        publisher: "Publisher B",
        sourceUrl: "https://b.example/story",
        publishedAt: "2026-09-19T12:00:00Z",
        corroboratingKeys: ["signal-a", "signal-c"],
      }),
      candidate({
        key: "signal-c",
        title: "Battery health checks for used EV buyers",
        summary: "What buyers should check before purchasing a used electric vehicle.",
        platform: "youtube",
        provider: "youtube",
        publisher: "Creator C",
        sourceUrl: "https://youtube.example/story",
        publishedAt: "2026-09-20T06:00:00Z",
        corroboratingKeys: ["signal-b"],
      }),
    ];

    const run = await runShadowTrendIntelligence(candidates, {
      now: new Date("2026-09-20T08:00:00Z"),
      topicLabels: { "ev-battery-health": "EV battery health" },
      metricsBySignalId: {
        "signal-a": { engagement: 120, recentEngagement: 80, earlierEngagement: 20, creatorBaseline: 60, categoryBaseline: 80 },
        "signal-b": { engagement: 160, recentEngagement: 100, earlierEngagement: 40, creatorBaseline: 80, categoryBaseline: 100 },
        "signal-c": { engagement: 200, recentEngagement: 140, earlierEngagement: 40, creatorBaseline: 100, categoryBaseline: 120 },
      },
    });

    expect(run.clusters).toHaveLength(1);
    const cluster = run.clusters[0]!;
    expect(cluster.intelligence.topic).toBe("EV battery health");
    expect(cluster.intelligence.stage).toBe("accelerating");
    expect(cluster.intelligence.crossSourceSpread).toBe(1);
    expect(cluster.intelligence.crossPlatformSpread).toBe(1);
    expect(cluster.intelligence.acceleration).toBeGreaterThan(0.67);
    expect(cluster.intelligence.creatorOutlier).toBeGreaterThan(0.5);
    expect(cluster.intelligence.categoryOutlier).toBeGreaterThan(0.5);
    expect(cluster.features.independentPublisherCount).toBe(3);
    expect(cluster.features.unknownFeatures).toEqual([]);
    expect(run.diagnostics.multiSourceClusterCount).toBe(1);
    expect(run.diagnostics.corroboratedClusterCount).toBe(1);
    expect(run.diagnostics.stageDistribution.accelerating).toBe(1);
  });

  it("uses an evidence-derived topic label for exploration-only clusters instead of collapsing them into the parent plan topic", async () => {
    const run = await runShadowTrendIntelligence([
      candidate({
        key: "explore-a",
        title: "Local-first developer environments gain interest",
        summary: "Software teams are discussing reproducible local sandboxes and offline-first tooling.",
        generatorKeys: ["adjacent-exploration"],
      }),
    ], {
      now: new Date("2026-09-20T08:00:00Z"),
      topicLabels: { "ev-battery-health": "EV battery health" },
    });

    expect(run.clusters).toHaveLength(1);
    expect(run.clusters[0]!.generatorKeys).toEqual(["adjacent-exploration"]);
    expect(run.clusters[0]!.intelligence.topic).toBe("Local-first developer environments gain interest");
    expect(run.clusters[0]!.intelligence.topic).not.toBe("EV battery health");
  });

  it("does not collapse exploration evidence into a lexically similar core cluster", async () => {
    const run = await runShadowTrendIntelligence([
      candidate({
        key: "core-signal",
        title: "AI agent evaluation workflows",
        summary: "Teams evaluate AI agent workflows before production.",
        topicIds: ["agents"],
        generatorKeys: ["brand-core"],
      }),
      candidate({
        key: "explore-signal",
        title: "AI agent evaluation workflows",
        summary: "Teams evaluate AI agent workflows before production.",
        sourceUrl: "https://example.org/explore",
        publisher: "Publisher B",
        topicIds: ["agents"],
        generatorKeys: ["adjacent-exploration"],
      }),
    ], {
      now: new Date("2026-09-20T08:00:00Z"),
      topicLabels: { agents: "AI agents" },
    });

    expect(run.clusters).toHaveLength(2);
    expect(run.clusters.some((cluster) =>
      cluster.generatorKeys.includes("adjacent-exploration") &&
      cluster.intelligence.topic === "AI agent evaluation workflows"
    )).toBe(true);
  });

  it("maps raw signal keys longer than the domain limit to deterministic bounded references", async () => {
    const longKey = "agent-reach:" + "x".repeat(260);
    const run = await runShadowTrendIntelligence([
      candidate({ key: longKey }),
    ], {
      now: new Date("2026-09-20T08:00:00Z"),
    });

    const refs = run.clusters[0]!.intelligence.supportingSignalIds;
    expect(refs).toEqual([hunterTrendSignalReference(longKey)]);
    expect(refs[0]!.length).toBeLessThanOrEqual(200);
    expect(hunterTrendSignalReference(longKey)).toBe(hunterTrendSignalReference(longKey));
    expect(hunterTrendSignalReference(longKey)).not.toBe(
      hunterTrendSignalReference(longKey + "-different"),
    );
  });

  it("caps a large merged cluster at the domain maximum of 100 supporting signal references", async () => {
    const candidates = Array.from({ length: 101 }, (_, index) =>
      candidate({
        key: "signal-" + index + "-" + "z".repeat(220),
        title: "Same bounded trend cluster",
        summary: "Shared evidence that should merge into one deterministic cluster.",
        sourceUrl: "https://example.com/" + index,
        publisher: "Publisher " + index,
      }),
    );

    const run = await runShadowTrendIntelligence(candidates, {
      now: new Date("2026-09-20T08:00:00Z"),
      maxSignals: 120,
    });

    expect(run.clusters).toHaveLength(1);
    expect(run.clusters[0]!.features.signalCount).toBe(101);
    expect(run.clusters[0]!.intelligence.supportingSignalIds).toHaveLength(100);
    expect(run.clusters[0]!.intelligence.supportingSignalIds.every(
      (value) => value.length <= 200,
    )).toBe(true);
  });

  it("marks missing engagement/outlier features unknown instead of fabricating evidence", async () => {
    const run = await runShadowTrendIntelligence([
      candidate({ key: "signal-only", corroboratingKeys: [] }),
    ], {
      now: new Date("2026-09-20T08:00:00Z"),
      topicLabels: { "ev-battery-health": "EV battery health" },
    });

    const cluster = run.clusters[0]!;
    expect(cluster.features.unknownFeatures).toEqual([
      "velocity",
      "acceleration",
      "creatorOutlier",
      "categoryOutlier",
    ]);
    expect(cluster.intelligence.velocity).toBe(0);
    expect(cluster.intelligence.acceleration).toBe(0);
    expect(cluster.intelligence.creatorOutlier).toBe(0);
    expect(cluster.intelligence.categoryOutlier).toBe(0);
    expect(cluster.intelligence.stage).toBe("emerging");
    expect(run.diagnostics.unknownFeatureRates.velocity).toBe(1);
  });

  it("uses bounded semantic similarity only for plausible lexical neighbors", async () => {
    const semantic = {
      similarity: vi.fn(async () => 0.9),
    };
    const run = await runShadowTrendIntelligence([
      candidate({
        key: "signal-a",
        title: "Battery health guide for used EV buyers",
        summary: "Battery checks before purchase",
      }),
      candidate({
        key: "signal-b",
        title: "Battery diagnostics for electric car buyers",
        summary: "Diagnostics buyers can use before purchase",
        sourceUrl: "https://example.org/b",
        publisher: "Publisher B",
        platform: "rss",
        provider: "rss",
      }),
      candidate({
        key: "signal-c",
        title: "Restaurant menu margin optimization",
        summary: "Contribution margin for food delivery menus",
        sourceUrl: "https://example.net/c",
        publisher: "Publisher C",
        topicIds: ["restaurant-margin"],
      }),
    ], {
      now: new Date("2026-09-20T08:00:00Z"),
      semanticSimilarity: semantic,
      lexicalSimilarityThreshold: 0.55,
      semanticSimilarityThreshold: 0.82,
      maxSemanticComparisons: 1,
    });

    expect(semantic.similarity).toHaveBeenCalledTimes(1);
    expect(run.diagnostics.semanticComparisonCount).toBe(1);
    expect(run.diagnostics.semanticMergeCount).toBe(1);
    expect(run.clusters).toHaveLength(2);
  });

  it("classifies long-lived repeated discussion as evergreen when momentum is not observed", async () => {
    const run = await runShadowTrendIntelligence([
      candidate({ key:"a",publishedAt:"2026-08-15T08:00:00Z",corroboratingKeys:["b"] }),
      candidate({ key:"b",publishedAt:"2026-08-30T08:00:00Z",provider:"rss",platform:"rss",publisher:"B",sourceUrl:"https://b.example/x",corroboratingKeys:["a","c"] }),
      candidate({ key:"c",publishedAt:"2026-09-10T08:00:00Z",provider:"youtube",platform:"youtube",publisher:"C",sourceUrl:"https://c.example/x",corroboratingKeys:["b"] }),
    ], {
      now: new Date("2026-09-20T08:00:00Z"),
    });

    expect(run.clusters).toHaveLength(1);
    expect(run.clusters[0]!.features.observationSpanDays).toBeGreaterThanOrEqual(21);
    expect(run.clusters[0]!.intelligence.stage).toBe("evergreen");
  });
});
