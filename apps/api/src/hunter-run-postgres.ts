import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ResourceNotFoundError } from "@kairo/domain";
import type {
  CompleteHunterRunInput,
  FailHunterRunInput,
  HunterRunRecord,
  HunterRunRepository,
  StartHunterRunInput,
} from "@kairo/domain/hunter-run-record";

export class PgHunterRunRepository implements HunterRunRepository {
  constructor(private readonly pool: Pool) {}

  async start(accountId: string, input: StartHunterRunInput): Promise<HunterRunRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await assertAccess(client, accountId, input.workspaceId, input.brandId);
      const result = await client.query<RunRow>(`insert into hunter_run_records
        (run_id,schema_version,workspace_id,brand_id,snapshot_version,plan_version,trigger,status,started_at)
        values ($1,'1',$2,$3,$4,$5,$6,'running',$7)
        returning *`, [randomUUID(), input.workspaceId, input.brandId, input.snapshotVersion, input.planVersion, input.trigger, input.startedAt]);
      await client.query("commit");
      return fromRow(result.rows[0]!);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async complete(accountId: string, runId: string, input: CompleteHunterRunInput): Promise<HunterRunRecord> {
    return this.finish(accountId, runId, "succeeded", input);
  }

  async fail(accountId: string, runId: string, input: FailHunterRunInput): Promise<HunterRunRecord> {
    return this.finish(accountId, runId, "failed", input);
  }

  async listRecent(accountId: string, brandId: string, limit = 20): Promise<HunterRunRecord[]> {
    const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 20;
    const result = await this.pool.query<RunRow>(`select r.* from hunter_run_records r
      join workspace_memberships m on m.workspace_id=r.workspace_id
      where m.account_id=$1 and m.active=true and r.brand_id=$2
      order by r.started_at desc, r.run_id desc limit $3`, [accountId, brandId, bounded]);
    return result.rows.map(fromRow);
  }

  async getLatest(accountId: string, brandId: string): Promise<HunterRunRecord | undefined> {
    return (await this.listRecent(accountId, brandId, 1))[0];
  }

  private async finish(accountId: string, runId: string, status: "succeeded" | "failed", input: CompleteHunterRunInput | FailHunterRunInput): Promise<HunterRunRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const access = await client.query(`select 1 from hunter_run_records r join workspace_memberships m on m.workspace_id=r.workspace_id
        where m.account_id=$1 and m.active=true and r.run_id=$2`, [accountId, runId]);
      if (!access.rowCount) throw new ResourceNotFoundError("Hunter run not found");
      const failed = status === "failed" ? input as FailHunterRunInput : undefined;
      const succeeded = status === "succeeded" ? input as CompleteHunterRunInput : undefined;
      const result = await client.query<RunRow>(`update hunter_run_records set
        status=$2, completed_at=$3, duration_ms=$4,
        evidence_count=$5, candidate_count=$6, opportunity_count=$7,
        sources_scanned=$8::jsonb, degraded_sources=$9::jsonb,
        failure_code=$10, failure_message=$11, updated_at=now()
        where run_id=$1 and status='running'
        returning *`, [runId, status, input.completedAt, input.durationMs,
        succeeded?.evidenceCount ?? 0, succeeded?.candidateCount ?? 0, succeeded?.opportunityCount ?? 0,
        JSON.stringify(input.sourcesScanned), JSON.stringify(input.degradedSources), failed?.failureCode ?? null, failed?.failureMessage ?? null]);
      if (!result.rows[0]) throw new Error("Hunter run is already terminal");
      await client.query("commit");
      return fromRow(result.rows[0]);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}

async function assertAccess(client: PoolClient, accountId: string, workspaceId: string, brandId: string) {
  const access = await client.query(`select 1 from brands b join workspace_memberships m on m.workspace_id=b.workspace_id
    where m.account_id=$1 and m.active=true and b.workspace_id=$2 and b.id=$3`, [accountId, workspaceId, brandId]);
  if (!access.rowCount) throw new ResourceNotFoundError("Brand not found");
}

type RunRow = {
  run_id: string; schema_version: string; workspace_id: string; brand_id: string; snapshot_version: string; plan_version: string;
  trigger: "manual" | "scheduled"; status: "running" | "succeeded" | "failed"; started_at: Date | string; completed_at: Date | string | null;
  duration_ms: number | null; evidence_count: number; candidate_count: number; opportunity_count: number;
  sources_scanned: string[] | string; degraded_sources: string[] | string; failure_code: string | null; failure_message: string | null;
};

function fromRow(row: RunRow): HunterRunRecord {
  return {
    schemaVersion: "1", runId: row.run_id, workspaceId: row.workspace_id, brandId: row.brand_id,
    snapshotVersion: row.snapshot_version, planVersion: row.plan_version, trigger: row.trigger, status: row.status,
    startedAt: iso(row.started_at), ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}), evidenceCount: row.evidence_count,
    candidateCount: row.candidate_count, opportunityCount: row.opportunity_count,
    sourcesScanned: json(row.sources_scanned), degradedSources: json(row.degraded_sources),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}), ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
  };
}

function iso(value: Date | string) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function json(value: string[] | string): string[] { if (Array.isArray(value)) return value; try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []; } catch { return []; } }
