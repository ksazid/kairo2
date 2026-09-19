import { randomUUID } from "node:crypto";
import { DomainValidationError, ResourceNotFoundError } from "@kairo/domain";
import type { ContentChannel, ContentLibraryAssetReference } from "@kairo/domain/campaign";
import { ResearchService, type ResearchRepository } from "@kairo/domain/research-service";
import { CampaignService, type CampaignRepository, type ContentGenerationPort } from "@kairo/domain/campaign-service";
import type { ContentReview } from "@kairo/domain/review";
import type { PutBrandPresenterRequest, SimpleCreationPresenterDto } from "@kairo/contracts/presenter";
import type { IdeaDevelopmentPort } from "./app";
import type { AvatarProvider } from "./avatar-provider";
import { BrandPresenterService, type BrandPresenterStore } from "./brand-presenter";
import { normalizeHomeMediaIds, type HomeMediaRepository } from "./home-media";

export type SimpleCreationStatus =
  | "queued"
  | "understanding-goal"
  | "researching"
  | "choosing-angle"
  | "building-campaign"
  | "ready"
  | "needs-attention";
export type ContentPreference = "auto" | "carousel" | "reel" | "image" | "video" | "campaign";
export type SimpleCreationCriticStatus = "passed" | "revision-required" | "unavailable";

export interface SimpleCreationCriticSummary {
  status: SimpleCreationCriticStatus;
  reviewId?: string;
  versionId?: string;
  score?: number;
  findings?: Array<{ code: string; severity: "advisory" | "revision"; message: string }>;
}

export interface SimpleCreationReviewPort {
  review(
    accountId: string,
    brandId: string,
    campaignId: string,
    assetId: string,
    input: { expectedVersion: number; brandContextVersion: string; revisionCycle: number },
  ): Promise<ContentReview>;
}

export interface SimpleCreationRequest {
  id: string;
  accountId: string;
  workspaceId: string;
  brandId: string;
  goal: string;
  input?: string;
  source?: string;
  contentPreference: ContentPreference;
  presenterId?: string;
  mediaAssetIds?: string[];
  status: SimpleCreationStatus;
  ideaId?: string;
  recommendedAngleId?: string;
  campaignId?: string;
  assetId?: string;
  recommendation?: Record<string, unknown>;
  failureReason?: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

export interface SimpleCreationStore extends BrandPresenterStore {
  homeMedia?: Pick<HomeMediaRepository, "requireAssets">;
  create(value: SimpleCreationRequest): Promise<SimpleCreationRequest>;
  get(accountId: string, brandId: string, id: string): Promise<SimpleCreationRequest | null>;
  claim(workerId: string, leaseSeconds: number): Promise<SimpleCreationRequest | null>;
  advance(id: string, workerId: string, status: SimpleCreationStatus, patch?: Partial<SimpleCreationRequest>): Promise<void>;
}

export interface StartSimpleCreationInput {
  goal: string;
  input?: string;
  source?: string;
  contentPreference?: ContentPreference;
  presenterId?: string;
  mediaAssetIds?: string[];
  /** Existing Brand-scoped Idea to continue. Used by For You to preserve Opportunity lineage. */
  ideaId?: string;
}

export class SimpleCreationService {
  private research: ResearchService;
  private campaigns: CampaignService;
  private presenters: BrandPresenterService;

  constructor(
    private store: SimpleCreationStore,
    researchRepo: ResearchRepository,
    campaignRepo: CampaignRepository,
    private developer: IdeaDevelopmentPort,
    private now = () => new Date(),
    avatarProvider?: AvatarProvider,
    contentGenerator?: ContentGenerationPort,
    brandBrain?: (accountId: string, brandId: string) => Promise<Array<{ fieldKey: string; value: string; state: string }>>,
    private reviewer?: SimpleCreationReviewPort,
  ) {
    this.research = new ResearchService(researchRepo, now);
    this.campaigns = new CampaignService(campaignRepo, researchRepo, contentGenerator, now, brandBrain);
    this.presenters = avatarProvider ? new BrandPresenterService(store, now, avatarProvider) : new BrandPresenterService(store, now);
  }

