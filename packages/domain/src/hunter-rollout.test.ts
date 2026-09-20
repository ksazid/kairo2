import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUNTER_ROLLOUT_POLICY,
  evaluateHunterRolloutReadiness,
  type HunterCanaryRolloutObservation,
  type HunterShadowRolloutObservation,
} from "./hunter-rollout";

function shadow(i: number, overrides: Partial<HunterShadowRolloutObservation> = {}): HunterShadowRolloutObservation {
  return {
    runId: "shadow-" + i,
    brandId: "brand-" + (i % 3),
    v1QualityScore: 0.78,
    v2QualityScore: 0.82,
    retrievalCoverage: 0.92,
    v1LatencyMs: 1000,
    v2LatencyMs: 1200,
    v1CostUsd: 0.08,
    v2CostUsd: 0.1,
    v2Failure: false,
    explorationShare: 0.12,
    maximumTopicShare: 0.3,
    ...overrides,
  };
}

function canary(i: number, overrides: Partial<HunterCanaryRolloutObservation> = {}): HunterCanaryRolloutObservation {
  return {
    runId: "canary-" + i,
    brandId: "brand-" + (i % 3),
    controlPositiveActionRate: 0.24,
    canaryPositiveActionRate: 0.26,
    controlNegativeActionRate: 0.1,
    canaryNegativeActionRate: 0.1,
    canaryFailure: false,
    ...overrides,
  };
}

describe("Hunter rollout readiness", () => {
  it("allows canary after sufficient safe shadow evidence but blocks production without explicit enable approval", () => {
    const result = evaluateHunterRolloutReadiness({
      shadow: Array.from({ length: 30 }, (_, i) => shadow(i)),
    });

    expect(result.shadowReady).toBe(true);
    expect(result.canaryReady).toBe(true);
    expect(result.allowedStage).toBe("canary");
    expect(result.productionReady).toBe(false);
    expect(result.warnings.join(" ")).toContain("production-enable approval");
    expect(result.killSwitch).toBe(false);
  });

  it("allows production only with sufficient canary evidence and explicit production-enable approval", () => {
    const result = evaluateHunterRolloutReadiness({
      shadow: Array.from({ length: 30 }, (_, i) => shadow(i)),
      canary: Array.from({ length: 50 }, (_, i) => canary(i)),
      productionEnableApproved: true,
    });

    expect(result.allowedStage).toBe("production");
    expect(result.productionReady).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("forces rollout off and kill-switch on any critical authority or safety violation", () => {
    const result = evaluateHunterRolloutReadiness({
      shadow: Array.from({ length: 30 }, (_, i) =>
        shadow(i, i === 7 ? { criticalViolations: ["tenant-isolation"] } : {}),
      ),
      canary: Array.from({ length: 50 }, (_, i) => canary(i)),
      productionEnableApproved: true,
    });

    expect(result.killSwitch).toBe(true);
    expect(result.allowedStage).toBe("off");
    expect(result.productionReady).toBe(false);
    expect(result.blockers.join(" ")).toContain("Critical safety or authority violation");
  });

  it("holds canary when certified EEI exploration or topic-concentration bounds are violated", () => {
    const lowExploration = evaluateHunterRolloutReadiness({
      shadow: Array.from({ length: 30 }, (_, i) =>
        shadow(i, i === 0 ? { explorationShare: 0.05 } : {}),
      ),
    });
    expect(lowExploration.canaryReady).toBe(false);
    expect(lowExploration.blockers.join(" ")).toContain("Exploration share fell below");

    const topicConcentration = evaluateHunterRolloutReadiness({
      shadow: Array.from({ length: 30 }, (_, i) =>
        shadow(i, i === 0 ? { maximumTopicShare: 0.4 } : {}),
      ),
    });
    expect(topicConcentration.canaryReady).toBe(false);
    expect(topicConcentration.blockers.join(" ")).toContain("Topic concentration exceeded");
  });

  it("holds rollout on quality, reliability, latency, cost or retrieval regressions", () => {
    const result = evaluateHunterRolloutReadiness({
      shadow: Array.from({ length: 30 }, (_, i) => shadow(i, {
        v2QualityScore: 0.7,
        retrievalCoverage: 0.7,
        v2LatencyMs: 1800,
        v2CostUsd: 0.14,
        v2Failure: i < 3,
      })),
    });

    expect(result.canaryReady).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "Hunter V2 shadow quality regresses beyond policy.",
      "Hunter V2 retrieval coverage is below policy.",
      "Hunter V2 shadow failure rate exceeds policy.",
      "Hunter V2 p95 latency ratio exceeds policy.",
      "Hunter V2 average cost ratio exceeds policy.",
    ]));
  });

  it("requires canary user-outcome non-regression even after shadow is ready", () => {
    const result = evaluateHunterRolloutReadiness({
      shadow: Array.from({ length: 30 }, (_, i) => shadow(i)),
      canary: Array.from({ length: 50 }, (_, i) => canary(i, {
        canaryPositiveActionRate: 0.18,
        canaryNegativeActionRate: 0.16,
      })),
      productionEnableApproved: true,
    });

    expect(result.allowedStage).toBe("canary");
    expect(result.productionReady).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "Canary positive-action rate regresses beyond policy.",
      "Canary negative-action rate regresses beyond policy.",
    ]));
  });

  it("ships conservative policy defaults matching certified EEI limits", () => {
    expect(DEFAULT_HUNTER_ROLLOUT_POLICY.explorationMin).toBe(0.08);
    expect(DEFAULT_HUNTER_ROLLOUT_POLICY.explorationMax).toBe(0.2);
    expect(DEFAULT_HUNTER_ROLLOUT_POLICY.maximumTopicShare).toBe(0.34);
    expect(DEFAULT_HUNTER_ROLLOUT_POLICY.minShadowRuns).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_HUNTER_ROLLOUT_POLICY.minCanaryRuns).toBeGreaterThanOrEqual(50);
  });
});
