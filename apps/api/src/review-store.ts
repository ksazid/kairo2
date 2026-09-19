import { ResourceNotFoundError, type KairoRepository } from "@kairo/domain";
import type { ApprovalDestination, ContentApproval, ContentReview } from "@kairo/domain/review";
import type { ReviewRepository } from "@kairo/domain/review-service";

export class MemoryReviewRepository implements ReviewRepository {
  private reviews = new Map<string, ContentReview>();
  private approvals = new Map<string, ContentApproval>();

  constructor(private core: KairoRepository) {}

  async saveReview(accountId: string, review: ContentReview) {
    await this.scope(accountId, review.brandId);
    this.reviews.set(review.assetId, structuredClone(review));
    return structuredClone(review);
  }

  async getLatestReview(accountId: string, brandId: string, assetId: string) {
    await this.scope(accountId, brandId);
    const review = this.reviews.get(assetId);
    return review && review.brandId === brandId ? structuredClone(review) : null;
  }

  async saveApproval(accountId: string, approval: ContentApproval) {
    await this.scope(accountId, approval.brandId);
    const existing = await this.getApprovalForDestination(accountId, approval.brandId, approval.assetId, approval.destination);
    if (existing && existing.versionId === approval.versionId) return existing;
    this.approvals.set(approval.id, structuredClone(approval));
    return structuredClone(approval);
  }

  async getApproval(accountId: string, brandId: string, assetId: string) {
    const approvals = await this.listApprovals(accountId, brandId, assetId);
    return approvals[0] ?? null;
  }

  async getApprovalForDestination(accountId: string, brandId: string, assetId: string, destination: ApprovalDestination) {
    const approvals = await this.listApprovals(accountId, brandId, assetId);
    return approvals.find((approval) => approval.destination.channel === destination.channel && approval.destination.accountRef === destination.accountRef) ?? null;
  }

  async listApprovals(accountId: string, brandId: string, assetId: string) {
    await this.scope(accountId, brandId);
    return [...this.approvals.values()]
      .filter((approval) => approval.brandId === brandId && approval.assetId === assetId)
      .sort((a, b) => b.version - a.version || b.approvedAt.localeCompare(a.approvedAt) || a.id.localeCompare(b.id))
      .map((approval) => structuredClone(approval));
  }

  private async scope(accountId: string, brandId: string) {
    const brand = await this.core.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    return brand;
  }
}
