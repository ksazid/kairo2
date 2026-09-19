import { randomUUID } from "node:crypto";
import { ConcurrencyConflictError, DomainValidationError, ResourceNotFoundError } from "./index";
import type { ResearchRepository } from "./research-service";
import { appendContentVersion, createCampaign, createContentAsset, createInitialContentVersion, normalizeLibraryAssetRefs, type Campaign, type ContentAsset, type ContentChannel, type ContentLibraryAssetReference, type ContentVersion } from "./campaign";
import type { ContentAssetLibraryRepository } from "./content-asset-library";
import { assertVideoProjectScope, parseVideoProject, type VideoProject } from "./video-project";

export interface CampaignDetail { campaign: Campaign; assets: Array<{ asset: ContentAsset; versions: ContentVersion[] }> }
export interface CampaignRepository {
  saveCampaign(accountId: string, campaign: Campaign): Promise<Campaign>;
  listCampaigns(accountId: string, brandId: string): Promise<Campaign[]>;
  getCampaign(accountId: string, brandId: string, campaignId: string): Promise<CampaignDetail | null>;
  saveAssetWithVersion(accountId: string, asset: ContentAsset, version: ContentVersion): Promise<CampaignDetail>;
  appendVersion(accountId: string, brandId: string, campaignId: string, assetId: string, expectedVersion: number, build: (asset: ContentAsset, parent: ContentVersion) => ContentVersion): Promise<CampaignDetail>;
}
export type GenerateContentAction = "initial-draft"|"alternative"|"simplify"|"expand"|"adjust-depth"|"strengthen-opening"|"regenerate-section";
export interface ContentGenerationPort { generate(input:{workspaceId:string;brandId:string;brandContextVersion:string;campaign:Campaign;asset:ContentAsset;parent:ContentVersion;action:GenerateContentAction;section?:string;claims:Array<{id:string;text:string;classification:string;verificationState:string}>;brandBrain?:Array<{fieldKey:string;value:string;state:string}>}):Promise<ContentVersion> }

export function validateBrandDnaForGeneration(fields: readonly { fieldKey: string; value: string; state: string }[], format?: string): void {
  const active = new Map(fields.filter((field) => field.state !== "stale" && field.value.trim()).map((field) => [field.fieldKey, field.value.trim()]));
  const required = ["audience.primary", "voice.tone", "content.pillars", "content.preferred-topics"];
  if (["carousel", "reel", "video"].includes((format ?? "").toLowerCase())) required.push("content.visual-direction");
  const missing = required.filter((key) => !active.has(key));
  if (missing.length) throw new DomainValidationError("Brand DNA is incomplete. Complete Brand Brain before generating content: " + missing.join(", "));
}

