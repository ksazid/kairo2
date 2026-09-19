import { describe, expect, it } from "vitest";
import type { DiscoveryEvidence, NormalizedSourceDocument, SourcePlatform } from "@kairo/agent-contracts";
import type { BrandIntelligenceProfile } from "@kairo/domain/source-policy";
import { HUNTER_QUALITY_VERSION, rankAndFilterHunterCandidates, type HunterQualityCandidate } from "./hunter-quality";

const referenceTime = "2026-09-01T12:00:00.000Z";
const profile: BrandIntelligenceProfile = {
  sector: "Developer Technology",
  geographies: ["Malta"],
  languages: ["English"],
  audiences: ["technical founders"],
  topics: ["AI agents", "software architecture"],
  excludedTopics: ["crypto trading"],
  goals: ["build technical authority"],
};

const strongScores = {
  relevance: 0.9,
  evidence: 0.82,
  novelty: 0.82,
  timeliness: 0.88,
  brandAuthority: 0.76,
  audienceFit: 0.9,
};

function evidence(id: string, title: string, summary: string, platform: SourcePlatform = "rss"): DiscoveryEvidence {
  return {
    title,
    summary,
    sourceUrl: `https://example.com/${id}`,
    platform,
    publisher: "Example Research",
    publishedAt: "2026-08-28T12:00:00.000Z",
    retrievedAt: referenceTime,
    provider: platform,
    providerVersion: "v1",
    contentHash: "sha256:" + "a".repeat(64),
  };
}

function documentFor(item: DiscoveryEvidence): NormalizedSourceDocument {
  return {
    canonicalUrl: item.sourceUrl,
    platform: item.platform as SourcePlatform,
    sourceType: "article",
    title: item.title,
    body: `${item.summary ?? ""} Production evidence and implementation detail for technical founders.`.repeat(3),
    retrievedAt: item.retrievedAt,
    contentHash: item.contentHash ?? "sha256:" + "a".repeat(64),
    provider: item.provider,
    providerVersion: item.providerVersion ?? "v1",
    parserVersion: "v1",
    provenance: [{ provider: item.provider, sourceUrl: item.sourceUrl, retrievedAt: item.retrievedAt }],
    confidence: 1,
    extractionWarnings: [],
    trust: "untrusted-evidence",
  };
}

function candidate(source: DiscoveryEvidence, title: string, developmentDirection: string, overrides: Partial<HunterQualityCandidate> = {}): HunterQualityCandidate {
  return {
    sourceUrl: source.sourceUrl,
    title,
    rationale: "This directly affects AI agent architecture decisions for technical founders.",
    whyNow: "The implementation changed this week and has immediate architecture implications.",
    developmentDirection,
    topic: "AI agents",
    targetAudience: "technical founders",
    scores: strongScores,
    ...overrides,
  };
}

function context(items: DiscoveryEvidence[], extras: Partial<Parameters<typeof rankAndFilterHunterCandidates>[1]> = {}) {
  return {
    evidenceByUrl: new Map(items.map((item) => [item.sourceUrl, item])),
    documentsByUrl: new Map(items.map((item) => [item.sourceUrl, documentFor(item)])),
    intelligenceProfile: profile,
    referenceTime,
    ...extras,
  };
}

