import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PublishingExecutionStore, PublishingJob, ProviderPublishResult } from "@kairo/worker/publishing";
import{enqueueInstagramMetricJobs}from"./instagram-metric-runner";

type ExecutableChannel = Exclude<PublishingJob["channel"], "manual">;

export class PgPublishingExecutionStore implements PublishingExecutionStore {
  private readonly channels?: ExecutableChannel[];

  constructor(private readonly pool: Pool, options: { channels?: ExecutableChannel[] } = {}) {
    if (options.channels) {
      const channels = [...options.channels];
      if (!channels.length || channels.some((value) => value === ("manual" as ExecutableChannel)) || new Set(channels).size !== channels.length) {
        throw new Error("Publishing execution channel filter is invalid");
      }
      this.channels = channels;
    }
  }

  async claimNext(now: string, owner: string, leaseSeconds: number) {
    const x = await this.pool.connect();
    const filter = this.channels ? " and c.channel = any($2::text[])" : "";
    const params = this.channels ? [now, this.channels] : [now];
    try {
      await x.query("begin");
      await x.query(
        `update publish_attempts t set status='unknown',completed_at=$1,failure_code='lease-expired' from publish_commands c where c.id=t.command_id and c.status='dispatching' and c.lease_expires_at<$1 and t.attempt_number=c.attempt_count and t.status='dispatching'${filter}`,
        params,
      );
      await x.query(
        `update publish_commands c set status='unknown',lease_owner=null,lease_expires_at=null where c.status='dispatching' and c.lease_expires_at<$1${filter}`,
        params,
      );
      await x.query(
        `update publish_commands c set status='cancelled' where c.status='scheduled' and coalesce(c.next_attempt_at,c.scheduled_for)<=$1${filter} and not exists(select 1 from content_assets a where a.id=c.asset_id and a.current_version=c.version)`,
        params,
      );
      const q = await x.query(
        `select c.*,v.content,a.credential_ref,a.auth_method from publish_commands c join content_versions v on v.id=c.version_id and v.asset_id=c.asset_id join channel_accounts a on a.id=c.channel_account_id and a.status='connected' where c.status='scheduled' and c.attempt_count<3 and coalesce(c.next_attempt_at,c.scheduled_for)<=$1 and (c.lease_expires_at is null or c.lease_expires_at<$1)${filter} order by coalesce(c.next_attempt_at,c.scheduled_for),c.id for update of c skip locked limit 1`,
        params,
      );
      const r = q.rows[0];
      if (!r) {
        await x.query("commit");
        return null;
      }
      const attemptId = randomUUID();
      const attemptNumber = r.attempt_count + 1;
      const key = `${r.id}:${r.version_id}:${r.account_ref}`;
      const u = await x.query(
        `update publish_commands set status='dispatching',lifecycle_status='publishing',attempt_count=$2,last_attempt_at=$3,lease_owner=$4,lease_expires_at=$3::timestamptz+($5*interval '1 second') where id=$1 and status='scheduled' returning id`,
        [r.id, attemptNumber, now, owner, leaseSeconds],
      );
      if (!u.rows[0]) {
        await x.query("rollback");
        return null;
      }
      await x.query(
        `insert into publish_attempts(id,command_id,version_id,idempotency_key,attempt_number,status,started_at) values($1,$2,$3,$4,$5,'dispatching',$6)`,
        [attemptId, r.id, r.version_id, key, attemptNumber, now],
      );
      await x.query("commit");
      const mediaItems = Array.isArray(r.media_items) ? r.media_items : [];
      return {
        commandId: r.id,
        versionId: r.version_id,
        ...(r.approved_asset_version_id?{approvedAssetVersionId:r.approved_asset_version_id}:{}),
        ...(r.approved_media_fingerprint?{approvedMediaFingerprint:r.approved_media_fingerprint}:{}),
        attemptId,
        attemptNumber,
        leaseOwner: owner,
        idempotencyKey: key,
        channel: r.channel,
        accountRef: r.account_ref,
        credentialRef: r.credential_ref,
        ...(r.auth_method ? { authMethod: r.auth_method } : {}),
        contentType: r.content_type,
        content: r.content,
        mediaUrls: mediaItems.map((item: any) => item?.url).filter((value: unknown): value is string => typeof value === "string"),
        mediaItems,
        options: r.publish_options && typeof r.publish_options === "object" ? r.publish_options : {},
      } as PublishingJob;
    } catch (error) {
      await rollback(x);
      throw error;
    } finally {
      x.release();
    }
  }