export class CampaignService {
  constructor(private readonly campaigns: CampaignRepository, private readonly research: ResearchRepository, private readonly generator?:ContentGenerationPort, private readonly now: () => Date = () => new Date(), private readonly brandBrain?: (accountId:string, brandId:string) => Promise<Array<{fieldKey:string;value:string;state:string}>>) {}
  async createFromSelectedAngle(accountId: string, brandId: string, ideaId: string, input: { name: string; objective: string }): Promise<Campaign> {
    const bundle = await this.research.getIdeaBundle(accountId, brandId, ideaId);
    if (!bundle?.research) throw new ResourceNotFoundError("Research-ready Idea not found");
    const angle = bundle.angles.find((item) => item.status === "selected");
    if (!angle) throw new DomainValidationError("Campaign requires a selected Angle");
    return this.campaigns.saveCampaign(accountId, createCampaign({ id: randomUUID(), name: input.name, objective: input.objective, createdAt: this.now().toISOString(), lineage: { workspaceId: bundle.idea.workspaceId, brandId, ideaId, researchId: bundle.research.id, angleId: angle.id, angleStatus: angle.status, supportingClaimIds: angle.supportingClaimIds } }));
  }
  list(accountId: string, brandId: string): Promise<Campaign[]> { return this.campaigns.listCampaigns(accountId, brandId); }
  get(accountId: string, brandId: string, campaignId: string): Promise<CampaignDetail | null> { return this.campaigns.getCampaign(accountId, brandId, campaignId); }
  async createAsset(accountId: string, brandId: string, campaignId: string, input: { channel: ContentChannel; format: string; audience: string; topic: string; hookType: string; cta: string; content: string; libraryAssetRefs?: ContentLibraryAssetReference[] }): Promise<CampaignDetail> {
    const detail = await this.campaigns.getCampaign(accountId, brandId, campaignId);
    if (!detail) throw new ResourceNotFoundError("Campaign not found");
    if (videoProjectOrNull(input.content)) throw new DomainValidationError("Create the Reel Content Asset first, then initialize its Video Project in Video Studio");
    const asset = createContentAsset({ id: randomUUID(), campaign: detail.campaign, channel: input.channel, format: input.format, audience: input.audience, topic: input.topic, hookType: input.hookType, cta: input.cta, createdAt: this.now().toISOString() });
    const version = createInitialContentVersion({ id: randomUUID(), asset, content: input.content, supportingClaimIds: detail.campaign.supportingClaimIds, actor: "user", action: "manual-edit", createdAt: this.now().toISOString(), libraryAssetRefs: normalizeLibraryAssetRefs(input.libraryAssetRefs ?? []) });
    return this.campaigns.saveAssetWithVersion(accountId, { ...asset, currentVersion: 1 }, version);
  }
  async createGeneratedAsset(accountId: string, brandId: string, campaignId: string, input: { channel: ContentChannel; format: string; audience: string; topic: string; hookType: string; cta: string; seedContent: string; brandContextVersion: string; libraryAssetRefs?: ContentLibraryAssetReference[] }): Promise<{ detail: CampaignDetail; assetId: string }> {
    if (!this.generator) throw new DomainValidationError("Content generation is not configured");
    const detail = await this.campaigns.getCampaign(accountId, brandId, campaignId);
    if (!detail) throw new ResourceNotFoundError("Campaign not found");
    if (videoProjectOrNull(input.seedContent)) throw new DomainValidationError("Generated content seed must be plain content");
    const asset = createContentAsset({
      id: randomUUID(),
      campaign: detail.campaign,
      channel: input.channel,
      format: input.format,
      audience: input.audience,
      topic: input.topic,
      hookType: input.hookType,
      cta: input.cta,
      createdAt: this.now().toISOString(),
    });
    const version = createInitialContentVersion({
      id: randomUUID(),
      asset,
      content: input.seedContent,
      supportingClaimIds: detail.campaign.supportingClaimIds,
      actor: "user",
      action: "manual-edit",
      createdAt: this.now().toISOString(),
      libraryAssetRefs: normalizeLibraryAssetRefs(input.libraryAssetRefs ?? []),
    });
    await this.campaigns.saveAssetWithVersion(accountId, { ...asset, currentVersion: 1 }, version);
    const generated = await this.generateVersion(accountId, brandId, campaignId, asset.id, {
      expectedVersion: 1,
      action: "initial-draft",
      brandContextVersion: input.brandContextVersion,
    });
    return { detail: generated, assetId: asset.id };
  }
  appendManualEdit(accountId: string, brandId: string, campaignId: string, assetId: string, input: { expectedVersion: number; content: string }): Promise<CampaignDetail> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new DomainValidationError("expectedVersion must be a positive integer");
    return this.campaigns.appendVersion(accountId, brandId, campaignId, assetId, input.expectedVersion, (asset, parent) => {
      const parentProject = videoProjectOrNull(parent.content);
      const nextProject = videoProjectOrNull(input.content);
      if (parentProject) {
        assertProjectForAsset(parentProject, asset);
        if (!nextProject) throw new DomainValidationError("Structured Reel Video Projects must be edited through Video Studio");
      }
      if (nextProject) assertProjectForAsset(nextProject, asset);
      return appendContentVersion({ id: randomUUID(), asset, parent, expectedVersion: input.expectedVersion, content: input.content, supportingClaimIds: parent.supportingClaimIds, actor: "user", action: "manual-edit", createdAt: this.now().toISOString() });
    });
  }
  async generateVersion(accountId:string,brandId:string,campaignId:string,assetId:string,input:{expectedVersion:number;action:GenerateContentAction;section?:string;brandContextVersion:string}):Promise<CampaignDetail>{
    if(!this.generator)throw new DomainValidationError("Content generation is not configured");
    if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<1)throw new DomainValidationError("expectedVersion must be a positive integer");
    const detail=await this.campaigns.getCampaign(accountId,brandId,campaignId);if(!detail)throw new ResourceNotFoundError("Campaign not found");
    const bundle=await this.research.getIdeaBundle(accountId,brandId,detail.campaign.ideaId);if(!bundle?.research)throw new ResourceNotFoundError("Campaign Research not found");const research=bundle.research;
    const entry=detail.assets.find(item=>item.asset.id===assetId);if(!entry)throw new ResourceNotFoundError("Content Asset not found");if(entry.asset.currentVersion!==input.expectedVersion)throw new ConcurrencyConflictError("Content Version is stale");const parent=entry.versions.at(-1);if(!parent)throw new ResourceNotFoundError("Content Version not found");
    const parentProject=videoProjectOrNull(parent.content);if(parentProject){assertProjectForAsset(parentProject,entry.asset);throw new DomainValidationError("Structured Reel Video Projects must be edited through Video Studio; generic AI transformations are not timeline-aware")}
    const brandBrain = this.brandBrain ? await this.brandBrain(accountId, brandId) : undefined;
    if (brandBrain?.length) validateBrandDnaForGeneration(brandBrain, entry.asset.format);
    const generated=await this.generator.generate({workspaceId:detail.campaign.workspaceId,brandId,brandContextVersion:input.brandContextVersion,campaign:detail.campaign,asset:entry.asset,parent,action:input.action,...(input.section?{section:input.section}:{}),claims:research.claims.map(c=>({id:c.id,text:c.text,classification:c.classification,verificationState:c.verificationState})),...(brandBrain ? {brandBrain} : {})});
    const inherited={...generated,libraryAssetRefs:normalizeLibraryAssetRefs(parent.libraryAssetRefs??[])};
    return this.campaigns.appendVersion(accountId,brandId,campaignId,assetId,input.expectedVersion,()=>inherited);
  }
}

