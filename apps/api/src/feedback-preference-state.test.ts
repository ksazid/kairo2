import { describe, expect, it } from "vitest";
import { evolveBrandPreferenceState, summarizeBrandPreferenceState } from "./feedback-preference-state";

const base = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  at: "2026-09-20T10:00:00Z",
  topic: "AI agents",
  audience: "technical founders",
  format: "carousel",
  channel: "linkedin",
} as const;

describe("EEI feedback preference state", () => {
  it("keeps passive exposure neutral", () => {
    expect(evolveBrandPreferenceState(undefined, { ...base, action: "impression" })).toBeUndefined();
    expect(evolveBrandPreferenceState(undefined, { ...base, action: "opened" })).toBeUndefined();
    expect(evolveBrandPreferenceState(undefined, { ...base, action: "seen" })).toBeUndefined();
  });

  it("learns gradually from explicit positive feedback", () => {
    const one = evolveBrandPreferenceState(undefined, { ...base, action: "saved" });
    expect(one?.longTerm.topicWeights[0]?.weight).toBeCloseTo(0.04);
    expect(one?.longTerm.topicWeights[0]?.evidenceCount).toBe(1);
    const two = evolveBrandPreferenceState(one, { ...base, action: "developed", at: "2026-09-20T11:00:00Z" });
    expect(two?.longTerm.topicWeights[0]?.weight).toBeGreaterThan(one!.longTerm.topicWeights[0]!.weight);
    expect(two?.longTerm.topicWeights[0]?.weight).toBeLessThan(0.2);
    expect(summarizeBrandPreferenceState(two)).toContain("AI agents");
  });

  it("records explicit negative feedback without treating it as a permanent Brand boundary", () => {
    const state = evolveBrandPreferenceState(undefined, { ...base, action: "not_relevant", reason: "Too generic" });
    expect(state?.negatives.topics[0]).toMatchObject({ key: "AI agents", strength: 0.18, reason: "Too generic" });
    const later = evolveBrandPreferenceState(state, { ...base, action: "saved", at: "2026-10-20T10:00:00Z" });
    expect(later?.negatives.topics[0]?.strength ?? 0).toBeLessThan(0.18);
  });

  it("does not interpret performance-observed as positive performance", () => {
    expect(evolveBrandPreferenceState(undefined, { ...base, action: "performance_observed" })).toBeUndefined();
  });
});
