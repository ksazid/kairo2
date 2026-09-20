import { describe, expect, it } from "vitest";
import type { DiscoveryEvidence } from "@kairo/agent-contracts";
import { projectOpportunityIntelligenceV2, type HunterJudgmentCandidate } from "./hunter";

describe("Hunter Opportunity Intelligence projection", () => {
  it("creates a canonical EEI-versioned recommendation payload from a persisted candidate", () => {
    const source: DiscoveryEvidence = {
      title: "Independent AI agent benchmark",
      summary: "A benchmark compares production AI agent runtimes.",
      sourceUrl: "https://example.com/benchmark",
      platform: "rss",
      publisher: "Example Research",
      publishedAt: "2026-09-20T08:00:00Z",
      retrievedAt: "2026-09-20T10:00:00Z",
      provider: "rss",
    };
    const candidate: HunterJudgmentCandidate = {
      sourceUrl: source.sourceUrl,
      title: "Benchmark changes agent runtime choices",
      rationale: "The evidence is directly relevant to technical founders choosing an agent architecture.",
      whyNow: "The benchmark was published today.",
      developmentDirection: "Compare the tradeoffs and give a practical architecture checklist.",
      proposedAngle: "Turn the benchmark into an evidence-backed architecture checklist.",
      targetAudience: "technical founders",
      recommendedFormat: "carousel",
      recommendedChannel: "linkedin",
      confidence: .86,
      estimatedEffort: "medium",
      scores: { relevance:.9,evidence:.86,novelty:.78,timeliness:.92,brandAuthority:.8,audienceFit:.9 },
    };
    const value = projectOpportunityIntelligenceV2({
      opportunityId: "opportunity-1",
      signalId: "signal-1",
      candidate,
      source,
      scores: candidate.scores,
      input: {
        accountId: "account-1",
        brand: { workspaceId:"workspace-1",brandId:"brand-1",contextVersion:"snapshot-1",brandName:"Kairo" },
        snapshotVersion: "snapshot-1",
        planVersion: "plan-1",
        hunterRunId: "run-1",
      },
    });
    expect(value).toMatchObject({
      id: "opportunity-1",
      schemaVersion: "2",
      evidence: { confidenceLabel: "High" },
      provenance: { hunterRunId: "run-1", eeiVersion: "hunter-eei-v1" },
    });
    expect(value.explanation.userControl).toContain("mark this recommendation not relevant");
  });
});
