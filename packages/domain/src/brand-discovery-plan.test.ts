import { describe, expect, it } from "vitest";
import {
  BrandDiscoveryPlanService,
  projectInitialBrandDiscoveryPlan,
  type BrandDiscoveryPlan,
  type BrandDiscoveryPlanRepository,
} from "./brand-discovery-plan";
import type { BrandIntelligenceSnapshot } from "./brand-intelligence-snapshot";

const snapshot: BrandIntelligenceSnapshot = {
  schemaVersion: "1",
  snapshotVersion: "brand-1@2026-09-01T10:00:00.000Z",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  brandName: "Kairo",
  status: "ready-for-hunter",
  hunterReady: true,
  completeness: { score: 92, knownGroups: 6, totalGroups: 6 },
  readiness: { status: "ready", score: 92, brandIntelligenceScore: 90, evidenceCoverage: 84, confidence: 88, gaps: [], evaluatedAt: "2026-09-01T10:00:00.000Z" },
  context: { brandName: "Kairo" },
  fields: [
    { fieldKey: "audience.primary", section: "audience", value: "Malta founders", state: "confirmed", origin: "user-confirmed", confidence: { score: 1, level: "high" }, sourceIds: [], version: 1, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "identity.geography", section: "identity", value: "Malta", state: "inferred", origin: "source-backed", confidence: { score: .85, level: "high" }, sourceIds: ["source-1"], version: 1, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "content.preferred-topics", section: "content-strategy", value: "AI automation, software architecture", state: "inferred", origin: "source-backed", confidence: { score: .85, level: "high" }, sourceIds: ["source-1"], version: 1, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "content.channels", section: "content-strategy", value: "LinkedIn, YouTube", state: "inferred", origin: "source-backed", confidence: { score: .85, level: "high" }, sourceIds: ["source-1"], version: 1, updatedAt: "2026-09-01T10:00:00.000Z" },
    { fieldKey: "boundaries.excluded-topics", section: "boundaries", value: "Restricted topics; unsupported claims", state: "confirmed", origin: "user-confirmed", confidence: { score: 1, level: "high" }, sourceIds: [], version: 1, updatedAt: "2026-09-01T10:00:00.000Z" },
  ],
  weakFields: [], readinessGaps: [], evidenceSourceIds: ["source-1"], activeSourceIds: ["source-1"], performanceMemory: [], updatedAt: "2026-09-01T10:00:00.000Z",
};

class MemoryPlanRepository implements BrandDiscoveryPlanRepository {
  readonly versions: BrandDiscoveryPlan[] = [];
  async getLatest(_accountId: string, brandId: string) { return this.versions.filter((plan) => plan.brandId === brandId).at(-1); }
  async append(_accountId: string, plan: BrandDiscoveryPlan) { this.versions.push(structuredClone(plan)); return structuredClone(plan); }
}

describe("Brand Discovery Plan", () => {
  it("derives truthful initial topics from canonical Brand intelligence without inventing a Hunter run", () => {
    const plan = projectInitialBrandDiscoveryPlan(snapshot);
    expect(plan.workspaceId).toBe(snapshot.workspaceId);
    expect(plan.brandId).toBe(snapshot.brandId);
    expect(plan.revision).toBe(1);
    expect(plan.snapshotVersion).toBe(snapshot.snapshotVersion);
    expect(plan.planVersion).toContain(snapshot.snapshotVersion);
    expect(plan.state).toBe("initial");
    expect(plan.topics.map((topic) => topic.name)).toEqual(["AI automation", "software architecture"]);
    expect(plan.topics[0]?.audience).toBe("Malta founders");
    expect(plan.topics[0]?.entities).toContain("AI automation Malta");
    expect(plan.topics[0]?.sourceClasses).toEqual(expect.arrayContaining(["Official sources", "Industry news", "LinkedIn", "YouTube"]));
    expect(plan.excludedTopics).toEqual(["Restricted topics", "unsupported claims"]);
  });

  it("persists once for the same snapshot and advances an untouched initial plan when Brand Intelligence changes", async () => {
    const repository = new MemoryPlanRepository();
    const service = new BrandDiscoveryPlanService(repository);
    const first = await service.ensure("account-1", snapshot);
    const repeated = await service.ensure("account-1", snapshot);
    expect(repeated.planVersion).toBe(first.planVersion);
    expect(repository.versions).toHaveLength(1);

    const newer = { ...snapshot, snapshotVersion: "brand-1@2026-09-01T11:00:00.000Z", updatedAt: "2026-09-01T11:00:00.000Z" };
    const refreshed = await service.ensure("account-1", newer);
    expect(refreshed.revision).toBe(2);
    expect(refreshed.snapshotVersion).toBe(newer.snapshotVersion);
    expect(repository.versions).toHaveLength(2);
  });

  it("appends customized topic and source-policy revisions and never silently overwrites them after a later Brain snapshot", async () => {
    const repository = new MemoryPlanRepository();
    const service = new BrandDiscoveryPlanService(repository);
    const first = await service.ensure("account-1", snapshot);
    const edited = await service.updateTopic("account-1", snapshot.brandId, first.topics[0]!.id, {
      expectedRevision: first.revision,
      name: "Applied agent systems",
      audience: "Software teams",
      entities: ["agent architecture", "production agents"],
      sourceClasses: ["Official sources", "GitHub", "No Hacker News"],
    });
    expect(edited.revision).toBe(2);
    expect(edited.state).toBe("customized");
    expect(edited.topics[0]).toMatchObject({
      name: "Applied agent systems",
      audience: "Software teams",
      entities: ["agent architecture", "production agents"],
      sourceClasses: ["Official sources", "GitHub", "No Hacker News"],
    });

    const newer = { ...snapshot, snapshotVersion: "brand-1@2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" };
    const preserved = await service.ensure("account-1", newer);
    expect(preserved.planVersion).toBe(edited.planVersion);
    expect(preserved.snapshotVersion).toBe(snapshot.snapshotVersion);
    expect(repository.versions).toHaveLength(2);
  });
});
