import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import {
  evaluateOpportunity,
  materiallySimilarOpportunity,
  preparePublicSignal,
  transitionOpportunityStatus,
} from "./discovery";

describe("VS-03 discovery domain", () => {
  it("normalizes public Signal provenance without accepting local/private source URLs", () => {
    const signal = preparePublicSignal({
      title: "OpenAI releases a new agent capability",
      summary: "A public product update relevant to agent builders.",
      sourceUrl: "https://example.com/agents?utm_source=test",
      platform: "web",
      publisher: "Example",
      publishedAt: "2026-08-12T10:00:00.000Z",
      retrievedAt: "2026-08-12T10:05:00.000Z",
      provider: "agent-reach",
      providerVersion: "93ae1d18c37b707dec053c7c4f9d91cd8ef8943d",
      contentHash: "a".repeat(64),
    });

    expect(signal.sourceUrl).toBe("https://example.com/agents?utm_source=test");
    expect(signal.duplicateKey).toBe("https://example.com/agents");
    expect(signal.provider).toBe("agent-reach");
    expect(signal.contentHash).toBe("a".repeat(64));

    expect(() => preparePublicSignal({
      title: "Unsafe",
      sourceUrl: "http://127.0.0.1/private",
      platform: "web",
      retrievedAt: "2026-08-12T10:05:00.000Z",
      provider: "test",
    })).toThrow(DomainValidationError);
  });

  it("creates an Opportunity only when the candidate clears quality floors and overall strength", () => {
    const strong = evaluateOpportunity({
      relevance: 0.92,
      evidence: 0.8,
      novelty: 0.74,
      timeliness: 0.88,
      brandAuthority: 0.7,
      audienceFit: 0.9,
    });
    expect(strong.qualifies).toBe(true);
    expect(strong.overall).toBeGreaterThanOrEqual(0.65);

    const filler = evaluateOpportunity({
      relevance: 0.38,
      evidence: 0.9,
      novelty: 0.95,
      timeliness: 0.9,
      brandAuthority: 0.9,
      audienceFit: 0.9,
    });
    expect(filler.qualifies).toBe(false);
  });

  it("does not suppress a similar topic when the proposed development direction is materially different", () => {
    const existing = {
      topic: "persistent AI agents",
      developmentDirection: "beginner explanation of what persistent agents are",
    };

    expect(materiallySimilarOpportunity(
      { topic: "persistent AI agents", developmentDirection: "beginner explanation of what persistent agents are" },
      existing,
    )).toBe(true);

    expect(materiallySimilarOpportunity(
      { topic: "persistent AI agents", developmentDirection: "architecture tradeoffs for multi-tenant SaaS founders" },
      existing,
    )).toBe(false);
  });

  it("keeps Opportunity actions bounded and treats ignored/developing states as terminal in VS-03", () => {
    expect(transitionOpportunityStatus("new", "save")).toBe("saved");
    expect(transitionOpportunityStatus("new", "ignore")).toBe("ignored");
    expect(transitionOpportunityStatus("saved", "develop")).toBe("developing");
    expect(transitionOpportunityStatus("saved", "save")).toBe("saved");

    expect(() => transitionOpportunityStatus("ignored", "develop")).toThrow(DomainValidationError);
    expect(() => transitionOpportunityStatus("developing", "ignore")).toThrow(DomainValidationError);
  });
});
