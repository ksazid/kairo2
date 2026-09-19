import type { Pool } from "pg";
import { ResourceNotFoundError } from "@kairo/domain";
import type { ApprovalDestination, ContentApproval, ContentReview } from "@kairo/domain/review";
import type { ReviewRepository } from "@kairo/domain/review-service";

export class PgReviewRepository implements ReviewRepository {
  constructor(private pool: Pool) {}

  async saveReview(accountId: string, review: ContentReview) {
    await this.scope(accountId, review.brandId);
    await this.pool.query(
      `insert into content_reviews(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,status,truth,critic,revision_cycle,requested_at,completed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)
       on conflict(asset_id,version) do update set status=excluded.status,truth=excluded.truth,critic=excluded.critic,revision_cycle=excluded.revision_cycle,completed_at=excluded.completed_at`,
      [
        review.id,
        review.workspaceId,
        review.brandId,
        review.campaignId,
        review.assetId,
        review.versionId,
        review.version,
        review.status,
        JSON.stringify(review.truth),
        review.critic ? JSON.stringify(review.critic) : null,
        review.revisionCycle,
        review.requestedAt,
        review.completedAt ?? null,
      ],
    );
    return review;
  }

  async getLatestReview(accountId: string, brandId: string, assetId: string) {
    const workspaceId = await this.scope(accountId, brandId);
    const query = await this.pool.query(
      `select * from content_reviews where workspace_id=$1 and brand_id=$2 and asset_id=$3 order by version desc limit 1`,
      [workspaceId, brandId, assetId],
    );
    return query.rows[0] ? toReview(query.rows[0]) : null;
  }

  async saveApproval(accountId: string, approval: ContentApproval) {
    await this.scope(accountId, approval.brandId);
    const query = await this.pool.query(
      `insert into content_approvals(
         id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,review_id,approver_account_id,destination,destination_channel,destination_account_ref,approved_at
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
       on conflict(workspace_id,brand_id,asset_id,version,destination_channel,destination_account_ref)
       do update set destination=content_approvals.destination
       returning *`,
      [
        approval.id,
        approval.workspaceId,
        approval.brandId,
        approval.campaignId,
        approval.assetId,
        approval.versionId,
        approval.version,
        approval.reviewId,
        approval.approverAccountId,
        JSON.stringify(approval.destination),
        approval.destination.channel,
        approval.destination.accountRef,
        approval.approvedAt,
      ],
    );
    return toApproval(query.rows[0]);
  }

  async getApproval(accountId: string, brandId: string, assetId: string) {
    const workspaceId = await this.scope(accountId, brandId);
    const query = await this.pool.query(
      `select * from content_approvals
       where workspace_id=$1 and brand_id=$2 and asset_id=$3
       order by version desc,approved_at desc,id limit 1`,
      [workspaceId, brandId, assetId],
    );
    return query.rows[0] ? toApproval(query.rows[0]) : null;
  }

  async getApprovalForDestination(accountId: string, brandId: string, assetId: string, destination: ApprovalDestination) {
    const workspaceId = await this.scope(accountId, brandId);
    const query = await this.pool.query(
      `select * from content_approvals
       where workspace_id=$1 and brand_id=$2 and asset_id=$3 and destination_channel=$4 and destination_account_ref=$5
       order by version desc,approved_at desc,id limit 1`,
      [workspaceId, brandId, assetId, destination.channel, destination.accountRef],
    );
    return query.rows[0] ? toApproval(query.rows[0]) : null;
  }

  async listApprovals(accountId: string, brandId: string, assetId: string) {
    const workspaceId = await this.scope(accountId, brandId);
    const query = await this.pool.query(
      `select * from content_approvals
       where workspace_id=$1 and brand_id=$2 and asset_id=$3
       order by version desc,approved_at desc,id`,
      [workspaceId, brandId, assetId],
    );
    return query.rows.map(toApproval);
  }

  private async scope(accountId: string, brandId: string) {
    const query = await this.pool.query(
      `select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id where m.account_id=$1 and m.active=true and b.id=$2`,
      [accountId, brandId],
    );
    if (!query.rows[0]) throw new ResourceNotFoundError("Brand not found");
    return query.rows[0].workspace_id as string;
  }
}

function toReview(row: any): ContentReview {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
    campaignId: row.campaign_id,
    assetId: row.asset_id,
    versionId: row.version_id,
    version: row.version,
    status: row.status,
    truth: row.truth,
    revisionCycle: row.revision_cycle,
    requestedAt: new Date(row.requested_at).toISOString(),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
    ...(row.critic ? { critic: row.critic } : {}),
  };
}

function toApproval(row: any): ContentApproval {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
    campaignId: row.campaign_id,
    assetId: row.asset_id,
    versionId: row.version_id,
    version: row.version,
    reviewId: row.review_id,
    approverAccountId: row.approver_account_id,
    destination: row.destination,
    approvedAt: new Date(row.approved_at).toISOString(),
  };
}
