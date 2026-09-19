import { describe, expect, it } from "vitest";
import { deterministicFallbackAngles } from "./deterministic-angle-fallback";

describe("deterministicFallbackAngles", () => {
  it("creates exactly two evidence-linked Instagram candidates without model output", () => {
    const angles = deterministicFallbackAngles({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      idea: { id: "idea-1", title: "Verified performance" },
      research: {
        id: "research-1", workspaceId: "workspace-1", brandId: "brand-1", ideaId: "idea-1", summary: "Supported",
        evidence: [],
        claims: [
          { id: "claim-1", text: "Power is 45 PS.", classification: "fact", confidence: .9, evidenceStrength: "strong", verificationState: "supported", freshness: "fresh", evidenceIds: [], firstPersonAuthorization: "not-applicable" },
          { id: "claim-2", text: "Torque is 39 Nm.", classification: "fact", confidence: .9, evidenceStrength: "strong", verificationState: "supported", freshness: "fresh", evidenceIds: [], firstPersonAuthorization: "not-applicable" },
        ],
        unresolvedUncertainties: ["Road performance varies."], status: "ready", createdAt: "2026-08-22T15:00:00.000Z",
      },
    });
    expect(angles).toHaveLength(2);
    expect(angles.map((angle) => angle.supportingClaimIds)).toEqual([["claim-1"], ["claim-2"]]);
    expect(angles.every((angle) => angle.runtimeProvenance?.runtime === "deterministic-angle-fallback")).toBe(true);
  });
});
