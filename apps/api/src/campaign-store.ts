import { ConcurrencyConflictError, ResourceNotFoundError, type KairoRepository } from "@kairo/domain";
import type { Campaign, ContentAsset, ContentVersion } from "@kairo/domain/campaign";
import type { CampaignDetail, CampaignRepository } from "@kairo/domain/campaign-service";

export class MemoryCampaignRepository implements CampaignRepository {
  private readonly campaigns = new Map<string, Campaign>();
  private readonly assets = new Map<string, ContentAsset>();
  private readonly versions = new Map<string, ContentVersion[]>();
  constructor(private readonly core: KairoRepository) {}
  async saveCampaign(accountId: string, campaign: Campaign): Promise<Campaign> { const brand = await this.requireBrand(accountId, campaign.brandId); if (brand.workspaceId !== campaign.workspaceId) throw new ResourceNotFoundError("Brand not found"); this.campaigns.set(campaign.id, structuredClone(campaign)); return structuredClone(campaign); }
  async listCampaigns(accountId: string, brandId: string): Promise<Campaign[]> { await this.requireBrand(accountId, brandId); return [...this.campaigns.values()].filter((item) => item.brandId === brandId).map((item) => structuredClone(item)); }
  async getCampaign(accountId: string, brandId: string, campaignId: string): Promise<CampaignDetail | null> { await this.requireBrand(accountId, brandId); const campaign = this.campaigns.get(campaignId); if (!campaign || campaign.brandId !== brandId) return null; return this.detail(campaign); }
  async saveAssetWithVersion(accountId: string, asset: ContentAsset, version: ContentVersion): Promise<CampaignDetail> { const campaign = await this.ownedCampaign(accountId, asset.brandId, asset.campaignId); this.assets.set(asset.id, structuredClone(asset)); this.versions.set(asset.id, [structuredClone(version)]); return this.detail(campaign); }
  async appendVersion(accountId: string, brandId: string, campaignId: string, assetId: string, expectedVersion: number, build: (asset: ContentAsset, parent: ContentVersion) => ContentVersion): Promise<CampaignDetail> { const campaign = await this.ownedCampaign(accountId, brandId, campaignId); const asset = this.assets.get(assetId); const history = this.versions.get(assetId); if (!asset || asset.campaignId !== campaignId || !history?.length) throw new ResourceNotFoundError("Content Asset not found"); if (asset.currentVersion !== expectedVersion) throw new ConcurrencyConflictError("Content Version is stale"); const next = build(structuredClone(asset), structuredClone(history.at(-1)!)); history.push(structuredClone(next)); this.assets.set(assetId, { ...asset, currentVersion: next.version }); return this.detail(campaign); }
  private detail(campaign: Campaign): CampaignDetail { return { campaign: structuredClone(campaign), assets: [...this.assets.values()].filter((item) => item.campaignId === campaign.id).map((asset) => ({ asset: structuredClone(asset), versions: structuredClone(this.versions.get(asset.id) ?? []) })) }; }
  private async ownedCampaign(accountId: string, brandId: string, campaignId: string): Promise<Campaign> { await this.requireBrand(accountId, brandId); const campaign = this.campaigns.get(campaignId); if (!campaign || campaign.brandId !== brandId) throw new ResourceNotFoundError("Campaign not found"); return campaign; }
  private async requireBrand(accountId: string, brandId: string) { const brand = await this.core.getBrandForAccount(accountId, brandId); if (!brand) throw new ResourceNotFoundError("Brand not found"); return brand; }
}
