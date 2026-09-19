import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgKairoRepository } from "./postgres-store";
import { PgOperationsRepository } from "./operations-postgres-store";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("PostgreSQL VS-10 publishing operations projection", () => {
  const pool = new Pool({ connectionString: url });
  const core = new PgKairoRepository(pool);
  const operations = new PgOperationsRepository(pool);

  beforeAll(async () => {
    for (const [file, marker] of [
      ["0001_identity_workspace_brand.sql", "accounts"],
      ["0002_brand_brain_knowledge.sql", "knowledge_sources"],
      ["0003_hunter_discover.sql", "public_signals"],
      ["0004_research_angles.sql", "ideas"],
      ["0005_campaign_content.sql", "campaigns"],
      ["0006_content_review_approval.sql", "content_reviews"],
      ["0007_channel_calendar_publishing.sql", "publish_commands"],
      ["0008_performance_tracking.sql", "metric_snapshots"],
      ["0009_performance_learning.sql", "brand_learnings"],
      ["0010_pilot_operations.sql", "operational_failures"],
    ] as const) {
      const exists = await pool.query<{ name: string | null }>("select to_regclass($1)::text name", [`public.${marker}`]);
      if (!exists.rows[0]?.name) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
    const projection = await pool.query("select 1 from pg_trigger where tgname='trg_publish_outcome_operations' and not tgisinternal");
    if (!projection.rows[0]) await pool.query(await readFile(new URL("../migrations/0011_publishing_operations_projection.sql", import.meta.url), "utf8"));
    const retryDispatch = await pool.query("select 1 from pg_trigger where tgname='trg_operations_safe_retry_dispatch' and not tgisinternal");
    if (!retryDispatch.rows[0]) await pool.query(await readFile(new URL("../migrations/0013_operations_safe_retry_dispatch.sql", import.meta.url), "utf8"));
  });

  beforeEach(() => pool.query("truncate operator_interventions,workflow_cost_events,workflow_budgets,automation_controls,retry_requests,operational_failures,content_experiments,brand_learnings,normalized_metrics,metric_snapshots,published_posts,publish_attempts,publish_commands,channel_accounts,content_approvals,content_reviews,content_versions,content_assets,campaigns,angles,claim_evidence,claims,evidence_references,research_dossiers,ideas,brand_opportunity_signals,brand_opportunities,public_signals,knowledge_source_derivations,brand_brain_field_sources,brand_brain_fields,knowledge_sources,audit_events,brands,workspace_memberships,workspaces,external_identities,accounts cascade"));
  afterAll(() => pool.end());

  async function fixture() {
    const user = await core.resolveAccount({ provider: "test", subject: "alice" });
    const made = await core.createWorkspaceWithBrand(user.id, { workspaceName: "Studio", brandName: "Kairo" });
    const workspaceId = made.workspace.id;
    const brandId = made.brand.id;
    for (const sql of [
      `insert into ideas(id,workspace_id,brand_id,title,premise,source_type,status,created_at) values('i',$1,$2,'Idea','Premise','user','research-ready',now())`,
      `insert into research_dossiers(id,workspace_id,brand_id,idea_id,summary,unresolved_uncertainties,status,created_at) values('r',$1,$2,'i','Research','[]','ready',now())`,
      `insert into angles(id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,status,version) values('g',$1,$2,'i','Angle','Frame','Audience','Goal','Hook','Value','low','text','linkedin','[]','selected',1)`,
      `insert into campaigns(id,workspace_id,brand_id,idea_id,research_id,angle_id,name,objective,supporting_claim_ids,status,created_at) values('c',$1,$2,'i','r','g','Campaign','Goal','[]','draft',now())`,
      `insert into content_assets(id,workspace_id,brand_id,campaign_id,channel,format,audience,topic,hook_type,cta,supporting_claim_ids,current_version,status,created_at) values('a',$1,$2,'c','linkedin','text','Audience','Topic','fact','Read','[]',1,'draft',now())`,
      `insert into content_versions(id,workspace_id,brand_id,campaign_id,asset_id,version,content,supporting_claim_ids,actor,action,created_at) values('v',$1,$2,'c','a',1,'PRIVATE-CONTENT','[]','user','manual-edit',now())`,
      `insert into content_reviews(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,status,truth,revision_cycle,requested_at,completed_at) values('q',$1,$2,'c','a','v',1,'passed','{}',0,now(),now())`,
    ]) await pool.query(sql, [workspaceId, brandId]);
    await pool.query(`insert into content_approvals(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,review_id,approver_account_id,destination,approved_at) values('p',$1,$2,'c','a','v',1,'q',$3,'{"channel":"linkedin","accountRef":"page"}',now())`, [workspaceId, brandId, user.id]);
    await pool.query(`insert into channel_accounts(id,workspace_id,brand_id,channel,account_ref,display_name,credential_ref,capabilities,status,connected_at) values('ca',$1,$2,'linkedin','page','Kairo','SECRET-CREDENTIAL','["publish-text"]','connected',now())`, [workspaceId, brandId]);
    await pool.query(`insert into publish_commands(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,approval_id,channel_account_id,channel,account_ref,content_type,scheduled_for,status,attempt_count,created_at,last_attempt_at) values('cmd',$1,$2,'c','a','v',1,'p','ca','linkedin','page','text',now(),'dispatching',1,now(),now())`, [workspaceId, brandId]);
    return { accountId: user.id, workspaceId, brandId };
  }

  it("projects safe, blocked, and unknown publish outcomes without provider or private payloads", async () => {
    const { brandId } = await fixture();
    await pool.query(`insert into publish_attempts(id,command_id,version_id,idempotency_key,attempt_number,status,started_at,completed_at,provider_correlation_id,failure_code) values('t1','cmd','v','k1',1,'failed',now(),now(),'SECRET-CORRELATION','RATE LIMIT / SECRET-CREDENTIAL')`);
    await pool.query(`update publish_commands set status='scheduled',next_attempt_at=now()+interval '1 minute' where id='cmd'`);
    await pool.query(`update publish_commands set status='dispatching',attempt_count=2 where id='cmd'`);
    await pool.query(`insert into publish_attempts(id,command_id,version_id,idempotency_key,attempt_number,status,started_at,completed_at,provider_correlation_id,failure_code) values('t2','cmd','v','k2',2,'unknown',now(),now(),'corr-2',null)`);
    await pool.query(`update publish_commands set status='unknown' where id='cmd'`);
    await pool.query(`update publish_commands set status='dispatching',attempt_count=3 where id='cmd'`);
    await pool.query(`insert into publish_attempts(id,command_id,version_id,idempotency_key,attempt_number,status,started_at,completed_at,provider_correlation_id,failure_code) values('t3','cmd','v','k3',3,'failed',now(),now(),'corr-3','provider-hard-failure')`);
    await pool.query(`update publish_commands set status='failed' where id='cmd'`);
    const rows = (await pool.query(`select * from operational_failures where brand_id=$1 order by attempt`, [brandId])).rows;
    expect(rows.map((row) => [row.attempt, row.retry_disposition, row.diagnostic_code])).toEqual([
      [1, "safe", "publishing-retryable-failure"],
      [2, "manual-review", "provider-outcome-unknown"],
      [3, "blocked", "publishing-terminal-failure"],
    ]);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("PRIVATE-CONTENT");
    expect(serialized).not.toContain("SECRET-CREDENTIAL");
    expect(serialized).not.toContain("SECRET-CORRELATION");
    expect(rows.every((row) => row.trace_id === null)).toBe(true);
  });

  it("atomically expedites a safe scheduled publishing retry and keeps replay idempotent", async () => {
    const { accountId, brandId } = await fixture();
    await pool.query(`insert into publish_attempts(id,command_id,version_id,idempotency_key,attempt_number,status,started_at,completed_at,failure_code) values('t1','cmd','v','k1',1,'failed',now(),now(),'retryable')`);
    await pool.query(`update publish_commands set status='scheduled',next_attempt_at=now()+interval '1 hour' where id='cmd'`);
    const failure = (await pool.query<{ id: string; occurred_at: Date }>(`select id,occurred_at from operational_failures where brand_id=$1 and retry_disposition='safe'`, [brandId])).rows[0];
    expect(failure).toBeTruthy();
    if (!failure) throw new Error("safe failure missing");

    const requestedAt = new Date(failure.occurred_at.getTime() + 1000).toISOString();
    const first = await operations.requestRetry(accountId, brandId, failure.id, "operator-retry-1", requestedAt);
    const command = (await pool.query<{ status: string; attempt_count: number; next_attempt_at: Date }>(`select status,attempt_count,next_attempt_at from publish_commands where id='cmd'`)).rows[0];
    expect(command?.status).toBe("scheduled");
    expect(command?.attempt_count).toBe(1);
    expect(command?.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now() + 5000);

    const replay = await operations.requestRetry(accountId, brandId, failure.id, "operator-retry-1", new Date(Date.parse(requestedAt) + 1000).toISOString());
    expect(replay.id).toBe(first.id);
    expect((await pool.query(`select count(*)::int n from retry_requests where failure_id=$1`, [failure.id])).rows[0].n).toBe(1);
    expect((await pool.query(`select count(*)::int n from operator_interventions where related_failure_id=$1`, [failure.id])).rows[0].n).toBe(1);
  });
});