describe("Hunter deterministic candidate quality", () => {
  it("uses a versioned deterministic quality boundary", () => {
    expect(HUNTER_QUALITY_VERSION).toBe("hunter-quality-v1");
  });

  it("ignores model ordering and ranks stronger evidence-adjusted candidates first", () => {
    const weakerEvidence = evidence("weaker", "AI agents move into production", "AI agents are increasingly used by technical founders.", "web");
    const strongerEvidence = evidence("stronger", "AI agent runtime architecture benchmark", "A benchmark compares durable AI agent runtime architectures for production systems.", "rss");
    const weaker = candidate(weakerEvidence, "AI agents are moving into production", "Summarize what teams should watch", {
      scores: { relevance: 0.8, evidence: 0.72, novelty: 0.7, timeliness: 0.75, brandAuthority: 0.65, audienceFit: 0.8 },
    });
    const stronger = candidate(strongerEvidence, "New AI agent benchmark changes runtime architecture choices", "Compare the benchmark and explain the architecture tradeoffs");

    const ranked = rankAndFilterHunterCandidates([weaker, stronger], context([weakerEvidence, strongerEvidence]));

    expect(ranked.map((item) => item.candidate.title)).toEqual([
      stronger.title,
      weaker.title,
    ]);
    expect(ranked[0]!.overall).toBeGreaterThan(ranked[1]!.overall);
  });

  it("rejects high model scores when the candidate has no deterministic Brand fit", () => {
    const unrelated = evidence("unrelated", "Celebrity fashion awards", "A celebrity fashion event announces the year's red carpet winners.", "web");
    const inflated = candidate(unrelated, "Celebrity fashion trends to watch", "Create a broad fashion trend post", {
      topic: "fashion",
      targetAudience: "general consumers",
      rationale: "This is popular online.",
      scores: { relevance: 0.99, evidence: 0.99, novelty: 0.99, timeliness: 0.99, brandAuthority: 0.99, audienceFit: 0.99 },
    });

    expect(rankAndFilterHunterCandidates([inflated], context([unrelated]))).toEqual([]);
  });

  it("rejects excluded topics and previously surfaced ideas before persistence", () => {
    const excludedEvidence = evidence("crypto", "Crypto trading agent release", "A new crypto trading AI agent automates speculative trades.");
    const repeatEvidence = evidence("repeat", "Persistent AI agents", "Persistent AI agents keep durable runtime state for production architectures.");
    const excluded = candidate(excludedEvidence, "Crypto trading agents automate speculative portfolios", "Explain crypto trading automation", { topic: "crypto trading" });
    const repeated = candidate(repeatEvidence, "Persistent AI agents change SaaS architecture", "Explain multi-tenant architecture tradeoffs");

    const ranked = rankAndFilterHunterCandidates([excluded, repeated], context([excludedEvidence, repeatEvidence], {
      existingOpportunityTitles: ["Persistent agents change SaaS architecture"],
    }));

    expect(ranked).toEqual([]);
  });

  it("deduplicates materially equivalent candidates even when the model links them to different sources", () => {
    const firstSource = evidence("dup-1", "Persistent AI agent runtimes", "Persistent AI agents maintain durable runtime state.");
    const secondSource = evidence("dup-2", "Durable AI agent runtimes", "Durable AI agents maintain persistent runtime state.", "youtube");
    const first = candidate(firstSource, "Persistent AI agents reshape SaaS architecture", "Explain durable multi-tenant agent architecture");
    const second = candidate(secondSource, "Persistent AI agents reshape SaaS architecture", "Explain durable multi-tenant agent architecture for founders");

    const ranked = rankAndFilterHunterCandidates([first, second], context([firstSource, secondSource]));

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.candidate.title).toBe(first.title);
  });

  it("bounds repetitive output to two opportunities from one evidence source", () => {
    const shared = evidence("shared", "AI agent infrastructure report", "A detailed report covers AI agent infrastructure, architecture, deployment and reliability.");
    const candidates = [
      candidate(shared, "AI agent infrastructure reliability is becoming a product constraint", "Explain runtime reliability patterns", { topic: "AI agent reliability" }),
      candidate(shared, "AI agent infrastructure cost is changing deployment choices", "Break down new deployment cost tradeoffs", { topic: "AI agent cost" }),
      candidate(shared, "AI agent infrastructure observability needs a new architecture", "Show observability design patterns", { topic: "AI agent observability" }),
    ];

    const ranked = rankAndFilterHunterCandidates(candidates, context([shared]));

    expect(ranked).toHaveLength(2);
  });

  it("caps unsupported timeliness when evidence has no publication timestamp", () => {
    const dated = evidence("undated", "AI agent architecture guide", "A production guide for AI agent architecture.");
    const undated: DiscoveryEvidence = {
      title: dated.title,
      summary: dated.summary,
      sourceUrl: dated.sourceUrl,
      platform: dated.platform,
      publisher: dated.publisher,
      retrievedAt: dated.retrievedAt,
      provider: dated.provider,
      providerVersion: dated.providerVersion,
      contentHash: dated.contentHash,
    };
    const item = candidate(undated, "AI agent architecture guide exposes a deployment tradeoff", "Explain the deployment architecture tradeoff", {
      scores: { ...strongScores, timeliness: 1 },
    });

    const ranked = rankAndFilterHunterCandidates([item], context([undated]));

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.scores.timeliness).toBe(0.75);
  });
});
