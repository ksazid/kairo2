import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ConcurrencyConflictError, ResourceNotFoundError } from "@kairo/domain";
import type { BrandDiscoveryPlan, BrandDiscoveryPlanRepository, BrandDiscoveryTopic } from "@kairo/domain/brand-discovery-plan";

export class PgBrandDiscoveryPlanRepository implements BrandDiscoveryPlanRepository {
  constructor(private readonly pool: Pool) {}

  async getLatest(accountId: string, brandId: string): Promise<BrandDiscoveryPlan | undefined> {
    const result = await this.pool.query<PlanRow>(`select p.workspace_id,p.brand_id,p.revision,p.schema_version,p.plan_version,p.snapshot_version,p.state,p.topics,p.excluded_topics,p.created_at
      from brand_discovery_plan_versions p
      join workspace_memberships m on m.workspace_id=p.workspace_id
      where m.account_id=$1 and m.active=true and p.brand_id=$2
      order by p.revision desc limit 1`, [accountId, brandId]);
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async append(accountId: string, plan: BrandDiscoveryPlan): Promise<BrandDiscoveryPlan> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await assertAccess(client, accountId, plan.workspaceId, plan.brandId);
      const latest = await client.query<{ revision: number }>(`select revision from brand_discovery_plan_versions
        where brand_id=$1 order by revision desc limit 1 for update`, [plan.brandId]);
      const currentRevision = latest.rows[0]?.revision ?? 0;
      if (plan.revision !== currentRevision + 1) throw new ConcurrencyConflictError("Discovery Plan changed; refresh before saving");
      const result = await client.query<PlanRow>(`insert into brand_discovery_plan_versions
        (id,workspace_id,brand_id,revision,schema_version,plan_version,snapshot_version,state,topics,excluded_topics)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
        returning workspace_id,brand_id,revision,schema_version,plan_version,snapshot_version,state,topics,excluded_topics,created_at`, [
        randomUUID(), plan.workspaceId, plan.brandId, plan.revision, plan.schemaVersion, plan.planVersion, plan.snapshotVersion, plan.state,
        JSON.stringify(plan.topics), JSON.stringify(plan.excludedTopics),
      ]);
      await client.query("commit");
      return fromRow(result.rows[0]!);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if ((error as { code?: string }).code === "23505") throw new ConcurrencyConflictError("Discovery Plan changed; refresh before saving");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function assertAccess(client: PoolClient, accountId: string, workspaceId: string, brandId: string): Promise<void> {
  const access = await client.query(`select 1 from brands b join workspace_memberships m on m.workspace_id=b.workspace_id
    where m.account_id=$1 and m.active=true and b.workspace_id=$2 and b.id=$3`, [accountId, workspaceId, brandId]);
  if (!access.rowCount) throw new ResourceNotFoundError("Brand not found");
}

type PlanRow = {
  workspace_id: string;
  brand_id: string;
  revision: number;
  schema_version: string;
  plan_version: string;
  snapshot_version: string;
  state: "initial" | "customized";
  topics: BrandDiscoveryTopic[] | string;
  excluded_topics: string[] | string;
  created_at: Date | string;
};

function fromRow(row: PlanRow): BrandDiscoveryPlan {
  return {
    schemaVersion: "1",
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
    revision: row.revision,
    planVersion: row.plan_version,
    snapshotVersion: row.snapshot_version,
    state: row.state,
    topics: json<BrandDiscoveryTopic[]>(row.topics, []),
    excludedTopics: json<string[]>(row.excluded_topics, []),
    updatedAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}

function json<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
