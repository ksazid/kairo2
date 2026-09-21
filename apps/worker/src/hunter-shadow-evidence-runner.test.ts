import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  runHunterShadowEvidenceBatch,
  runHunterShadowEvidencePair,
  type HunterShadowLaneExecutor,
  type HunterShadowRunCase,
} from "./hunter-shadow-evidence-runner";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function run(i: number): HunterShadowRunCase {
  return {
    comparisonId: "shadow-" + i,
    workspaceId: "workspace-1",
    brandId: "brand-" + (i % 3),
    inputFingerprint: hash("input-" + i),
  };
}

function executor(overrides: {
  fingerprintMismatch?: boolean;
  persistenceAttempted?: boolean;
} = {}): HunterShadowLaneExecutor {
  return {
    async runControl(value) {
      return {
        inputFingerprint: value.inputFingerprint,
        workspaceId: value.workspaceId,
        brandId: value.brandId,
        qualityScore: 0.78,
        recommendationCount: 1,
        metadata: { latencyMs: 1000, costUsd: 0.08 },
      };
    },
    async runCandidate(value) {
      return {
        inputFingerprint: overrides.fingerprintMismatch ? hash("other") : value.inputFingerprint,
        workspaceId: value.workspaceId,
        brandId: value.brandId,
        qualityScore: 0.82,
        recommendationCount: 10,
        metadata: { latencyMs: 1200, costUsd: 0.1 },
        retrievalExpected: 10,
        retrievalCovered: 9,
        failed: false,
        explorationRecommendations: 1,
        recommendationTopics: [
          "topic-a", "topic-a", "topic-b", "topic-c", "topic-d",
          "topic-e", "topic-f", "topic-g", "topic-h", "topic-i",
        ],
        tenantIsolationVerified: true,
        manipulationSafetyVerified: true,
        provenanceComplete: true,
        persistenceAttempted: overrides.persistenceAttempted ?? false,
        productionGuardIntact: true,
      };
    },
  };
}

describe("Hunter shadow evidence runner", () => {
  it("runs control then candidate and produces a paired deterministic observation", async () => {
    const order: string[] = [];
    const base = executor();
    const wrapped: HunterShadowLaneExecutor = {
      async runControl(value) {
        order.push("control");
        return base.runControl(value);
      },
      async runCandidate(value) {
        order.push("candidate");
        return base.runCandidate(value);
      },
    };

    const result = await runHunterShadowEvidencePair(run(1), wrapped);
    expect(order).toEqual(["control", "candidate"]);
    expect(result.observation).toMatchObject({
      v1QualityScore: 0.78,
      v2QualityScore: 0.82,
      retrievalCoverage: 0.9,
      explorationShare: 0.1,
      maximumTopicShare: 0.2,
    });
  });

  it("marks mismatched paired inputs as evidence-provenance violations", async () => {
    const result = await runHunterShadowEvidencePair(run(1), executor({ fingerprintMismatch: true }));
    expect(result.observation.criticalViolations).toContain("evidence-provenance");
  });

  it("propagates persistence attempts into the rollout kill switch", async () => {
    const batch = await runHunterShadowEvidenceBatch(
      Array.from({ length: 30 }, (_, i) => run(i)),
      executor({ persistenceAttempted: true }),
    );
    expect(batch.readiness.killSwitch).toBe(true);
    expect(batch.readiness.allowedStage).toBe("off");
  });

  it("reaches canary eligibility only after sufficient safe measured shadow evidence", async () => {
    const batch = await runHunterShadowEvidenceBatch(
      Array.from({ length: 30 }, (_, i) => run(i)),
      executor(),
    );

    expect(batch.pairs).toHaveLength(30);
    expect(batch.readiness.shadowReady).toBe(true);
    expect(batch.readiness.canaryReady).toBe(true);
    expect(batch.readiness.allowedStage).toBe("canary");
    expect(batch.readiness.productionReady).toBe(false);
  });

  it("rejects a no-op V1 control before ratio evaluation", async () => {
    const broken = executor();
    broken.runControl = async (value) => ({
      ...(await executor().runControl(value)),
      qualityScore: 0,
      recommendationCount: 0,
      metadata: { latencyMs: 250, costUsd: 0 },
    });

    await expect(runHunterShadowEvidencePair(run(1), broken)).rejects.toThrow(
      /Comparable Hunter V1 control/,
    );
  });

  it("rejects missing or fabricated-looking metering instead of assuming zero cost or latency", async () => {
    const broken = executor();
    broken.runCandidate = async (value) => ({
      ...(await executor().runCandidate(value)),
      metadata: { latencyMs: 0, costUsd: Number.NaN },
    });

    await expect(runHunterShadowEvidencePair(run(1), broken)).rejects.toThrow(/Measured positive latency/);
  });
});
