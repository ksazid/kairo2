import { describe, expect, it } from "vitest";
import { discoveryEmptyState, discoveryRefreshMessage } from "./discovery-status";

describe("Discover status", () => {
  it("does not imply discoveries exist before Hunter has run", () => {
    expect(discoveryEmptyState({ authenticated: true, brandId: "brand-1", latestRun: null })).toEqual({
      title: "Ready to discover",
      message: expect.stringContaining("no discovery run has completed yet"),
    });
  });

  it("distinguishes a successful zero-opportunity run from readiness", () => {
    expect(discoveryEmptyState({
      authenticated: true,
      brandId: "brand-1",
      latestRun: {
        runId: "run-1",
        trigger: "manual",
        status: "succeeded",
        startedAt: "2026-09-06T00:00:00.000Z",
        completedAt: "2026-09-06T00:01:00.000Z",
        evidenceCount: 8,
        candidateCount: 3,
        opportunityCount: 0,
      },
    })).toEqual({
      title: "No new discoveries found",
      message: expect.stringContaining("will not fill Discover with demo or weak matches"),
    });
  });

  it("surfaces a failed latest Hunter run without exposing technical details", () => {
    const state = discoveryEmptyState({
      authenticated: true,
      brandId: "brand-1",
      latestRun: {
        runId: "run-1",
        trigger: "manual",
        status: "failed",
        startedAt: "2026-09-06T00:00:00.000Z",
        completedAt: "2026-09-06T00:01:00.000Z",
        evidenceCount: 0,
        candidateCount: 0,
        opportunityCount: 0,
        failureMessage: "could not determine data type of parameter $1",
      },
    });
    expect(state.title).toBe("Last discovery run failed");
    expect(state.message).not.toContain("parameter $1");
  });

  it("reports degraded sources after a zero-opportunity refresh", () => {
    expect(discoveryRefreshMessage({ evidenceCount: 0, candidateCount: 0, opportunityCount: 0, degradedSources: ["instagram"] }))
      .toContain("1 source was unavailable");
  });
});