export class ContentAssetSelectionService {
  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly libraries: ContentAssetLibraryRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  async select(accountId: string, brandId: string, campaignId: string, assetId: string, input: { expectedVersion: number; libraryAssetIds: string[] }): Promise<CampaignDetail> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new DomainValidationError("expectedVersion must be a positive integer");
    const ids = selectionIds(input.libraryAssetIds);
    const detail = await this.campaigns.getCampaign(accountId, brandId, campaignId);
    if (!detail) throw new ResourceNotFoundError("Campaign not found");
    const entry = detail.assets.find((item) => item.asset.id === assetId);
    if (!entry) throw new ResourceNotFoundError("Content Asset not found");
    if (entry.asset.currentVersion !== input.expectedVersion) throw new ConcurrencyConflictError("Content Version is stale");
    const current = entry.versions.at(-1);
    if (!current || current.version !== input.expectedVersion) throw new ResourceNotFoundError("Content Version not found");

    const references = await this.resolveReferences(accountId, brandId, detail.campaign.workspaceId, ids, current.libraryAssetRefs ?? []);
    if (JSON.stringify(current.libraryAssetRefs ?? []) === JSON.stringify(references)) throw new DomainValidationError("Selected production assets are unchanged");

    return this.campaigns.appendVersion(accountId, brandId, campaignId, assetId, input.expectedVersion, (asset, parent) => appendContentVersion({
      id: this.id(),
      asset,
      parent,
      expectedVersion: input.expectedVersion,
      content: parent.content,
      supportingClaimIds: parent.supportingClaimIds,
      actor: "user",
      action: "asset-selection",
      createdAt: this.now().toISOString(),
      libraryAssetRefs: references,
    }));
  }

  private async resolveReferences(accountId: string, brandId: string, workspaceId: string, ids: string[], currentRefs: ContentLibraryAssetReference[]): Promise<ContentLibraryAssetReference[]> {
    if (!ids.length) return [];
    const trustedCurrent = new Map(currentRefs.map((reference) => [reference.libraryAssetId, reference]));
    const newIds = ids.filter((id) => !trustedCurrent.has(id));
    if (!newIds.length) return normalizeLibraryAssetRefs(ids.map((id) => trustedCurrent.get(id)!));

    const [assets, libraries] = await Promise.all([
      this.libraries.getAssetsByIds ? this.libraries.getAssetsByIds(accountId, brandId, newIds) : this.libraries.listAssets(accountId, brandId),
      this.libraries.listLibraries(accountId, brandId),
    ]);
    const assetMap = new Map(assets.filter((item) => newIds.includes(item.id)).map((item) => [item.id, item]));
    const libraryMap = new Map(libraries.map((item) => [item.id, item]));
    const resolved = new Map<string, ContentLibraryAssetReference>();
    for (const id of newIds) {
      const item = assetMap.get(id);
      if (!item || item.brandId !== brandId || item.workspaceId !== workspaceId) throw new ResourceNotFoundError("Content Asset Library item not found");
      const library = libraryMap.get(item.libraryId);
      if (!library || library.brandId !== brandId || library.workspaceId !== workspaceId) throw new ResourceNotFoundError("Content Asset Library item not found");
      resolved.set(id, {
        libraryId: library.id,
        libraryAssetId: item.id,
        libraryName: library.name,
        provider: library.provider,
        externalId: item.externalId,
        name: item.name,
        kind: item.kind,
        mimeType: item.mimeType,
        ...(item.providerRef ? { providerRef: item.providerRef } : {}),
        ...(item.previewRef ? { previewRef: item.previewRef } : {}),
        indexedAt: item.indexedAt,
      });
    }
    return normalizeLibraryAssetRefs(ids.map((id) => trustedCurrent.get(id) ?? resolved.get(id)!));
  }
}

function selectionIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new DomainValidationError("libraryAssetIds must be a list");
  if (value.length > 12) throw new DomainValidationError("Select at most 12 production assets");
  const ids = value.map((item) => {
    if (typeof item !== "string" || !item.trim()) throw new DomainValidationError("libraryAssetIds contains an invalid asset id");
    const normalized = item.trim();
    if (normalized.length > 600) throw new DomainValidationError("libraryAssetIds contains an asset id that is too long");
    return normalized;
  });
  if (new Set(ids).size !== ids.length) throw new DomainValidationError("libraryAssetIds must not contain duplicates");
  return ids;
}
function videoProjectOrNull(content:string):VideoProject|null{try{return parseVideoProject(content)}catch{return null}}
function assertProjectForAsset(project:VideoProject,asset:ContentAsset):VideoProject{if(asset.format.trim().toLowerCase()!=="reel")throw new DomainValidationError("Video Project content requires a Reel Content Asset");return assertVideoProjectScope(project,{workspaceId:asset.workspaceId,brandId:asset.brandId,campaignId:asset.campaignId,assetId:asset.id})}
