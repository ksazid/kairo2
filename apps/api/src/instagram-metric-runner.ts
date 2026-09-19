import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  createMetricSnapshot,
  normalizeMetricSnapshot,
  type NormalizedMetric,
  type RawMetricSnapshot,
} from "@kairo/domain/analytics";
import type { PublishedPost } from "@kairo/domain/publishing";
import {
  PerformanceCollectionWorker,
  type MetricCollectionJob,
  type MetricCollectionResult,
} from "@kairo/worker/performance";
import { instagramMetricTransformation } from "@kairo/worker/instagram-insights";

export interface ClaimedMetricCollection {
  job: MetricCollectionJob;
  post: PublishedPost;
}
export interface MetricCollectionJobStore {
  seedInstagram(now: string): Promise<void>;
  claim(
    now: string,
    leaseOwner: string,
    leaseSeconds: number,
  ): Promise<ClaimedMetricCollection | null>;
  settle(
    claimed: ClaimedMetricCollection,
    result: MetricCollectionResult,
    at: string,
    snapshot?: RawMetricSnapshot,
    metrics?: NormalizedMetric[],
  ): Promise<void>;
}
export async function enqueueInstagramMetricJobs(
  client: Pick<PoolClient, "query">,
  publishedPostId: string,
  createdAt: string,
) {
  await client.query(
    `insert into metric_collection_jobs(id,workspace_id,brand_id,published_post_id,provider,account_ref,external_post_id,credential_ref,scheduled_for,status,created_at,collection_window) select pp.id||':instagram:'||s.key,pp.workspace_id,pp.brand_id,pp.id,'instagram',pp.account_ref,pp.external_post_id,ca.insights_credential_ref,pp.published_at+s.delay,'queued',$2,s.key from published_posts pp join channel_accounts ca on ca.workspace_id=pp.workspace_id and ca.brand_id=pp.brand_id and ca.channel='instagram' and ca.account_ref=pp.account_ref and ca.status='connected' join channel_credentials cc on cc.credential_ref=ca.insights_credential_ref and cc.revoked_at is null cross join(values('1h',interval '1 hour'),('24h',interval '24 hours'),('7d',interval '7 days'))as s(key,delay) where pp.id=$1 and pp.channel='instagram' and ca.insights_credential_ref is not null on conflict(published_post_id,provider,scheduled_for)do nothing`,
    [publishedPostId, createdAt],
  );
}
export class InstagramMetricCollectionRunner {
  constructor(
    private readonly store: MetricCollectionJobStore,
    private readonly worker: PerformanceCollectionWorker,
    private readonly leaseOwner: string,
    private readonly leaseSeconds = 90,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}
  async runOnce() {
    const at = this.now().toISOString();
    await this.store.seedInstagram(at);
    const claimed = await this.store.claim(
      at,
      this.leaseOwner,
      this.leaseSeconds,
    );
    if (!claimed) return false;
    const result = await this.worker.execute(claimed.job);
    if (result.status === "collected") {
      const capturedAt = this.now().toISOString(),
        scheduled = claimed.job.scheduledFor ?? capturedAt,
        delaySeconds = Math.max(
          0,
          Math.floor((Date.parse(capturedAt) - Date.parse(scheduled)) / 1000),
        ),
        snapshot = createMetricSnapshot({
          id: this.id(),
          post: claimed.post,
          provider: "instagram",
          capturedAt,
          raw: {
            ...result.raw,
            _kairoCollection: {
              window: claimed.job.collectionWindow ?? "unknown",
              scheduledFor: scheduled,
              delaySeconds,
              freshness: delaySeconds > 900 ? "delayed" : "fresh",
            },
          },
          ...(result.providerRequestId
            ? { providerRequestId: result.providerRequestId }
            : {}),
        });
      await this.store.settle(
        claimed,
        result,
        snapshot.capturedAt,
        snapshot,
        normalizeMetricSnapshot(snapshot, instagramMetricTransformation),
      );
    } else await this.store.settle(claimed, result, this.now().toISOString());
    return true;
  }
}

