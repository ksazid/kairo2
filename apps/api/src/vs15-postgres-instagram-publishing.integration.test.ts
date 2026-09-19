import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectChannelAccount, createPublishCommand } from "@kairo/domain/publishing";
import type { ContentApproval } from "@kairo/domain/review";
import { PgKairoRepository } from "./postgres-store";
import { PgPublishingRepository } from "./publishing-postgres-store";
import { PgPublishingExecutionStore } from "./publishing-execution-postgres-store";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("PostgreSQL VS-15 Instagram rich publishing", () => {
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
    const columns = await pool.query("select 1 from information_schema.columns where table_name='publish_commands' and column_name='media_items'");
    if (!columns.rows[0]) await pool.query(await readFile(new URL("../migrations/0014_instagram_rich_publishing.sql", import.meta.url), "utf8"));
  });

  beforeEach(async () => {
    await pool.query("truncate published_posts,publish_attempts,publish_commands,channel_accounts,content_approvals,content_reviews,content_versions,content_assets,campaigns,angles,claim_evidence,claims,evidence_references,research_dossiers,ideas,brand_opportunity_signals,brand_opportunities,public_signals,knowledge_source_derivations,brand_brain_field_sources,brand_brain_fields,knowledge_sources,audit_events,brands,workspace_memberships,workspaces,external_identities,accounts cascade");
  });
  afterAll(() => pool.end());

  it("round-trips Reel media/options and hydrates them into the authoritative worker job", async () => {
    const user = await core.resolveAccount({ provider: "test", subject: "vs15-user" });
    const made = await core.createWorkspaceWithBrand(user.id, { workspaceName: "Studio", brandName: "Kairo" });
    const w = made.workspace.id, b = made.brand.id;

    const fixtures = [
      `insert into ideas(id,workspace_id,brand_id,title,premise,source_type,status,created_at) values('i',$1,$2,'Idea','Premise','user','research-ready',now())`,
      `insert into research_dossiers(id,workspace_id,brand_id,idea_id,summary,unresolved_uncertainties,status,created_at) values('r',$1,$2,'i','Research','[]','ready',now())`,
      `insert into angles(id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,status,version) values('g',$1,$2,'i','Angle','Frame','Audience','Goal','Hook','Value','low','reel','instagram','[]','selected',1)`,
      `insert into campaigns(id,workspace_id,brand_id,idea_id,research_id,angle_id,name,objective,supporting_claim_ids,status,created_at) values('c',$1,$2,'i','r','g','Campaign','Goal','[]','draft',now())`,
      `insert into content_assets(id,workspace_id,brand_id,campaign_id,channel,format,audience,topic,hook_type,cta,supporting_claim_ids,current_version,status,created_at) values('a',$1,$2,'c','instagram','reel','Audience','Topic','fact','Read','[]',1,'draft',now())`,
      `insert into content_versions(id,workspace_id,brand_id,campaign_id,asset_id,version,content,supporting_claim_ids,actor,action,created_at) values('v',$1,$2,'c','a',1,'Reel caption','[]','user','manual-edit',now())`,
      `insert into content_reviews(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,status,truth,revision_cycle,requested_at,completed_at) values('q',$1,$2,'c','a','v',1,'passed','{}',0,now(),now())`,
    ];
    for (const sql of fixtures) await pool.query(sql, [w, b]);
    await pool.query(`insert into content_approvals(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,review_id,approver_account_id,destination,approved_at) values('p',$1,$2,'c','a','v',1,'q',$3,'{"channel":"instagram","accountRef":"123"}',now())`, [w, b, user.id]);

    const channel = await repo.saveChannelAccount(user.id, connectChannelAccount({
      id: "ca", workspaceId: w, brandId: b, channel: "instagram", accountRef: "123", displayName: "Kairo IG",
      credentialRef: "vault://ig", capabilities: ["publish-reel"], connectedAt: "2026-08-15T02:00:00Z",
    }));
    const approval: ContentApproval = { id: "p", workspaceId: w, brandId: b, campaignId: "c", assetId: "a", versionId: "v", version: 1, reviewId: "q", approverAccountId: user.id, destination: { channel: "instagram", accountRef: "123" }, approvedAt: "2026-08-15T02:00:00Z" };
    const command = createPublishCommand({
      id: "cmd", approval, currentVersionId: "v", channelAccount: channel, contentType: "reel",
      mediaItems: [{ kind: "video", url: "https://cdn.example.com/reel.mp4" }],
      options: { instagram: { shareToFeed: true } },
      scheduledFor: "2026-08-15T03:00:00Z", createdAt: "2026-08-15T02:00:00Z",
    });

    await repo.saveCommand(user.id, command);
    expect(await repo.getCommand(user.id, b, "cmd")).toMatchObject({
      contentType: "reel",
      mediaItems: [{ kind: "video", url: "https://cdn.example.com/reel.mp4" }],
      options: { instagram: { shareToFeed: true } },
    });

    const job = await new PgPublishingExecutionStore(pool).claimNext("2026-08-15T03:00:00Z", "worker-vs15", 60);
    expect(job).toMatchObject({
      commandId: "cmd",
      content: "Reel caption",
      credentialRef: "vault://ig",
      contentType: "reel",
      mediaItems: [{ kind: "video", url: "https://cdn.example.com/reel.mp4" }],
      options: { instagram: { shareToFeed: true } },
    });
    expect(JSON.stringify(job)).not.toContain("secret-token");
  });
});
