import { describe, expect, it } from "vitest";
import type { OpportunityFeedbackEventV2 } from "./opportunity-intelligence";
import { projectFeedbackPreferenceStateV2 } from "./feedback-learning-v2";

function event(
  id: string,
  action: OpportunityFeedbackEventV2["action"],
  at: string,
  key = id,
): OpportunityFeedbackEventV2 {
  return {
    schemaVersion: "2",
    id,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    opportunityId: "opp-1",
    accountId: "account-1",
    action,
    surface: "discover",
    rankingVersion: "hunter-eei-v2-shadow",
    occurredAt: at,
    idempotencyKey: key,
  };
}

describe("Feedback V2 preference projector", () => {
  it("deduplicates by idempotency key and keeps passive events neutral", () => {
    const result = projectFeedbackPreferenceStateV2(undefined, [
      { event: event("e1", "impression", "2026-09-20T08:00:00Z", "dup"), topic: "AI agents" },
      { event: event("e2", "saved", "2026-09-20T08:01:00Z", "dup"), topic: "AI agents" },
      { event: event("e3", "opened", "2026-09-20T08:02:00Z"), topic: "AI agents" },
      { event: event("e4", "performance_observed", "2026-09-20T08:03:00Z"), topic: "AI agents" },
    ]);

    expect(result.state).toBeUndefined();
    expect(result.diagnostics.duplicateEventCount).toBe(1);
    expect(result.diagnostics.passiveEventCount).toBe(3);
    expect(result.diagnostics.appliedEventCount).toBe(0);
  });

  it("learns positive dimensions gradually and increases exploration only for successful exploration", () => {
    const result = projectFeedbackPreferenceStateV2(undefined, [
      {
        event: event("e1", "saved", "2026-09-20T08:00:00Z"),
        topic: "AI agents",
        audience: "technical founders",
        format: "carousel",
        channel: "linkedin",
        mechanismKeys: ["diagnostic checklist", "proof-led"],
        selectionBucket: "exploration",
      },
      {
        event: event("e2", "developed", "2026-09-20T09:00:00Z"),
        topic: "AI agents",
        audience: "technical founders",
        format: "carousel",
        channel: "linkedin",
        mechanismKeys: ["diagnostic checklist"],
        selectionBucket: "exploration",
      },
    ]);

    expect(result.state?.longTerm.topicWeights[0]?.weight).toBeGreaterThan(0.1);
    expect(result.state?.longTerm.audienceWeights[0]?.weight).toBeGreaterThan(0);
    expect(result.state?.longTerm.formatWeights[0]?.weight).toBeGreaterThan(0);
    expect(result.state?.longTerm.channelWeights[0]?.weight).toBeGreaterThan(0);
    expect(result.state?.longTerm.mechanismWeights[0]?.weight).toBeGreaterThan(0);
    expect(result.state?.explorationBudget).toBeGreaterThan(0.12);
    expect(result.state?.explorationBudget).toBeLessThanOrEqual(0.2);
    expect(result.diagnostics.dimensionUpdates.explorationBudget).toBe(2);
  });

  it("targets negative feedback to the relevant dimension", () => {
    const result = projectFeedbackPreferenceStateV2(undefined, [
      {
        event: { ...event("e1", "wrong_audience", "2026-09-20T08:00:00Z"), reason: "Wrong seniority" },
        topic: "AI agents",
        audience: "enterprise CTOs",
      },
      {
        event: { ...event("e2", "not_credible", "2026-09-20T09:00:00Z"), reason: "Weak source" },
        topic: "AI agents",
        sourceClasses: ["low quality forum", "anonymous social"],
      },
      {
        event: { ...event("e3", "heavily_edited", "2026-09-20T10:00:00Z"), reason: "Hook was off-brand" },
        topic: "AI agents",
        mechanismKeys: ["fear hook", "listicle"],
      },
    ]);

    expect(result.state?.negatives.audiences[0]?.key).toBe("enterprise CTOs");\n    expect(result.state?.negatives.audiences[0]?.strength).toBeCloseTo(0.22, 3);
    expect(result.state?.negatives.sourceClasses.map((x) => x.key)).toEqual(
      expect.arrayContaining(["low quality forum", "anonymous social"]),
    );
    expect(result.state?.negatives.mechanisms.map((x) => x.key)).toEqual(
      expect.arrayContaining(["fear hook", "listicle"]),
    );
    expect(result.diagnostics.dimensionUpdates.sourceClass).toBe(2);
    expect(result.diagnostics.dimensionUpdates.mechanism).toBe(2);
  });

  it("decays stale memory and keeps exploration inside the policy band", () => {
    const first = projectFeedbackPreferenceStateV2(undefined, [
      {
        event: event("e1", "published", "2026-08-01T08:00:00Z"),
        topic: "AI agents",
        selectionBucket: "exploration",
      },
    ]);
    const before = first.state!.longTerm.topicWeights[0]!.weight;

    const later = projectFeedbackPreferenceStateV2(first.state, [
      {
        event: event("e2", "dismissed", "2026-09-20T08:00:00Z"),
        topic: "AI agents",
        selectionBucket: "exploration",
      },
    ]);

    expect(later.state!.longTerm.topicWeights[0]!.weight).toBeLessThan(before);
    expect(later.state!.explorationBudget).toBeGreaterThanOrEqual(0.08);
    expect(later.state!.explorationBudget).toBeLessThanOrEqual(0.2);
  });

  it("rejects cross-Brand event streams", () => {
    const current = projectFeedbackPreferenceStateV2(undefined, [
      { event: event("e1", "saved", "2026-09-20T08:00:00Z"), topic: "AI agents" },
    ]).state!;

    expect(() => projectFeedbackPreferenceStateV2(current, [{
      event: { ...event("e2", "saved", "2026-09-20T09:00:00Z"), brandId: "other-brand" },
      topic: "AI agents",
    }])).toThrow("same workspace and Brand");
  });
});
