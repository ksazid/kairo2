import { describe, expect, it } from "vitest";
import type { BrandIntelligenceSnapshot } from "@kairo/domain/brand-intelligence-snapshot";
import type { BrandDiscoveryPlan } from "@kairo/domain/brand-discovery-plan";
import {
  hunterShadowEvidenceRequestFromEnv,
  hunterShadowSearchCostUsdBySourceFromEnv,
  resolveReadOnlyDiscoveryPlan,
  selectDisposableAnchorTenant,
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
    });

    expect(() => hunterShadowEvidenceRequestFromEnv({
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID: "hi2-10r-shadow-001",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA: "a".repeat(40),
      KAIRO_RELEASE_SHA: "a".repeat(40),
      KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS: "3",
      KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND: "5",
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

  it("selects only one unambiguous existing workspace for a disposable anchor", () => {
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