  async start(accountId: string, workspaceId: string, brandId: string, raw: StartSimpleCreationInput) {
    const goal = text(raw?.goal, "goal", 500);
    const input = optional(raw?.input, 4000);
    const source = optional(raw?.source, 2000);
    const preference = raw?.contentPreference ?? "auto";
    const presenterId = optional(raw?.presenterId, 200);
    const ideaId = optional(raw?.ideaId, 200);
    const mediaAssetIds = normalizeHomeMediaIds(raw?.mediaAssetIds);
    if (!( ["auto", "carousel", "reel", "image", "video", "campaign"] as string[]).includes(preference)) {
      throw new DomainValidationError("contentPreference must be auto, carousel, reel, image, video, or campaign");
    }
    if (presenterId && !["auto", "reel", "video"].includes(preference)) {
      throw new DomainValidationError("Presenter is available only for Reel or Video creation");
    }
    if (presenterId) await this.presenters.requireEligible(workspaceId, brandId, presenterId);
    if (mediaAssetIds.length) {
      if (!this.store.homeMedia) throw new DomainValidationError("Brand media is not configured");
      await this.store.homeMedia.requireAssets(accountId, brandId, mediaAssetIds);
    }
    if (ideaId) {
      const bundle = await this.research.getIdea(accountId, brandId, ideaId);
      if (!bundle || bundle.idea.workspaceId !== workspaceId || bundle.idea.brandId !== brandId) {
        throw new ResourceNotFoundError("Idea not found");
      }
    }
    const at = this.now().toISOString();
    return this.store.create({
      id: randomUUID(), accountId, workspaceId, brandId, goal,
      ...(input ? { input } : {}), ...(source ? { source } : {}),
      contentPreference: preference, ...(presenterId ? { presenterId } : {}),
      ...(mediaAssetIds.length ? { mediaAssetIds } : {}), ...(ideaId ? { ideaId } : {}),
      status: "queued", attempt: 0, createdAt: at, updatedAt: at,
    });
  }

  async get(accountId: string, brandId: string, id: string) {
    const value = await this.store.get(accountId, brandId, id);
    if (!value) throw new ResourceNotFoundError("Creation request not found");
    const presenter = value.presenterId ? await this.store.getPresenter(value.workspaceId, value.brandId) : null;
    return publicView(value, presenter && presenter.id === value.presenterId ? { id: presenter.id, displayName: presenter.displayName, mode: presenter.mode } : undefined);
  }

  getPresenter(workspaceId: string, brandId: string) { return this.presenters.get(workspaceId, brandId); }
  savePresenter(workspaceId: string, brandId: string, input: PutBrandPresenterRequest) { return this.presenters.save(workspaceId, brandId, input); }

  async runOnce(workerId: string) {
    const job = await this.store.claim(workerId, 900);
    if (!job) return false;
    try {
      await this.store.advance(job.id, workerId, "understanding-goal");
      const brandContextVersion = `${job.brandId}@current`;
      let ideaId = job.ideaId;
      if (!ideaId) {
        const premise = [job.goal, job.input && `Input: ${job.input}`, job.source && `Source: ${job.source}`].filter(Boolean).join("\n\n");
        const idea = await this.research.createUserIdea(job.accountId, job.workspaceId, job.brandId, { title: creationTitle(job, 120), premise });
        ideaId = idea.id;
        await this.store.advance(job.id, workerId, "researching", { ideaId });
      }
      let bundle = await this.research.getIdea(job.accountId, job.brandId, ideaId);
      if (!bundle) throw new Error("Created Idea was not found");
      if (!bundle.research || bundle.angles.length < 2) {
        await this.store.advance(job.id, workerId, "researching", { ideaId });
        await this.developer.develop({ accountId: job.accountId, workspaceId: job.workspaceId, brandId: job.brandId, brandContextVersion, idea: bundle.idea });
        bundle = await this.research.getIdea(job.accountId, job.brandId, ideaId);
      }
      if (!bundle?.research || !bundle.angles.length) throw new Error("Research did not produce a recommendation");
      await this.store.advance(job.id, workerId, "choosing-angle", { ideaId });
      const preferred = bundle.angles.find((angle) => !["auto", "campaign"].includes(job.contentPreference) && formatMatches(angle.recommendedFormat, job.contentPreference)) ?? bundle.angles[0]!;
      if (preferred.status !== "selected") await this.research.selectAngle(job.accountId, job.brandId, ideaId, preferred.id, preferred.version);
      await this.store.advance(job.id, workerId, "building-campaign", { ideaId, recommendedAngleId: preferred.id });
      const existingCampaign = job.campaignId ? undefined : (await this.campaigns.list(job.accountId, job.brandId)).find((item) => item.ideaId === ideaId && item.angleId === preferred.id);
      const campaign = job.campaignId ? await this.campaigns.get(job.accountId, job.brandId, job.campaignId) : existingCampaign ?? (await this.campaigns.createFromSelectedAngle(job.accountId, job.brandId, ideaId, { name: creationTitle(job, 160), objective: preferred.objective }));
      if (!campaign) throw new Error("Campaign was not found");
      const campaignId = "campaign" in campaign ? campaign.campaign.id : campaign.id;
      const format = ["auto", "campaign"].includes(job.contentPreference) ? normalizedFormat(preferred.recommendedFormat) : job.contentPreference;
      let assetId = job.assetId;
      let critic: SimpleCreationCriticSummary | undefined;
      if (job.contentPreference !== "campaign" && !assetId) {
        const media = job.mediaAssetIds?.length && this.store.homeMedia ? await this.store.homeMedia.requireAssets(job.accountId, job.brandId, job.mediaAssetIds) : [];
        const generated = await this.campaigns.createGeneratedAsset(job.accountId, job.brandId, campaignId, {
          channel: supportedChannel(preferred.recommendedChannel),
          format,
          audience: preferred.audience,
          topic: bundle.idea.title,
          hookType: preferred.hookDirection.slice(0, 120) || "opening",
          cta: "Learn more",
          seedContent: creationSeed(bundle.idea.premise),
          brandContextVersion,
          libraryAssetRefs: media.map((item): ContentLibraryAssetReference => ({
            libraryId: item.libraryId,
            libraryAssetId: item.id,
            libraryName: "Kairo Media",
            provider: "manual",
            externalId: item.id,
            name: item.name,
            kind: item.kind,
            mimeType: item.mimeType,
            indexedAt: item.indexedAt,
          })),
        });
        assetId = generated.assetId;
        const generatedAsset = generated.detail.assets.find((item) => item.asset.id === generated.assetId);
        if (!generatedAsset) throw new Error("Generated Content Asset was not found");
        critic = await this.evaluateCritic(
          job.accountId,
          job.brandId,
          campaignId,
          generated.assetId,
          generatedAsset.asset.currentVersion,
          brandContextVersion,
        );
      }
      const recommendation = {
        title: preferred.title, framing: preferred.framing, format, channel: preferred.recommendedChannel,
        reason: preferred.expectedValue, supportingClaimIds: preferred.supportingClaimIds,
        alternatives: bundle.angles.filter((angle) => angle.id !== preferred.id).slice(0, 2).map((angle) => ({ id: angle.id, title: angle.title, framing: angle.framing, format: angle.recommendedFormat, channel: angle.recommendedChannel, reason: angle.expectedValue })),
        ...(critic ? { critic } : {}),
      };
      await this.store.advance(job.id, workerId, "ready", { ideaId, recommendedAngleId: preferred.id, campaignId, ...(assetId ? { assetId } : {}), recommendation });
      return true;
    } catch (error) {
      await this.store.advance(job.id, workerId, "needs-attention", { failureReason: safeError(error) });
      return true;
    }
  }

