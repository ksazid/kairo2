import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import { validateCarouselPlan, validateReelPlan } from "./creative-formats";

describe("VS-14 benchmark creative formats", () => {
  it("validates a Claim-linked carousel plan", () => {
    const plan = validateCarouselPlan({
      format: "carousel",
      coverHook: "Three things first-time pilgrims should verify",
      slides: [
        { headline: "Start with the visa rule", body: "Use the current approved guidance.", supportingClaimIds: ["claim-1"] },
        { headline: "Check your document dates", body: "Do not rely on stale screenshots.", supportingClaimIds: ["claim-2"] },
        { headline: "Save the official source", body: "Keep the source available while planning.", supportingClaimIds: ["claim-3"] },
      ],
      caption: "A short checklist for planning.",
      cta: "Save this checklist.",
      supportingClaimIds: ["claim-1", "claim-2", "claim-3"],
    });
    expect(plan.slides).toHaveLength(3);
    expect(plan.supportingClaimIds).toEqual(["claim-1", "claim-2", "claim-3"]);
  });

  it("rejects carousels that do not have enough narrative structure or valid Claim lineage", () => {
    expect(() => validateCarouselPlan({
      format: "carousel",
      coverHook: "Hook",
      slides: [{ headline: "Only slide", body: "Body", supportingClaimIds: ["claim-1"] }],
      caption: "Caption",
      cta: "CTA",
      supportingClaimIds: ["claim-1"],
    })).toThrow(DomainValidationError);

    expect(() => validateCarouselPlan({
      format: "carousel",
      coverHook: "Hook",
      slides: [
        { headline: "One", body: "Body", supportingClaimIds: ["claim-missing"] },
        { headline: "Two", body: "Body", supportingClaimIds: ["claim-2"] },
        { headline: "Three", body: "Body", supportingClaimIds: ["claim-3"] },
      ],
      caption: "Caption",
      cta: "CTA",
      supportingClaimIds: ["claim-1", "claim-2", "claim-3"],
    })).toThrow(DomainValidationError);
  });

  it("validates an ordered Reel plan with timing and Claim lineage", () => {
    const plan = validateReelPlan({
      format: "reel",
      hook: "Your AI copilot is becoming a workflow.",
      targetDurationSeconds: 24,
      scenes: [
        { startSecond: 0, endSecond: 4, visual: "Direct-to-camera hook", onScreenText: "Copilot → workflow", voiceover: "The shift is already visible.", supportingClaimIds: ["claim-1"] },
        { startSecond: 4, endSecond: 14, visual: "Workflow diagram", onScreenText: "Tools + memory", voiceover: "Tool use and durable state change what agents can do.", supportingClaimIds: ["claim-2"] },
        { startSecond: 14, endSecond: 24, visual: "Closing frame", onScreenText: "What changes next?", voiceover: "The architecture now matters as much as the model.", supportingClaimIds: ["claim-3"] },
      ],
      caption: "A concise architecture shift to watch.",
      cta: "Save this for your next agent design review.",
      supportingClaimIds: ["claim-1", "claim-2", "claim-3"],
    });
    expect(plan.targetDurationSeconds).toBe(24);
    expect(plan.scenes[2]?.endSecond).toBe(24);
  });

  it("rejects overlapping or out-of-duration Reel scenes", () => {
    expect(() => validateReelPlan({
      format: "reel",
      hook: "Hook",
      targetDurationSeconds: 20,
      scenes: [
        { startSecond: 0, endSecond: 12, visual: "A", onScreenText: "A", voiceover: "A", supportingClaimIds: ["claim-1"] },
        { startSecond: 10, endSecond: 22, visual: "B", onScreenText: "B", voiceover: "B", supportingClaimIds: ["claim-2"] },
      ],
      caption: "Caption",
      cta: "CTA",
      supportingClaimIds: ["claim-1", "claim-2"],
    })).toThrow(DomainValidationError);
  });
});
