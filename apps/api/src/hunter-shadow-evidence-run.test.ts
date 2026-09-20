import { describe, expect, it } from "vitest";
import type { BrandIntelligenceSnapshot } from "@kairo/domain/brand-intelligence-snapshot";
import type { BrandDiscoveryPlan } from "@kairo/domain/brand-discovery-plan";
import {
  HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE,
  hunterShadowEvidenceRequestFromEnv,
  hunterShadowSearchCostUsdBySourceFromEnv,
  resolveReadOnlyDiscoveryPlan,
  selectDisposableAnchorTenant,
  disposableVercelCanonicalFields,
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

  it("keeps the operational V2 profile on bounded multi-source retrieval with a reserved exploration-capable plan", () => {
    expect(HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE).toEqual({
      maxIntents: 3,
      maxSourcesPerIntent: 2,
      maxPaidIntents: 3,
      maxExternalCalls: 3,
      maxSemanticCalls: 0,
      deepLimit: 2,
      maxCandidates: 10,
    });
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
