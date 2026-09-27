import { describe, expect, it } from "vitest";
import type { BrandIntelligenceSnapshot } from "@kairo/domain/brand-intelligence-snapshot";
import type { BrandDiscoveryPlan } from "@kairo/domain/brand-discovery-plan";
import {
  HUNTER_SHADOW_DISPOSABLE_BOOTSTRAP_MODE,
  HUNTER_SHADOW_MODEL_PRESSURE_POLICY,
  HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE,
  aggregateHunterShadowPreGateChunks,
  buildControlScreeningDiagnostic,
  hunterControlCapacityCheckFromEnv,
  hunterShadowEvidenceRequestFromEnv,
  hunterShadowSearchCostUsdBySourceFromEnv,
  resolveReadOnlyDiscoveryPlan,
  selectDisposableAnchorTenant,
  selectTargetedPersistedScreeningCandidate,
  disposableVercelCanonicalFields,
  type HunterShadowOperationalEvidence,
} from "./hunter-shadow-evidence-run";

const snapshot = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  brandName: "Example",
  snapshotVersion: "snapshot-v2",
  status: "ready",
  hunterReady: true,
  fields: [],
  readinessGaps: [],
  weakFields: [],
  context: {},
  updatedAt: "2026-09-20T10:00:00Z",
} as unknown as BrandIntelligenceSnapshot;

const customized: BrandDiscoveryPlan = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  revision: 4,
  planVersion: "snapshot-v1:discovery:4",
  snapshotVersion: "snapshot-v1",
  state: "customized",
  topics: [{
    id: "custom",
    name: "Custom topic",
    priority: "High",
    audience: "Audience",
    entities: ["Custom topic"],
    sourceClasses: ["Industry news"],
  }],
  excludedTopics: [],
  updatedAt: "2026-09-19T10:00:00Z",
};

