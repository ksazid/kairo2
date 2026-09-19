import { describe, expect, it } from "vitest";
import { CampaignService, ContentAssetSelectionService, type CampaignDetail, type CampaignRepository } from "./campaign-service";
import type { Campaign, ContentAsset, ContentVersion } from "./campaign";
import type { ContentAssetLibrary, ContentAssetLibraryRepository, ContentAssetProviderStateInput, ContentLibraryAsset } from "./content-asset-library";

const campaign: Campaign = {
  id: "campaign-1", workspaceId: "workspace-1", brandId: "brand-1", ideaId: "idea-1", researchId: "research-1", angleId: "angle-1",
  name: "Launch", objective: "Launch well", supportingClaimIds: ["claim-1"], status: "draft", createdAt: "2026-08-18T20:00:00.000Z",
};
const asset: ContentAsset = {
  id: "content-1", workspaceId: "workspace-1", brandId: "brand-1", campaignId: "campaign-1", channel: "instagram", format: "carousel",
  audience: "Builders", topic: "Launch", hookType: "problem", cta: "Try it", supportingClaimIds: ["claim-1"], currentVersion: 1, status: "draft", createdAt: "2026-08-18T20:01:00.000Z",
};
const initial: ContentVersion = {
  id: "version-1", workspaceId: "workspace-1", brandId: "brand-1", campaignId: "campaign-1", assetId: "content-1", version: 1,
  parentVersionId: null, content: "Launch copy", supportingClaimIds: ["claim-1"], actor: "user", action: "manual-edit", createdAt: "2026-08-18T20:02:00.000Z",
};

class Campaigns implements CampaignRepository {
  detail: CampaignDetail = { campaign, assets: [{ asset: { ...asset }, versions: [{ ...initial }] }] };
  async saveCampaign() { return campaign; }
  async listCampaigns() { return [campaign]; }
  async getCampaign(_accountId: string, brandId: string, campaignId: string) { return brandId === campaign.brandId && campaignId === campaign.id ? this.detail : null; }
  async saveAssetWithVersion() { return this.detail; }
  async appendVersion(_accountId: string, brandId: string, campaignId: string, assetId: string, expectedVersion: number, build: (asset: ContentAsset, parent: ContentVersion) => ContentVersion) {
    const entry = this.detail.assets.find((item) => item.asset.id === assetId);
    if (!entry || brandId !== campaign.brandId || campaignId !== campaign.id) throw Object.assign(new Error("Content Asset not found"), { code: "resource_not_found" });
    if (entry.asset.currentVersion !== expectedVersion) throw Object.assign(new Error("Content Version is stale"), { code: "concurrency_conflict" });
    const parent = entry.versions.at(-1)!;
    const next = build(entry.asset, parent);
    entry.versions.push(next);
    entry.asset = { ...entry.asset, currentVersion: next.version };
    return this.detail;
  }
}

class Libraries implements ContentAssetLibraryRepository {
  libraries: ContentAssetLibrary[] = [
    { id: "library-drive", workspaceId: "workspace-1", brandId: "brand-1", name: "Approved Drive", provider: "google-drive", status: "connected", createdAt: "2026-08-18T19:00:00.000Z", updatedAt: "2026-08-18T19:00:00.000Z" },
    { id: "library-manual", workspaceId: "workspace-1", brandId: "brand-1", name: "Manual refs", provider: "manual", status: "connected", createdAt: "2026-08-18T19:00:00.000Z", updatedAt: "2026-08-18T19:00:00.000Z" },
  ];
  assets: ContentLibraryAsset[] = [
    { id: "library-drive:hero", workspaceId: "workspace-1", brandId: "brand-1", libraryId: "library-drive", externalId: "hero", name: "Hero.jpg", kind: "image", mimeType: "image/jpeg", providerRef: "https://drive.google.com/file/d/hero/view", indexedAt: "2026-08-18T19:05:00.000Z" },
    { id: "library-manual:brief", workspaceId: "workspace-1", brandId: "brand-1", libraryId: "library-manual", externalId: "brief", name: "Brief.pdf", kind: "document", mimeType: "application/pdf", indexedAt: "2026-08-18T19:06:00.000Z" },
  ];
  async saveLibrary(_accountId: string, library: ContentAssetLibrary) { return library; }
  async listLibraries(_accountId: string, brandId: string) { return this.libraries.filter((item) => item.brandId === brandId); }
  async getLibrary(_accountId: string, brandId: string, libraryId: string) { return this.libraries.find((item) => item.brandId === brandId && item.id === libraryId) ?? null; }
  async listAssets(_accountId: string, brandId: string) { return this.assets.filter((item) => item.brandId === brandId); }
  async getAssetsByIds(_accountId: string, brandId: string, ids: string[]) { return this.assets.filter((item) => item.brandId === brandId && ids.includes(item.id)); }
  async replaceIndexedAssets() {}
  async updateProviderState(_accountId: string, _brandId: string, _libraryId: string, _input: ContentAssetProviderStateInput): Promise<ContentAssetLibrary> { throw new Error("not used"); }
  async clearIndexedAssets() {}
}