export class PgMetricCollectionJobStore implements MetricCollectionJobStore {
  constructor(private readonly pool: Pool) {}
  async seedInstagram(now: string) {
    await this.pool.query(
      `insert into metric_collection_jobs(id,workspace_id,brand_id,published_post_id,provider,account_ref,external_post_id,credential_ref,scheduled_for,status,created_at,collection_window) select pp.id||':instagram:'||s.key,pp.workspace_id,pp.brand_id,pp.id,'instagram',pp.account_ref,pp.external_post_id,ca.insights_credential_ref,pp.published_at+s.delay,'queued',$1,s.key from published_posts pp join channel_accounts ca on ca.workspace_id=pp.workspace_id and ca.brand_id=pp.brand_id and ca.channel='instagram' and ca.account_ref=pp.account_ref and ca.status='connected' join channel_credentials cc on cc.credential_ref=ca.insights_credential_ref and cc.revoked_at is null cross join (values ('1h',interval '1 hour'),('24h',interval '24 hours'),('7d',interval '7 days')) as s(key,delay) where pp.channel='instagram' and ca.insights_credential_ref is not null on conflict(published_post_id,provider,scheduled_for) do nothing`,
      [now],
    );
  }
  async claim(
    now: string,
    leaseOwner: string,
    leaseSeconds: number,
  ): Promise<ClaimedMetricCollection | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update metric_collection_jobs set status='failed',completed_at=$1,lease_owner=null,lease_expires_at=null,failure_code='attempt-limit' where status='running' and attempt>=3 and lease_expires_at is not null and lease_expires_at <= $1`,
        [now],
      );
      const selected = await client.query(
        `select j.*,pp.campaign_id,pp.asset_id,pp.version_id,pp.publish_command_id,pp.channel,pp.published_at,ca.auth_method from metric_collection_jobs j join published_posts pp on pp.id=j.published_post_id left join channel_accounts ca on ca.workspace_id=j.workspace_id and ca.brand_id=j.brand_id and ca.channel='instagram' and ca.account_ref=j.account_ref where j.attempt<3 and ((j.status='queued' and coalesce(j.next_attempt_at,j.scheduled_for) <= $1) or (j.status='running' and j.lease_expires_at is not null and j.lease_expires_at <= $1)) order by coalesce(j.next_attempt_at,j.scheduled_for),j.id for update of j skip locked limit 1`,
        [now],
      );
      const row = selected.rows[0];
      if (!row) {
        await client.query("commit");
        return null;
      }
      const attempt = Number(row.attempt) + 1;
      await client.query(
        `update metric_collection_jobs set status='running',attempt=$2,lease_owner=$3,lease_expires_at=$4::timestamptz + ($5||' seconds')::interval where id=$1`,
        [row.id, attempt, leaseOwner, now, leaseSeconds],
      );
      await client.query("commit");
      return {
        job: {
          id: row.id,
          workspaceId: row.workspace_id,
          brandId: row.brand_id,
          publishedPostId: row.published_post_id,
          provider: "instagram",
          accountRef: row.account_ref,
          externalPostId: row.external_post_id,
          credentialRef: row.credential_ref,
          attempt,
          scheduledFor: iso(row.scheduled_for),
          collectionWindow: row.collection_window,
          leaseOwner,
          ...(row.auth_method ? { authMethod: row.auth_method } : {}),
        },
        post: {
          id: row.published_post_id,
          workspaceId: row.workspace_id,
          brandId: row.brand_id,
          campaignId: row.campaign_id,
          assetId: row.asset_id,
          versionId: row.version_id,
          publishCommandId: row.publish_command_id,
          channel: row.channel,
          accountRef: row.account_ref,
          externalPostId: row.external_post_id,
          publishedAt: iso(row.published_at),
        },
      };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
  async settle(
    claimed: ClaimedMetricCollection,
    result: MetricCollectionResult,
    at: string,
    snapshot?: RawMetricSnapshot,
    metrics: NormalizedMetric[] = [],
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const lease = await client.query(
        `select 1 from metric_collection_jobs where id=$1 and status='running' and lease_owner=$2 and attempt=$3 for update`,
        [claimed.job.id, claimed.job.leaseOwner, claimed.job.attempt],
      );
      if (!lease.rowCount)
        throw new Error("Metric collection lease is no longer active");
      if (result.status === "collected") {
        if (!snapshot)
          throw new Error("Collected metric result requires snapshot");
        await appendMetrics(client, snapshot, metrics);
        await client.query(
          `update metric_collection_jobs set status='complete',completed_at=$2,lease_owner=null,lease_expires_at=null,failure_code=null,unavailable_reason=null where id=$1 and status='running'`,
          [claimed.job.id, at],
        );
      } else if (result.status === "retry" && claimed.job.attempt < 3) {
        await client.query(
          `update metric_collection_jobs set status='queued',next_attempt_at=$2::timestamptz + ($3||' seconds')::interval,lease_owner=null,lease_expires_at=null,failure_code=$4 where id=$1 and status='running'`,
          [claimed.job.id, at, result.retryAfterSeconds, result.failureCode],
        );
      } else if (result.status === "unavailable") {
        await client.query(
          `update metric_collection_jobs set status='unavailable',completed_at=$2,lease_owner=null,lease_expires_at=null,unavailable_reason=$3 where id=$1 and status='running'`,
          [claimed.job.id, at, result.reason],
        );
        if (result.reason === "permission-required")
          await client.query(
            `update channel_accounts set status='reconnect-required',last_verified_at=$4 where workspace_id=$1 and brand_id=$2 and channel='instagram' and account_ref=$3 and status='connected'`,
            [
              claimed.job.workspaceId,
              claimed.job.brandId,
              claimed.job.accountRef,
              at,
            ],
          );
      } else {
        const failureCode =
          result.status === "failed"
            ? result.failureCode
            : result.status === "retry"
              ? result.failureCode
              : "metric-collection-failed";
        await client.query(
          `update metric_collection_jobs set status='failed',completed_at=$2,lease_owner=null,lease_expires_at=null,failure_code=$3 where id=$1 and status='running'`,
          [claimed.job.id, at, failureCode],
        );
      }
      await client.query("commit");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
async function appendMetrics(
  client: PoolClient,
  snapshot: RawMetricSnapshot,
  metrics: NormalizedMetric[],
) {
  await client.query(
    `insert into metric_snapshots(id,workspace_id,brand_id,published_post_id,campaign_id,asset_id,version_id,channel,account_ref,external_post_id,provider,captured_at,raw,provider_request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
    [
      snapshot.id,
      snapshot.workspaceId,
      snapshot.brandId,
      snapshot.publishedPostId,
      snapshot.campaignId,
      snapshot.assetId,
      snapshot.versionId,
      snapshot.channel,
      snapshot.accountRef,
      snapshot.externalPostId,
      snapshot.provider,
      snapshot.capturedAt,
      JSON.stringify(snapshot.raw),
      snapshot.providerRequestId ?? null,
    ],
  );
  for (const metric of metrics)
    await client.query(
      `insert into normalized_metrics(id,workspace_id,brand_id,published_post_id,name,captured_at,status,value,unavailable_reason,source_snapshot_id,source_field,transformation_version) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        metric.id,
        metric.workspaceId,
        metric.brandId,
        metric.publishedPostId,
        metric.name,
        metric.capturedAt,
        metric.status,
        metric.value ?? null,
        metric.reason ?? null,
        metric.sourceSnapshotId,
        metric.sourceField,
        metric.transformationVersion,
      ],
    );
}
function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
async function rollback(client: PoolClient) {
  try {
    await client.query("rollback");
  } catch {}
}