  private async evaluateCritic(
    accountId: string,
    brandId: string,
    campaignId: string,
    assetId: string,
    expectedVersion: number,
    brandContextVersion: string,
  ): Promise<SimpleCreationCriticSummary> {
    if (!this.reviewer) return { status: "unavailable" };
    try {
      const review = await this.reviewer.review(accountId, brandId, campaignId, assetId, {
        expectedVersion,
        brandContextVersion,
        revisionCycle: 0,
      });
      return {
        status: review.status === "passed" ? "passed" : "revision-required",
        reviewId: review.id,
        versionId: review.versionId,
        ...(review.critic ? { score: review.critic.score, findings: review.critic.findings } : {}),
      };
    } catch {
      return { status: "unavailable" };
    }
  }
}

function publicView(value: SimpleCreationRequest, presenter?: SimpleCreationPresenterDto) {
  return {
    id: value.id, status: value.status, progress: { stage: value.status, message: messages[value.status] },
    contentPreference: value.contentPreference, mediaAssetIds: value.mediaAssetIds ?? [],
    ...(presenter ? { presenter } : {}), ...(value.recommendation ? { recommendation: value.recommendation } : {}),
    ...(value.campaignId ? { campaignId: value.campaignId } : {}), ...(value.assetId ? { assetId: value.assetId } : {}),
    ...(value.status === "needs-attention" ? { canRetry: true, failureReason: value.failureReason ?? "Creation could not be completed" } : {}),
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}
const messages: Record<SimpleCreationStatus, string> = {
  queued: "Getting your creation ready", "understanding-goal": "Understanding your idea", researching: "Finding useful evidence",
  "choosing-angle": "Choosing the strongest direction", "building-campaign": "Generating your content", ready: "Your content is ready",
  "needs-attention": "We could not finish this creation yet",
};
function formatMatches(value: string, preference: ContentPreference) { const normalized = normalizedFormat(value); return normalized === preference || (preference === "video" && normalized === "reel") || (preference === "reel" && normalized === "video"); }
function normalizedFormat(value: string): Exclude<ContentPreference, "auto" | "campaign"> { const normalized = value.trim().toLowerCase(); if (normalized.includes("carousel")) return "carousel"; if (normalized.includes("reel") || normalized.includes("short")) return "reel"; if (normalized.includes("video")) return "video"; return "image"; }
function supportedChannel(value: string): ContentChannel { const normalized = value.trim().toLowerCase(); if (normalized.includes("linkedin")) return "linkedin"; if (normalized.includes("instagram")) return "instagram"; if (normalized.includes("facebook")) return "facebook"; return "manual"; }
function creationTitle(job: Pick<SimpleCreationRequest, "goal" | "input">, max: number) { return (job.input?.trim() || job.goal).slice(0, max); }
function creationSeed(premise: string) { return `Creative brief:\n${premise.trim()}`.slice(0, 50_000); }
function text(value: unknown, name: string, max: number) { const normalized = typeof value === "string" ? value.trim() : ""; if (!normalized) throw new DomainValidationError(`${name} is required`); if (normalized.length > max) throw new DomainValidationError(`${name} is too long`); return normalized; }
function optional(value: unknown, max: number) { if (value == null) return undefined; const normalized = typeof value === "string" ? value.trim() : ""; if (normalized.length > max) throw new DomainValidationError("Input is too long"); return normalized || undefined; }
function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "Creation failed"; }
