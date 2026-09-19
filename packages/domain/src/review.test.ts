import { describe, expect, it } from "vitest";
import {
  approveContentVersion,
  completeContentReview,
  evaluateTruthGate,
  requestContentReview,
  selectJudgedCandidate,
} from "./review";

const scope = { workspaceId: "ws-1", brandId: "brand-1", campaignId: "campaign-1", assetId: "asset-1", versionId: "version-2", version: 2 };

describe("VS-06 Truth, review and approval domain", () => {
  it("hard-fails unsupported facts and fabricated first-person experience regardless of scores", () => {
    const truth = evaluateTruthGate({
      ...scope,
      claimUses: [
        { claimId: "claim-1", factual: true, supported: false, fresh: true, firstPerson: false, brandAuthorized: false, attributionRequired: false, attributionPresent: false },
        { claimId: "claim-2", factual: false, supported: true, fresh: true, firstPerson: true, brandAuthorized: false, attributionRequired: false, attributionPresent: false },
      ],
      prohibitedBrandLanguage: [],
    });
    expect(truth.passed).toBe(false);
    expect(truth.findings.map((finding) => finding.code)).toEqual(["unsupported-factual-claim", "fabricated-first-person"]);
    expect(() => requestContentReview({ id: "review-1", ...scope, truth, requestedAt: "2026-08-13T10:00:00Z" })).toThrow(/truth gate/i);
  });

  it("requires independent Critic pass and keeps revision cycles bounded", () => {
    const truth = evaluateTruthGate({ ...scope, claimUses: [], prohibitedBrandLanguage: [] });
    const review = requestContentReview({ id: "review-1", ...scope, truth, requestedAt: "2026-08-13T10:00:00Z" });
    expect(() => completeContentReview({ review, critic: { passed: false, score: 95, findings: [{ code: "weak-hook", severity: "revision", message: "Opening is unclear" }] }, revisionCycle: 3, completedAt: "2026-08-13T10:01:00Z" })).toThrow(/revision cycles/i);
    const completed = completeContentReview({ review, critic: { passed: false, score: 95, findings: [{ code: "weak-hook", severity: "revision", message: "Opening is unclear" }] }, revisionCycle: 2, completedAt: "2026-08-13T10:01:00Z" });
    expect(completed.status).toBe("revision-required");
  });

  it("Judge can select only among truth-valid reviewed candidates", () => {
    expect(() => selectJudgedCandidate({ candidateVersionIds: ["v1", "v2"], validVersionIds: ["v2"], selectedVersionId: "v1" })).toThrow(/valid candidate/i);
    expect(selectJudgedCandidate({ candidateVersionIds: ["v1", "v2"], validVersionIds: ["v2"], selectedVersionId: "v2" })).toBe("v2");
  });

  it("binds human approval to the exact current immutable version and destination", () => {
    const truth = evaluateTruthGate({ ...scope, claimUses: [], prohibitedBrandLanguage: [] });
    const review = completeContentReview({ review: requestContentReview({ id: "review-1", ...scope, truth, requestedAt: "2026-08-13T10:00:00Z" }), critic: { passed: true, score: 88, findings: [] }, revisionCycle: 0, completedAt: "2026-08-13T10:01:00Z" });
    const approval = approveContentVersion({ id: "approval-1", review, currentVersionId: "version-2", approverAccountId: "account-1", destination: { channel: "linkedin", accountRef: "company-page" }, approvedAt: "2026-08-13T10:02:00Z" });
    expect(approval).toMatchObject({ versionId: "version-2", approverAccountId: "account-1", destination: { channel: "linkedin", accountRef: "company-page" } });
    expect(() => approveContentVersion({ id: "approval-2", review, currentVersionId: "version-3", approverAccountId: "account-1", destination: { channel: "linkedin", accountRef: "company-page" }, approvedAt: "2026-08-13T10:03:00Z" })).toThrow(/current version/i);
  });
});
