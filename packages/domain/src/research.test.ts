import { describe, expect, it } from "vitest";
import {
  createIdea,
  createResearchDossier,
  selectAngle,
  type Angle,
  type Claim,
  type EvidenceReference,
} from "./research";

const scope = { workspaceId: "ws-1", brandId: "brand-1" };

function evidence(id: string): EvidenceReference {
  return {
    id,
    sourceUrl: `https://example.com/${id}`,
    sourceTitle: `Source ${id}`,
    publishedAt: "2026-08-12T08:00:00.000Z",
    retrievedAt: "2026-08-13T08:00:00.000Z",
  };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: "claim-1",
    text: "The referenced source reports a measurable change.",
    classification: "fact",
    confidence: 0.9,
    evidenceStrength: "strong",
    verificationState: "supported",
    freshness: "fresh",
    evidenceIds: ["evidence-1"],
    firstPersonAuthorization: "not-applicable",
    ...overrides,
  };
}

describe("VS-04 research domain", () => {
  it("retains Opportunity lineage when an Idea is created", () => {
    const idea = createIdea({
      ...scope,
      id: "idea-1",
      title: "A useful framing",
      premise: "Explain why this development matters now.",
      source: { type: "opportunity", opportunityId: "opp-1" },
      createdAt: "2026-08-13T08:00:00.000Z",
    });

    expect(idea.workspaceId).toBe(scope.workspaceId);
    expect(idea.brandId).toBe(scope.brandId);
    expect(idea.source).toEqual({ type: "opportunity", opportunityId: "opp-1" });
    expect(idea.status).toBe("new");
  });

  it("rejects factual Claims that have no evidence", () => {
    expect(() => createResearchDossier({
      ...scope,
      id: "research-1",
      ideaId: "idea-1",
      summary: "Evidence-backed summary",
      evidence: [evidence("evidence-1")],
      claims: [claim({ evidenceIds: [] })],
      unresolvedUncertainties: [],
      createdAt: "2026-08-13T08:05:00.000Z",
    })).toThrow(/factual claim requires evidence/i);
  });

  it("rejects Claim evidence references that do not exist in the dossier", () => {
    expect(() => createResearchDossier({
      ...scope,
      id: "research-1",
      ideaId: "idea-1",
      summary: "Evidence-backed summary",
      evidence: [evidence("evidence-1")],
      claims: [claim({ evidenceIds: ["missing-evidence"] })],
      unresolvedUncertainties: [],
      createdAt: "2026-08-13T08:05:00.000Z",
    })).toThrow(/unknown evidence/i);
  });

  it("rejects local and private evidence URLs", () => {
    for (const sourceUrl of [
      "http://localhost/admin",
      "http://127.0.0.1/private",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.10/internal",
      "http://[::1]/private",
    ]) {
      expect(() => createResearchDossier({
        ...scope,
        id: "research-1",
        ideaId: "idea-1",
        summary: "Evidence-backed summary",
        evidence: [{ ...evidence("evidence-1"), sourceUrl }],
        claims: [claim()],
        unresolvedUncertainties: [],
        createdAt: "2026-08-13T08:05:00.000Z",
      })).toThrow(/public host/i);
    }
  });

  it("rejects first-person Claims unless Brand authorization is explicit", () => {
    expect(() => createResearchDossier({
      ...scope,
      id: "research-1",
      ideaId: "idea-1",
      summary: "Evidence-backed summary",
      evidence: [evidence("evidence-1")],
      claims: [claim({
        text: "We have seen this outcome with our own customers.",
        classification: "brand-opinion",
        firstPersonAuthorization: "not-authorized",
      })],
      unresolvedUncertainties: [],
      createdAt: "2026-08-13T08:05:00.000Z",
    })).toThrow(/first-person claim requires explicit brand authorization/i);
  });

  it("preserves explicit uncertainty instead of inventing support", () => {
    const dossier = createResearchDossier({
      ...scope,
      id: "research-1",
      ideaId: "idea-1",
      summary: "What is known and what remains unresolved.",
      evidence: [evidence("evidence-1")],
      claims: [claim()],
      unresolvedUncertainties: ["The long-term effect is not established yet."],
      createdAt: "2026-08-13T08:05:00.000Z",
    });

    expect(dossier.unresolvedUncertainties).toEqual(["The long-term effect is not established yet."]);
    expect(dossier.status).toBe("ready");
  });

  it("allows exactly one selected Angle at a time", () => {
    const angles: Angle[] = [
      {
        id: "angle-1", workspaceId: scope.workspaceId, brandId: scope.brandId, ideaId: "idea-1",
        title: "Technical explanation", framing: "Explain the mechanism", audience: "Engineers",
        objective: "Education", hookDirection: "Start with the surprising constraint", expectedValue: "Practical clarity",
        effort: "medium", recommendedFormat: "carousel", recommendedChannel: "linkedin",
        supportingClaimIds: ["claim-1"], status: "selected", version: 1,
      },
      {
        id: "angle-2", workspaceId: scope.workspaceId, brandId: scope.brandId, ideaId: "idea-1",
        title: "Business impact", framing: "Explain the operational consequence", audience: "Leaders",
        objective: "Authority", hookDirection: "Lead with the measurable implication", expectedValue: "Decision context",
        effort: "low", recommendedFormat: "text", recommendedChannel: "linkedin",
        supportingClaimIds: ["claim-1"], status: "candidate", version: 1,
      },
    ];

    const selected = selectAngle(angles, "angle-2");

    expect(selected.find((item) => item.id === "angle-1")?.status).toBe("candidate");
    expect(selected.find((item) => item.id === "angle-2")?.status).toBe("selected");
    expect(selected.filter((item) => item.status === "selected")).toHaveLength(1);
  });
});