describe("Hunter shadow operational evidence", () => {
  it("requires an explicit run ID and exact release SHA for the one-control check", () => {
    expect(hunterControlCapacityCheckFromEnv({})).toBeUndefined();
    expect(hunterControlCapacityCheckFromEnv({
      KAIRO_HUNTER_CONTROL_CAPACITY_CHECK_RUN_ID: "hi2-11r5r20-v1-capacity",
      KAIRO_RELEASE_SHA: "a".repeat(40),
    })).toEqual({ runId: "hi2-11r5r20-v1-capacity", releaseSha: "a".repeat(40) });
    expect(() => hunterControlCapacityCheckFromEnv({
      KAIRO_HUNTER_CONTROL_CAPACITY_CHECK_RUN_ID: "invalid run",
      KAIRO_RELEASE_SHA: "a".repeat(40),
    })).toThrow(/run ID/);
    expect(() => hunterControlCapacityCheckFromEnv({
      KAIRO_HUNTER_CONTROL_CAPACITY_CHECK_RUN_ID: "hi2-11r5r20-v1-capacity",
      KAIRO_RELEASE_SHA: "short",
    })).toThrow(/exact release SHA/);
  });
  it("requires a release-pinned 30-run minimum request", () => {
    const request = hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10r-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND: "10",
    });
    expect(request).toEqual({
      runId: "hi2-10r-shadow-001",
      releaseSha: "a".repeat(40),
      brandCount: 3,
      runsPerBrand: 10,
      allowEphemeralPublicBrands: false,
      allowDisposablePersistedAnchor: false,
      preGate: false,
      includeDetails: false,
    });

    expect(() => hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10r-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND: "5",
    })).toThrow(/at least 30/);
  });

  it("keeps the operational candidate capacity at six so the certified exploration ceiling is one item", () => {
    expect(HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE.maxCandidates).toBe(6);
    expect(HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE.enforceCertifiedFinalShares).toBe(true);
    expect(Math.floor(HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE.maxCandidates * 0.2)).toBe(1);
  });

  it("allows an explicit 3-by-3 pre-gate while retaining the 30-pair full gate", () => {
    const request = hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-11-pre-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_PRE_GATE: "true",
      KAIRO_HUNTER_SHADOW_EVIDENCE_INCLUDE_DETAILS: "true",
    });
    expect(request?.preGate).toBe(true);
    expect(request?.includeDetails).toBe(true);
    expect(request?.brandCount).toBe(3);
    expect(request?.runsPerBrand).toBe(3);

    expect(() => hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-11-full-too-small",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND: "3",
    })).toThrow(/at least 30/);
  });

  it("only enables one-pair mode for indexed 3-by-3 pre-gates", () => {
    const base = {
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-11r5r22-pre",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_PRE_GATE: "true",
    };
    expect(hunterShadowEvidenceRequestFromEnv({ ...base, KAIRO_HUNTER_SHADOW_EVIDENCE_CASE_INDEX: "9" })?.caseIndex).toBe(9);
    expect(() => hunterShadowEvidenceRequestFromEnv({ ...base, KAIRO_HUNTER_SHADOW_EVIDENCE_CASE_INDEX: "10" })).toThrow(/CASE_INDEX/);
    expect(() => hunterShadowEvidenceRequestFromEnv({ ...base, KAIRO_HUNTER_SHADOW_EVIDENCE_PRE_GATE: "false", KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND: "10", KAIRO_HUNTER_SHADOW_EVIDENCE_CASE_INDEX: "1" })).toThrow(/3-by-3 pre-gate/);
    expect(hunterShadowEvidenceRequestFromEnv({
      ...base, KAIRO_HUNTER_SHADOW_EVIDENCE_EPHEMERAL_PUBLIC_BRANDS: "true",
      KAIRO_HUNTER_SHADOW_EVIDENCE_PERSISTED_BRAND_NAME: "Python",
    })?.persistedAnchorBrandName).toBe("Python");
    expect(() => hunterShadowEvidenceRequestFromEnv({
      ...base, KAIRO_HUNTER_SHADOW_EVIDENCE_PERSISTED_BRAND_NAME: "Python",
    })).toThrow(/public fixtures/);
  });

  it("aggregates exactly nine matching saved pairs and rejects gaps, duplicates and changed cohorts", () => {
    const chunks = Array.from({ length: 9 }, (_, position): HunterShadowOperationalEvidence => {
      const index = position + 1;
      const brandKey = `brand-${Math.floor(position / 3)}`;
      return {
        schemaVersion: 1, evidenceKind: "hunter-v2-shadow-operational",
        runId: "hi2-11r5r22-pre", releaseSha: "a".repeat(40),
        startedAt: "2026-09-27T00:00:00Z", completedAt: "2026-09-27T00:01:00Z",
        brandCount: 1, pairCount: 1,
        cohort: { persistedBrands: 1, disposablePersistedBrands: 0, ephemeralPublicBrands: 2 },
        costScope: "model-plus-configured-search", gateMode: "pre-gate",
        chunk: { caseIndex: index, caseCount: 9, cohortFingerprint: "f".repeat(64) },
        readiness: {} as HunterShadowOperationalEvidence["readiness"],
        observations: [{
          comparisonId: `hi2-11r5r22-pre:${brandKey}:${String(position % 3 + 1).padStart(2, "0")}`,
          brandKey, v1QualityScore: 0.7, v2QualityScore: 0.7,
          retrievalCoverage: 1, v1LatencyMs: 1000, v2LatencyMs: 1000,
          v1CostUsd: 0.01, v2CostUsd: 0.01, v2Failure: false,
          explorationShare: 1 / 6, maximumTopicShare: 0.25,
        }],
      };
    });
    expect(aggregateHunterShadowPreGateChunks(chunks)).toMatchObject({ pairCount: 9, preGatePassed: true });
    expect(() => aggregateHunterShadowPreGateChunks(chunks.slice(0, 8))).toThrow(/nine/);
    expect(() => aggregateHunterShadowPreGateChunks([...chunks.slice(0, 8), chunks[0]!])).toThrow(/duplicate/);
    expect(() => aggregateHunterShadowPreGateChunks([...chunks.slice(0, 8), { ...chunks[8]!, chunk: { ...chunks[8]!.chunk!, cohortFingerprint: "e".repeat(64) } }])).toThrow(/inconsistent/);
    const poor = chunks.map((item) => ({ ...item, observations: item.observations.map((observation) => ({ ...observation, v2QualityScore: 0.5 })) }));
    expect(aggregateHunterShadowPreGateChunks(poor)).toMatchObject({ preGatePassed: false });
  });

  it("enables ephemeral public Brand coverage only by an explicit exact true flag", () => {
    expect(hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10e-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_EPHEMERAL_PUBLIC_BRANDS: "true",
    })?.allowEphemeralPublicBrands).toBe(true);

    expect(hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10e-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_EPHEMERAL_PUBLIC_BRANDS: "1",
    })?.allowEphemeralPublicBrands).toBe(false);
  });

  it("enables the disposable persisted anchor only by an explicit exact true flag", () => {
    expect(hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10p-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_DISPOSABLE_PERSISTED_ANCHOR: "true",
    })?.allowDisposablePersistedAnchor).toBe(true);

    expect(hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10p-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_DISPOSABLE_PERSISTED_ANCHOR: "yes",
    })?.allowDisposablePersistedAnchor).toBe(false);
  });

  it("accepts a targeted anchor Brand only as a validated UUID", () => {
    expect(hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10t-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_ANCHOR_BRAND_ID:
        "0fbb9882-af46-4cd8-a86c-f7ffe33aac2b",
    })?.anchorBrandId).toBe("0fbb9882-af46-4cd8-a86c-f7ffe33aac2b");

    expect(() => hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10t-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_ANCHOR_BRAND_ID: "not-a-uuid",
    })).toThrow(/valid lowercase UUID/);
  });

  it("selects only the explicitly targeted Brand workspace for a disposable anchor", () => {
    expect(selectDisposableAnchorTenant([
      { accountId: "account-z", workspaceId: "workspace-2", brandId: "brand-other" },
      { accountId: "account-b", workspaceId: "workspace-1", brandId: "brand-target" },
      { accountId: "account-a", workspaceId: "workspace-1", brandId: "brand-target" },
    ], "brand-target")).toEqual({ accountId: "account-a", workspaceId: "workspace-1" });

    expect(() => selectDisposableAnchorTenant([
      { accountId: "account-z", workspaceId: "workspace-2", brandId: "brand-other" },
    ], "brand-target")).toThrow(/Target Hunter shadow anchor Brand is unavailable/);
  });

  it("reports exact preflight screening failures instead of dropping rejected controls", () => {
    expect(buildControlScreeningDiagnostic({
      item: {
        workspaceId: "workspace-1",
        brandId: "brand-1",
        origin: "ephemeral-public",
        context: {
          hunterInput: {
            brand: {
              workspaceId: "workspace-1",
              brandId: "brand-1",
              brandName: "Fixture Brand",
            },
          } as never,
        },
      },
      reason: "control-non-comparable",
      control: {
        inputFingerprint: "0".repeat(64),
        workspaceId: "workspace-1",
        brandId: "brand-1",
        qualityScore: 0,
        recommendationCount: 4,
        evidenceCount: 20,
        modelInvocationCount: 1,
        criticalDependencyDegraded: true,
        criticalDependencyFailures: [
          { phase: "judgment", source: "hunter-model", kind: "rate-limited", statusCode: 429 },
        ],
        metadata: { latencyMs: 1200, costUsd: 0 },
      },
    })).toMatchObject({
      origin: "ephemeral-public",
      brandName: "Fixture Brand",
      reason: "control-non-comparable",
      failures: ["criticalDependencyDegraded", "costUsd"],
      values: {
        evidenceCount: 20,
        modelInvocationCount: 1,
        criticalDependencyDegraded: true,
        criticalDependencyFailures: [
          { phase: "judgment", source: "hunter-model", kind: "rate-limited", statusCode: 429 },
        ],
        costUsd: 0,
        latencyMs: 1200,
        recommendationCount: 4,
      },
    });
  });

  it("collapses targeted persisted screening to one account/Brand candidate", () => {
    expect(selectTargetedPersistedScreeningCandidate([
      { accountId: "account-z", workspaceId: "workspace-2", brandId: "brand-other" },
      { accountId: "account-b", workspaceId: "workspace-1", brandId: "brand-target" },
      { accountId: "account-a", workspaceId: "workspace-1", brandId: "brand-target" },
    ], "brand-target")).toEqual({
      accountId: "account-a",
      workspaceId: "workspace-1",
      brandId: "brand-target",
    });
  });

  it("retains the untargeted single-workspace fail-closed guard", () => {
    expect(selectDisposableAnchorTenant([
      { accountId: "account-b", workspaceId: "workspace-1", brandId: "brand-1" },
      { accountId: "account-a", workspaceId: "workspace-1", brandId: "brand-2" },
    ])).toEqual({ accountId: "account-a", workspaceId: "workspace-1" });

    expect(() => selectDisposableAnchorTenant([])).toThrow(/existing persisted Brand/);
    expect(() => selectDisposableAnchorTenant([
      { accountId: "account-a", workspaceId: "workspace-1", brandId: "brand-1" },
      { accountId: "account-b", workspaceId: "workspace-2", brandId: "brand-2" },
    ])).toThrow(/one unambiguous workspace/);
  });

  it("keeps disposable Vercel bootstrap source-backed and deterministic so model quota is reserved for the measured V1 control", () => {
    expect(HUNTER_SHADOW_DISPOSABLE_BOOTSTRAP_MODE).toBe("source-backed-deterministic");
  });

  it("defines all six canonical source-backed readiness groups for the disposable Vercel fixture", () => {
    const fields = disposableVercelCanonicalFields("about-source", "policy-source");
    expect(fields.map((field) => field.fieldKey)).toEqual([
      "identity.description",
      "identity.products-services",
      "audience.primary",
      "positioning.value-proposition",
      "content.core-topics",
      "boundaries.excluded-topics",
    ]);
    expect(fields.slice(0, 5).every((field) => field.sourceIds[0] === "about-source")).toBe(true);
    expect(fields[5]!.sourceIds).toEqual(["policy-source"]);
    expect(fields.every((field) => field.value.trim().length > 20)).toBe(true);
  });

  it("keeps the operational V2 profile on a two-intent cost bound with reserved exploration", () => {
    expect(HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE).toEqual({
      maxIntents: 2,
      maxSourcesPerIntent: 2,
      maxPaidIntents: 2,
      maxExternalCalls: 2,
      maxSemanticCalls: 0,
      deepLimit: 2,
      deepAnalysisConcurrency: 1,
      maxCandidates: 6,
      enforceCertifiedFinalShares: true,
    });
  });

  it("serializes deep analysis and spaces paired runs without reducing the certified work profile", () => {
    expect(HUNTER_SHADOW_MODEL_PRESSURE_POLICY).toEqual({
      deepAnalysisConcurrency: 1,
      betweenControlPreflightsMs: 90_000,
      afterScreeningDelayMs: 90_000,
      betweenPairsDelayMs: 90_000,
    });
    expect(HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE.deepLimit).toBe(2);
    expect(HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE.maxCandidates).toBe(6);
  });

  it("requires explicit Agent Reach cost metering when Exa is enabled", () => {
    expect(() => hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10r-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      EXA_API_KEY: "configured",
    })).toThrow(/SEARCH_COST_USD/);

    expect(hunterShadowSearchCostUsdBySourceFromEnv({
      KAIRO_HUNTER_AGENT_REACH_SEARCH_COST_USD: "0.004",
    })).toEqual({ "agent-reach": 0.004 });
  });

  it("keeps a customized plan read-only even when its snapshot is older", () => {
    expect(resolveReadOnlyDiscoveryPlan(customized, snapshot)).toBe(customized);
  });

  it("projects an updated in-memory plan instead of persisting when an initial plan is stale", () => {
    const initial = { ...customized, state: "initial" as const };
    const projected = resolveReadOnlyDiscoveryPlan(initial, snapshot);
    expect(projected).not.toBe(initial);
    expect(projected.revision).toBe(5);
    expect(projected.snapshotVersion).toBe("snapshot-v2");
  });
});
