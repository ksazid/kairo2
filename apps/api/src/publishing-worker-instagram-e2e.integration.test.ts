import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectChannelAccount, createPublishCommand } from "@kairo/domain/publishing";
import type { ContentApproval } from "@kairo/domain/review";
import { DeterministicPublishingWorker, PublishingJobRunner } from "@kairo/worker/publishing";
import { InstagramProfessionalAdapter } from "@kairo/worker/publishing-adapters";
import { PgEncryptedChannelCredentialVault } from "./instagram-connection-postgres";
import { PgKairoRepository } from "./postgres-store";
import { PgPublishingExecutionStore } from "./publishing-execution-postgres-store";
import { PgPublishingRepository } from "./publishing-postgres-store";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const scheduledAt = "2026-08-17T04:00:00.000Z";

suite("VS-63 Instagram publishing worker end-to-end", () => {
  const pool = new Pool({ connectionString: url });
  const core = new PgKairoRepository(pool);
  const repo = new PgPublishingRepository(pool);

  beforeAll(async () => {
    const required = [
      ["0001_identity_workspace_brand.sql", "accounts"],
      ["0002_brand_brain_knowledge.sql", "knowledge_sources"],
      ["0003_hunter_discover.sql", "public_signals"],
      ["0004_research_angles.sql", "ideas"],
      ["0005_campaign_content.sql", "campaigns"],
      ["0006_content_review_approval.sql", "content_reviews"],
      ["0007_channel_calendar_publishing.sql", "publish_commands"],
    ] as const;
    for (const [file, marker] of required) {
      const exists = await pool.query<{ name: string | null }>("select to_regclass($1)::text name", [`public.${marker}`]);
      if (!exists.rows[0]?.name) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
    const rich = await pool.query("select 1 from information_schema.columns where table_name='publish_commands' and column_name='media_items'");
    if (!rich.rows[0]) await pool.query(await readFile(new URL("../migrations/0014_instagram_rich_publishing.sql", import.meta.url), "utf8"));
    const vault = await pool.query<{ name: string | null }>("select to_regclass('public.channel_credentials')::text name");
    if (!vault.rows[0]?.name) await pool.query(await readFile(new URL("../migrations/0015_instagram_connection_insights.sql", import.meta.url), "utf8"));
  });

  beforeEach(async () => {
    await pool.query("truncate metric_collection_jobs,channel_oauth_candidates,channel_oauth_intents,channel_credentials,published_posts,publish_attempts,publish_commands,channel_accounts,content_approvals,content_reviews,content_versions,content_assets,campaigns,angles,claim_evidence,claims,evidence_references,research_dossiers,ideas,brand_opportunity_signals,brand_opportunities,public_signals,knowledge_source_derivations,brand_brain_field_sources,brand_brain_fields,knowledge_sources,audit_events,brands,workspace_memberships,workspaces,external_identities,accounts cascade");
  });

  afterAll(() => pool.end());

  it("publishes an approved carousel through encrypted credentials, Meta adapter, settlement and published_posts exactly once", async () => {
    const calls: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
    let child = 0;
    const fetchImpl: FetchLike = async (input, init) => {
      const requestUrl = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url: requestUrl, authorization: new Headers(init?.headers).get("authorization"), body });
      if (requestUrl.endsWith("/media_publish")) return jsonResponse({ id: "ig-post-1" });
      if (requestUrl.endsWith("/ig-post-1?fields=permalink")) return jsonResponse({ permalink: "https://www.instagram.com/p/kairo-e2e/" });
      if (body.is_carousel_item === true) return jsonResponse({ id: `child-${++child}` });
      if (body.media_type === "CAROUSEL") return jsonResponse({ id: "parent-1" });
      throw new Error(`Unexpected Meta request: ${requestUrl}`);
    };

    const seeded = await seedCarousel(fetchImpl);
    expect(await seeded.runner.runOnce()).toBe(true);
    expect(await seeded.runner.runOnce()).toBe(false);

    expect(calls).toHaveLength(5);
    expect(calls.every(call => call.authorization === "Bearer test-page-token")).toBe(true);
    expect(calls[0]?.body).toEqual({ image_url: "https://cdn.example.com/slide-1.png", is_carousel_item: true });
    expect(calls[1]?.body).toEqual({ image_url: "https://cdn.example.com/slide-2.png", is_carousel_item: true });
    expect(calls[2]?.body).toEqual({ media_type: "CAROUSEL", children: "child-1,child-2", caption: "Carousel caption" });
    expect(calls[3]?.body).toEqual({ creation_id: "parent-1" });
    expect(calls[4]).toMatchObject({ url: "https://graph.facebook.com/v24.0/ig-post-1?fields=permalink", body: {} });

    const credential = await pool.query<{ ciphertext: string }>("select ciphertext from channel_credentials where credential_ref=$1", [seeded.credentialRef]);
    expect(credential.rows[0]?.ciphertext).toBeTruthy();
    expect(credential.rows[0]?.ciphertext).not.toContain("test-page-token");

    const command = await pool.query("select status,lifecycle_status,provider_publish_id,meta_container_id,published_url,attempt_count,lease_owner,lease_expires_at from publish_commands where id='cmd'");
    expect(command.rows[0]).toMatchObject({ status: "published", lifecycle_status: "published", provider_publish_id: "ig-post-1", meta_container_id: "parent-1", published_url: "https://www.instagram.com/p/kairo-e2e/", attempt_count: 1, lease_owner: null, lease_expires_at: null });

    const attempt = await pool.query("select status,external_post_id,provider_correlation_id,failure_code from publish_attempts where command_id='cmd'");
    expect(attempt.rows[0]).toMatchObject({ status: "published", external_post_id: "ig-post-1", provider_correlation_id: "parent-1", failure_code: null });

    const published = await pool.query("select channel,account_ref,external_post_id,published_url from published_posts where publish_command_id='cmd'");
    expect(published.rows).toEqual([{ channel: "instagram", account_ref: "123456", external_post_id: "ig-post-1", published_url: "https://www.instagram.com/p/kairo-e2e/" }]);
  });

  it("schedules the VS-62 transient retry hint and creates no published record when Meta returns HTTP 500", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "temporary" }), { status: 500, headers: { "content-type": "application/json" } });
    };

    const seeded = await seedCarousel(fetchImpl);
    expect(await seeded.runner.runOnce()).toBe(true);
    expect(await seeded.runner.runOnce()).toBe(false);
    expect(calls).toBe(1);

    const command = await pool.query("select status,attempt_count,next_attempt_at,lease_owner from publish_commands where id='cmd'");
    expect(command.rows[0]?.status).toBe("scheduled");
    expect(command.rows[0]?.attempt_count).toBe(1);
    const retryDelayMs = new Date(command.rows[0]?.next_attempt_at).getTime() - Date.parse(scheduledAt);
    expect(retryDelayMs).toBe(30_000);
    expect(command.rows[0]?.lease_owner).toBeNull();

    const attempt = await pool.query("select status,failure_code,external_post_id from publish_attempts where command_id='cmd'");
    expect(attempt.rows[0]).toMatchObject({ status: "failed", failure_code: "provider-http-500", external_post_id: null });
    expect((await pool.query("select count(*)::int count from published_posts where publish_command_id='cmd'")).rows[0]?.count).toBe(0);
  });

  async function seedCarousel(fetchImpl: FetchLike) {
    const user = await core.resolveAccount({ provider: "test", subject: "vs63-e2e-user" });
    const made = await core.createWorkspaceWithBrand(user.id, { workspaceName: "Studio", brandName: "Kairo" });
    const workspaceId = made.workspace.id;
    const brandId = made.brand.id;

    const fixtures = [
      `insert into ideas(id,workspace_id,brand_id,title,premise,source_type,status,created_at) values('i',$1,$2,'Idea','Premise','user','research-ready',now())`,
      `insert into research_dossiers(id,workspace_id,brand_id,idea_id,summary,unresolved_uncertainties,status,created_at) values('r',$1,$2,'i','Research','[]','ready',now())`,
      `insert into angles(id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,status,version) values('g',$1,$2,'i','Angle','Frame','Audience','Goal','Hook','Value','low','carousel','instagram','[]','selected',1)`,
      `insert into campaigns(id,workspace_id,brand_id,idea_id,research_id,angle_id,name,objective,supporting_claim_ids,status,created_at) values('c',$1,$2,'i','r','g','Campaign','Goal','[]','draft',now())`,
      `insert into content_assets(id,workspace_id,brand_id,campaign_id,channel,format,audience,topic,hook_type,cta,supporting_claim_ids,current_version,status,created_at) values('a',$1,$2,'c','instagram','carousel','Audience','Topic','fact','Read','[]',1,'draft',now())`,
      `insert into content_versions(id,workspace_id,brand_id,campaign_id,asset_id,version,content,supporting_claim_ids,actor,action,created_at) values('v',$1,$2,'c','a',1,'Carousel caption','[]','user','manual-edit',now())`,
      `insert into content_reviews(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,status,truth,revision_cycle,requested_at,completed_at) values('q',$1,$2,'c','a','v',1,'passed','{}',0,now(),now())`,
    ];
    for (const sql of fixtures) await pool.query(sql, [workspaceId, brandId]);
    await pool.query(`insert into content_approvals(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,review_id,approver_account_id,destination,approved_at) values('p',$1,$2,'c','a','v',1,'q',$3,'{"channel":"instagram","accountRef":"123456"}',now())`, [workspaceId, brandId, user.id]);

    const credentialRef = "meta-instagram:publish:vs63-e2e";
    const vault = new PgEncryptedChannelCredentialVault(pool, encryptionKey, () => new Date("2026-08-17T03:00:00.000Z"));
    await vault.store(workspaceId, brandId, credentialRef, "test-page-token");

    const channel = await repo.saveChannelAccount(user.id, connectChannelAccount({
      id: "ca",
      workspaceId,
      brandId,
      channel: "instagram",
      accountRef: "123456",
      displayName: "@kairo_e2e",
      credentialRef,
      capabilities: ["publish-carousel"],
      connectedAt: "2026-08-17T03:00:00.000Z",
    }));
    const approval: ContentApproval = {
      id: "p",
      workspaceId,
      brandId,
      campaignId: "c",
      assetId: "a",
      versionId: "v",
      version: 1,
      reviewId: "q",
      approverAccountId: user.id,
      destination: { channel: "instagram", accountRef: "123456" },
      approvedAt: "2026-08-17T03:00:00.000Z",
    };
    const command = createPublishCommand({
      id: "cmd",
      approval,
      currentVersionId: "v",
      channelAccount: channel,
      contentType: "carousel",
      mediaItems: [
        { kind: "image", url: "https://cdn.example.com/slide-1.png" },
        { kind: "image", url: "https://cdn.example.com/slide-2.png" },
      ],
      scheduledFor: scheduledAt,
      createdAt: "2026-08-17T03:00:00.000Z",
    });
    await repo.saveCommand(user.id, command);

    const store = new PgPublishingExecutionStore(pool, { channels: ["instagram"] });
    const worker = new DeterministicPublishingWorker([
      new InstagramProfessionalAdapter(vault, "v24.0", fetchImpl),
    ]);
    const runner = new PublishingJobRunner(store, worker, "worker-vs63-e2e", 60, () => new Date(scheduledAt));
    return { runner, credentialRef };
  }
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}
