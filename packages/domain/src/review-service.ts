import { randomUUID } from "node:crypto";
import { ConcurrencyConflictError, ResourceNotFoundError } from "./index";
import type { CampaignRepository } from "./campaign-service";
import type { ResearchRepository } from "./research-service";
import { reviewableVideoProjectContent } from "./video-project";
import {
  approveContentVersion,
  completeContentReview,
  evaluateTruthGate,
  requestContentReview,
  type ApprovalDestination,
  type ContentApproval,
  type ContentReview,
  type CriticResult,
} from "./review";

export interface ReviewRepository {
  saveReview(accountId: string, review: ContentReview): Promise<ContentReview>;
  getLatestReview(accountId: string, brandId: string, assetId: string): Promise<ContentReview | null>;
  saveApproval(accountId: string, approval: ContentApproval): Promise<ContentApproval>;
  getApproval(accountId: string, brandId: string, assetId: string): Promise<ContentApproval | null>;
  getApprovalForDestination(accountId: string, brandId: string, assetId: string, destination: ApprovalDestination): Promise<ContentApproval | null>;
  listApprovals(accountId: string, brandId: string, assetId: string): Promise<ContentApproval[]>;
}

export interface CriticEvaluationPort {
  evaluate(input: {
    workspaceId: string;
    brandId: string;
    versionId: string;
    content: string;
    supportingClaims: Array<{ id: string; text: string }>;
    brandContextVersion: string;
  }): Promise<CriticResult>;
}

export class ReviewService {
  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly research: ResearchRepository,
    private readonly reviews: ReviewRepository,
    private readonly critic: CriticEvaluationPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async review(
    accountId: string,
    brandId: string,
    campaignId: string,
    assetId: string,
    input: { expectedVersion: number; brandContextVersion: string; revisionCycle: number },
  ): Promise<ContentReview> {
    const detail = await this.campaigns.getCampaign(accountId, brandId, campaignId);
    if (!detail) throw new ResourceNotFoundError("Campaign not found");
    const entry = detail.assets.find((x) => x.asset.id === assetId);
    if (!entry) throw new ResourceNotFoundError("Content Asset not found");
    if (entry.asset.currentVersion !== input.expectedVersion) throw new ConcurrencyConflictError("Content Version is stale");
    const version = entry.versions.at(-1);
    if (!version) throw new ResourceNotFoundError("Content Version not found");

    const bundle = await this.research.getIdeaBundle(accountId, brandId, detail.campaign.ideaId);
    if (!bundle?.research) throw new ResourceNotFoundError("Campaign Research not found");
    const claims = new Map(bundle.research.claims.map((claim) => [claim.id, claim]));
    const claimUses = version.supportingClaimIds.map((id) => {
      const claim = claims.get(id);
      return {
        claimId: id,
        factual: claim?.classification === "fact",
        supported: claim?.verificationState === "supported",
        fresh: claim?.freshness === "fresh",
        firstPerson: claim?.firstPersonAuthorization !== "not-applicable",
        brandAuthorized: claim?.firstPersonAuthorization === "authorized",
        attributionRequired: false,
        attributionPresent: false,
      };
    });
    const scope = {
      workspaceId: detail.campaign.workspaceId,
      brandId,
      campaignId,
      assetId,
      versionId: version.id,
      version: version.version,
    };
    const truth = evaluateTruthGate({ ...scope, claimUses, prohibitedBrandLanguage: [] });
    const requestedAt = this.now().toISOString();
    if (!truth.passed) {
      return this.reviews.saveReview(accountId, {
        id: randomUUID(),
        ...scope,
        status: "revision-required",
        truth,
        revisionCycle: input.revisionCycle,
        requestedAt,
        completedAt: this.now().toISOString(),
      });
    }
    const pending = requestContentReview({ id: randomUUID(), ...scope, truth, requestedAt });
    const critic = await this.critic.evaluate({
      workspaceId: scope.workspaceId,
      brandId,
      versionId: version.id,
      content: reviewableVideoProjectContent(version.content, {
        workspaceId: scope.workspaceId,
        brandId,
        campaignId,
        assetId,
      }),
      supportingClaims: version.supportingClaimIds.map((id) => ({ id, text: claims.get(id)?.text ?? "" })),
      brandContextVersion: input.brandContextVersion,
    });
    return this.reviews.saveReview(
      accountId,
      completeContentReview({ review: pending, critic, revisionCycle: input.revisionCycle, completedAt: this.now().toISOString() }),
    );
  }

  async approve(
    accountId: string,
    brandId: string,
    campaignId: string,
    assetId: string,
    input: { expectedVersion: number; destination: ApprovalDestination },
  ): Promise<ContentApproval> {
    const detail = await this.campaigns.getCampaign(accountId, brandId, campaignId);
    if (!detail) throw new ResourceNotFoundError("Campaign not found");
    const entry = detail.assets.find((x) => x.asset.id === assetId);
    if (!entry) throw new ResourceNotFoundError("Content Asset not found");
    if (entry.asset.currentVersion !== input.expectedVersion) throw new ConcurrencyConflictError("Content Version is stale");
    const currentVersionId = entry.versions.at(-1)?.id ?? "";
    const existing = await this.reviews.getApprovalForDestination(accountId, brandId, assetId, input.destination);
    if (existing && existing.versionId === currentVersionId) return existing;
    const review = await this.reviews.getLatestReview(accountId, brandId, assetId);
    if (!review) throw new ResourceNotFoundError("Passed Content Review not found");
    return this.reviews.saveApproval(
      accountId,
      approveContentVersion({
        id: randomUUID(),
        review,
        currentVersionId,
        approverAccountId: accountId,
        destination: input.destination,
        approvedAt: this.now().toISOString(),
      }),
    );
  }

  async status(accountId: string, brandId: string, assetId: string) {
    const [review, allApprovals] = await Promise.all([
      this.reviews.getLatestReview(accountId, brandId, assetId),
      this.reviews.listApprovals(accountId, brandId, assetId),
    ]);
    const approvals = review ? allApprovals.filter((item) => item.versionId === review.versionId) : [];
    return { review, approval: approvals[0] ?? null, approvals };
  }
}
