import { describe, expect, it } from "vitest";
import { appendContentVersion, createCampaign, createContentAsset, createInitialContentVersion, type CampaignLineage } from "./campaign";

const lineage: CampaignLineage = {
  workspaceId: "ws-1", brandId: "brand-1", ideaId: "idea-1", researchId: "research-1", angleId: "angle-1",
  angleStatus: "selected", supportingClaimIds: ["claim-1"],
};

describe("VS-05 Campaign and Content domain", () => {
  it("creates a Campaign only from a selected Angle and preserves lineage", () => {
    const campaign = createCampaign({ id: "campaign-1", name: "Evidence campaign", objective: "Educate founders", lineage, createdAt: "2026-08-13T10:00:00Z" });
    expect(campaign).toMatchObject({ workspaceId: "ws-1", brandId: "brand-1", ideaId: "idea-1", researchId: "research-1", angleId: "angle-1", status: "draft" });
    expect(() => createCampaign({ id: "campaign-2", name: "No selection", objective: "Educate", lineage: { ...lineage, angleStatus: "candidate" }, createdAt: "2026-08-13T10:00:00Z" })).toThrow(/selected angle/i);
  });

  it("creates a channel-specific Content Asset inside the Campaign scope", () => {
    const campaign = createCampaign({ id: "campaign-1", name: "Evidence campaign", objective: "Educate founders", lineage, createdAt: "2026-08-13T10:00:00Z" });
    const asset = createContentAsset({ id: "asset-1", campaign, channel: "linkedin", format: "text", audience: "Founders", topic: "Evidence", hookType: "data-led", cta: "Read the research", createdAt: "2026-08-13T10:01:00Z" });
    expect(asset).toMatchObject({ campaignId: campaign.id, channel: "linkedin", format: "text", currentVersion: 0, status: "draft" });
  });

  it("appends immutable, monotonically increasing Content Versions", () => {
    const campaign = createCampaign({ id: "campaign-1", name: "Evidence campaign", objective: "Educate founders", lineage, createdAt: "2026-08-13T10:00:00Z" });
    const asset = createContentAsset({ id: "asset-1", campaign, channel: "linkedin", format: "text", audience: "Founders", topic: "Evidence", hookType: "data-led", cta: "Read more", createdAt: "2026-08-13T10:01:00Z" });
    const first = createInitialContentVersion({ id: "version-1", asset, content: "The evidence supports a measured change.", supportingClaimIds: ["claim-1"], actor: "ai", action: "initial-draft", createdAt: "2026-08-13T10:02:00Z" });
    const second = appendContentVersion({ id: "version-2", asset: { ...asset, currentVersion: 1 }, parent: first, expectedVersion: 1, content: "The evidence supports a measured and useful change.", supportingClaimIds: ["claim-1"], actor: "user", action: "manual-edit", createdAt: "2026-08-13T10:03:00Z" });
    expect(first).toMatchObject({ version: 1, parentVersionId: null });
    expect(second).toMatchObject({ version: 2, parentVersionId: first.id, actor: "user", action: "manual-edit" });
    expect(first.content).toBe("The evidence supports a measured change.");
  });

  it("rejects stale appends and unsupported Claim references", () => {
    const campaign = createCampaign({ id: "campaign-1", name: "Evidence campaign", objective: "Educate founders", lineage, createdAt: "2026-08-13T10:00:00Z" });
    const asset = createContentAsset({ id: "asset-1", campaign, channel: "linkedin", format: "text", audience: "Founders", topic: "Evidence", hookType: "data-led", cta: "Read more", createdAt: "2026-08-13T10:01:00Z" });
    expect(() => createInitialContentVersion({ id: "version-1", asset, content: "Unsupported", supportingClaimIds: ["unknown"], actor: "ai", action: "initial-draft", createdAt: "2026-08-13T10:02:00Z" })).toThrow(/supporting claim/i);
    const first = createInitialContentVersion({ id: "version-1", asset, content: "Supported", supportingClaimIds: ["claim-1"], actor: "ai", action: "initial-draft", createdAt: "2026-08-13T10:02:00Z" });
    expect(() => appendContentVersion({ id: "version-2", asset: { ...asset, currentVersion: 1 }, parent: first, expectedVersion: 0, content: "Stale", supportingClaimIds: ["claim-1"], actor: "user", action: "manual-edit", createdAt: "2026-08-13T10:03:00Z" })).toThrow(/stale/i);
  });
});