function selectionFixture() {
  const campaigns = new Campaigns();
  const libraries = new Libraries();
  let id = 1;
  const service = new ContentAssetSelectionService(campaigns, libraries, () => new Date("2026-08-18T21:00:00.000Z"), () => `selection-${id++}`);
  return { campaigns, libraries, service };
}

describe("VS-61 Content Asset selection", () => {
  it("snapshots only server-owned Brand-authorized metadata into a new immutable Content Version", async () => {
    const f = selectionFixture();
    const detail = await f.service.select("account-1", "brand-1", "campaign-1", "content-1", {
      expectedVersion: 1,
      libraryAssetIds: ["library-drive:hero", "library-manual:brief"],
    });
    const current = detail.assets[0]!.versions.at(-1)!;
    expect(current).toMatchObject({ version: 2, parentVersionId: "version-1", action: "asset-selection", actor: "user", content: "Launch copy" });
    expect(current.libraryAssetRefs).toEqual([
      {
        libraryId: "library-drive", libraryAssetId: "library-drive:hero", libraryName: "Approved Drive", provider: "google-drive", externalId: "hero",
        name: "Hero.jpg", kind: "image", mimeType: "image/jpeg", providerRef: "https://drive.google.com/file/d/hero/view", indexedAt: "2026-08-18T19:05:00.000Z",
      },
      {
        libraryId: "library-manual", libraryAssetId: "library-manual:brief", libraryName: "Manual refs", provider: "manual", externalId: "brief",
        name: "Brief.pdf", kind: "document", mimeType: "application/pdf", indexedAt: "2026-08-18T19:06:00.000Z",
      },
    ]);
  });

  it("rejects duplicate, excessive and missing/cross-Brand selections before version creation", async () => {
    const f = selectionFixture();
    await expect(f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 1, libraryAssetIds: ["library-drive:hero", "library-drive:hero"] })).rejects.toThrow(/duplicates/);
    await expect(f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 1, libraryAssetIds: Array.from({ length: 13 }, (_, index) => `asset-${index}`) })).rejects.toThrow(/12/);
    await expect(f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 1, libraryAssetIds: ["other-brand:file"] })).rejects.toMatchObject({ code: "resource_not_found" });
    expect(f.campaigns.detail.assets[0]!.asset.currentVersion).toBe(1);
  });

  it("creates a new version when clearing a selection and rejects an exact no-op", async () => {
    const f = selectionFixture();
    await f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 1, libraryAssetIds: ["library-drive:hero"] });
    await expect(f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 2, libraryAssetIds: ["library-drive:hero"] })).rejects.toThrow(/unchanged/);
    const cleared = await f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 2, libraryAssetIds: [] });
    expect(cleared.assets[0]!.versions.at(-1)).toMatchObject({ version: 3, action: "asset-selection", libraryAssetRefs: [] });
  });

  it("preserves an already-versioned historical reference after the library is re-indexed", async () => {
    const f = selectionFixture();
    await f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 1, libraryAssetIds: ["library-drive:hero"] });
    f.libraries.assets = f.libraries.assets.filter((item) => item.id !== "library-drive:hero");
    const detail = await f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 2, libraryAssetIds: ["library-drive:hero", "library-manual:brief"] });
    expect(detail.assets[0]!.versions.at(-1)!.libraryAssetRefs?.map((item) => item.libraryAssetId)).toEqual(["library-drive:hero", "library-manual:brief"]);
    expect(detail.assets[0]!.versions.at(-1)!.libraryAssetRefs?.[0]?.providerRef).toBe("https://drive.google.com/file/d/hero/view");
  });

  it("inherits selected production assets across normal manual edits", async () => {
    const f = selectionFixture();
    await f.service.select("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 1, libraryAssetIds: ["library-drive:hero"] });
    const campaigns = new CampaignService(f.campaigns, {} as any, undefined, () => new Date("2026-08-18T21:02:00.000Z"));
    const edited = await campaigns.appendManualEdit("account-1", "brand-1", "campaign-1", "content-1", { expectedVersion: 2, content: "Revised launch copy" });
    expect(edited.assets[0]!.versions.at(-1)!.libraryAssetRefs?.map((item) => item.libraryAssetId)).toEqual(["library-drive:hero"]);
  });
});