  async settle(job: PublishingJob, result: ProviderPublishResult, at: string) {
    const x = await this.pool.connect();
    try {
      await x.query("begin");
      const q = await x.query(
        `select c.*,t.id attempt_id,t.attempt_number from publish_commands c join publish_attempts t on t.command_id=c.id and t.attempt_number=c.attempt_count where c.id=$1 and c.version_id=$2 and c.lease_owner=$3 and t.id=$4 and t.attempt_number=$5 and c.status='dispatching' for update of c,t`,
        [job.commandId, job.versionId, job.leaseOwner, job.attemptId, job.attemptNumber],
      );
      const r = q.rows[0];
      if (!r) throw new Error("Publishing lease is no longer active");
      const mapped = state(result, r.attempt_number, at);
      await x.query(
        `update publish_attempts set status=$2,completed_at=$3,external_post_id=$4,provider_correlation_id=$5,failure_code=$6 where id=$1 and status='dispatching'`,
        [r.attempt_id, mapped.attemptStatus, at, result.status === "published" ? result.externalPostId : null, "providerCorrelationId" in result ? result.providerCorrelationId ?? null : null, "failureCode" in result ? result.failureCode : null],
      );
      await x.query(
        `update publish_commands set status=$2,next_attempt_at=$3,lease_owner=null,lease_expires_at=null,lifecycle_status=$5,meta_container_id=$6,provider_publish_id=$7,failure_reason=$8,published_url=$9 where id=$1 and status='dispatching' and lease_owner=$4`,
        [job.commandId, mapped.commandStatus, mapped.nextAttemptAt, job.leaseOwner,mapped.lifecycleStatus,"providerCorrelationId" in result?result.providerCorrelationId??null:null,result.status==="published"?result.externalPostId:null,"failureCode" in result?result.failureCode:result.status==="manual-required"?result.reason:result.status==="unknown"&&!result.providerCorrelationId?"provider-result-unknown":null,result.status==="published"?result.publishedUrl??null:null],
      );
      if (result.status === "published") {
        const publishedPostId=randomUUID();
        await x.query(
          `insert into published_posts(id,workspace_id,brand_id,campaign_id,asset_id,version_id,publish_command_id,channel,account_ref,external_post_id,published_at,published_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [publishedPostId, r.workspace_id, r.brand_id, r.campaign_id, r.asset_id, r.version_id, r.id, r.channel, r.account_ref, result.externalPostId, at,result.publishedUrl??null],
        );
        await enqueueInstagramMetricJobs(x,publishedPostId,at);
      }
      await x.query("commit");
    } catch (error) {
      await rollback(x);
      throw error;
    } finally {
      x.release();
    }
  }
}

function state(r: ProviderPublishResult, n: number, at: string) {
  if (r.status === "published") return { attemptStatus: "published", commandStatus: "published", lifecycleStatus:"published",nextAttemptAt: null };
  if (r.status === "unknown") return { attemptStatus: "unknown", commandStatus: "unknown", lifecycleStatus:r.providerCorrelationId?"processing":"failed",nextAttemptAt: null };
  if (r.status === "manual-required") return { attemptStatus: "failed", commandStatus: "manual-required", lifecycleStatus:"failed",nextAttemptAt: null };
  if (r.retryable && n < 3) {
    const seconds = Math.max(30, Math.min(r.retryAfterSeconds ?? 60, 3600));
    return { attemptStatus: "failed", commandStatus: "scheduled", lifecycleStatus:"approved",nextAttemptAt: new Date(Date.parse(at) + seconds * 1000).toISOString() };
  }
  return { attemptStatus: "failed", commandStatus: "failed", lifecycleStatus:"failed",nextAttemptAt: null };
}

async function rollback(x: PoolClient) {
  try { await x.query("rollback"); } catch {}
}
