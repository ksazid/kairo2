import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { ContentAsset, ContentVersion } from "@kairo/domain/campaign";
import type { CampaignDetail, CampaignRepository } from "@kairo/domain/campaign-service";
import type { ContentAssetLibrary, ContentAssetLibraryRepository, ContentAssetProviderStateInput, ContentLibraryAsset } from "@kairo/domain/content-asset-library";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { registerContentAssetSelectionRoutes } from "./content-asset-selection-routes";
import { MemoryKairoRepository } from "./store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null;
  }
}

class Campaigns implements CampaignRepository {
  detail: CampaignDetail | null = null;
  async saveCampaign(_accountId: string, campaign: any) { return campaign; }
  async listCampaigns() { return this.detail ? [this.detail.campaign] : []; }
  async getCampaign(_accountId: string, brandId: string, campaignId: string) { return this.detail?.campaign.brandId === brandId && this.detail.campaign.id === campaignId ? this.detail : null; }
  async saveAssetWithVersion() { if (!this.detail) throw new Error("missing detail"); return this.detail; }
  async appendVersion(_accountId: string, brandId: string, campaignId: string, assetId: string, expectedVersion: number, build: (asset: ContentAsset, parent: ContentVersion) => ContentVersion) {
    const detail = await this.getCampaign("", brandId, campaignId);
    const entry = detail?.assets.find((item) => item.asset.id === assetId);
    if (!detail || !entry) throw Object.assign(new Error("Content Asset not found"), { code: "resource_not_found" });
    if (entry.asset.currentVersion !== expectedVersion) throw Object.assign(new Error("Content Version is stale"), { code: "concurrency_conflict" });
    const next = build(entry.asset, entry.versions.at(-1)!);
    entry.versions.push(next);
    entry.asset = { ...entry.asset, currentVersion: next.version };
    return detail;
  }
}

class Libraries implements ContentAssetLibraryRepository {
  libraries: ContentAssetLibrary[] = [];
  assets: ContentLibraryAsset[] = [];
  async saveLibrary(_accountId: string, library: ContentAssetLibrary) { return library; }
  async listLibraries(_accountId: string, brandId: string) { return this.libraries.filter((item) => item.brandId === brandId); }
  async getLibrary(_accountId: string, brandId: string, libraryId: string) { return this.libraries.find((item) => item.brandId === brandId && item.id === libraryId) ?? null; }
  async listAssets(_accountId: string, brandId: string) { return this.assets.filter((item) => item.brandId === brandId); }
  async getAssetsByIds(_accountId: string, brandId: string, ids: string[]) { return this.assets.filter((item) => item.brandId === brandId && ids.includes(item.id)); }
  async replaceIndexedAssets() {}
  async updateProviderState(_accountId: string, _brandId: string, _libraryId: string, _input: ContentAssetProviderStateInput): Promise<ContentAssetLibrary> { throw new Error("not used"); }
  async clearIndexedAssets() {}
}

describe("VS-61 Content Asset selection API", () => {
  it("requires auth and accepts only asset ids while server-snapshotting provenance", async () => {
    const core = new MemoryKairoRepository();
    const campaigns = new Campaigns();
    const libraries = new Libraries();
    const verifier = new Verifier();
    const app = buildApp({ store: core, identityVerifier: verifier });
    registerContentAssetSelectionRoutes(app, { coreStore: core, campaignStore: campaigns, libraryStore: libraries, identityVerifier: verifier });

    expect((await app.inject({ method: "POST", url: "/api/v1/brands/brand/campaigns/campaign/assets/asset/library-assets", payload: { expectedVersion: 1, libraryAssetIds: [] } })).statusCode).toBe(401);

    const setup = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: { authorization: "Bearer test:alice" }, payload: { workspaceName: "Studio", brandName: "Kairo" } });
    const body = setup.json();
    const brandId = body.brand.id as string;
    const workspaceId = body.workspace.id as string;
    campaigns.detail = {
      campaign: { id: "campaign-1", workspaceId, brandId, ideaId: "idea-1", researchId: "research-1", angleId: "angle-1", name: "Launch", objective: "Launch", supportingClaimIds: [], status: "draft", createdAt: "2026-08-18T20:00:00.000Z" },
      assets: [{
        asset: { id: "asset-1", workspaceId, brandId, campaignId: "campaign-1", channel: "instagram", format: "carousel", audience: "Builders", topic: "Launch", hookType: "problem", cta: "Try", supportingClaimIds: [], currentVersion: 1, status: "draft", createdAt: "2026-08-18T20:01:00.000Z" },
        versions: [{ id: "version-1", workspaceId, brandId, campaignId: "campaign-1", assetId: "asset-1", version: 1, parentVersionId: null, content: "Launch", supportingClaimIds: [], actor: "user", action: "manual-edit", createdAt: "2026-08-18T20:02:00.000Z" }],
      }],
    };
    libraries.libraries.push({ id: "library-1", workspaceId, brandId, name: "Launch assets", provider: "google-drive", status: "connected", createdAt: "2026-08-18T19:00:00.000Z", updatedAt: "2026-08-18T19:00:00.000Z" });
    libraries.assets.push({ id: "library-1:hero", workspaceId, brandId, libraryId: "library-1", externalId: "hero", name: "Hero.jpg", kind: "image", mimeType: "image/jpeg", providerRef: "https://drive.google.com/file/d/hero/view", indexedAt: "2026-08-18T19:05:00.000Z" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/campaigns/campaign-1/assets/asset-1/library-assets`,
      headers: { authorization: "Bearer test:alice" },
      payload: {
        expectedVersion: 1,
        libraryAssetIds: ["library-1:hero"],
        providerRef: "https://attacker.invalid/forged",
        accessToken: "must-not-be-stored",
      },
    });
    expect(response.statusCode).toBe(200);
    const current = response.json().assets[0].versions.at(-1);
    expect(current).toMatchObject({ version: 2, action: "asset-selection" });
    expect(current.libraryAssetRefs).toEqual([expect.objectContaining({ libraryAssetId: "library-1:hero", providerRef: "https://drive.google.com/file/d/hero/view" })]);
    expect(JSON.stringify(current)).not.toContain("attacker.invalid");
    expect(JSON.stringify(current)).not.toContain("must-not-be-stored");

    await app.close();
  });
});
