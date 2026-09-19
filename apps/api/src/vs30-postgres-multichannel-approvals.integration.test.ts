import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ContentApproval } from "@kairo/domain/review";
import { PgKairoRepository } from "./postgres-store";
import { PgReviewRepository } from "./review-postgres-store";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("PostgreSQL VS-30 multi-channel approvals", () => {
  const pool = new Pool({ connectionString: url });
  const core = new PgKairoRepository(pool);
  const reviews = new PgReviewRepository(pool);

  beforeAll(async () => {
    const migrations = [
      ["0001_identity_workspace_brand.sql", "accounts"],
      ["0002_brand_brain_knowledge.sql", "knowledge_sources"],
      ["0003_hunter_discover.sql", "public_signals"],
      ["0004_research_angles.sql", "ideas"],
      ["0005_campaign_content.sql", "campaigns"],
      ["0006_content_review_approval.sql", "content_reviews"],
    ] as const;
    for (const [filename, marker] of migrations) {
      const exists = await pool.query<{ name: string | null }>("select to_regclass($1)::text name", [`public.${marker}`]);
      if (!exists.rows[0]?.name) await pool.query(await readFile(new URL(`../migrations/${filename}`, import.meta.url), "utf8"));
    }
    const columns = await pool.query<{ name: string | null }>(
      `select column_name name from information_schema.columns where table_schema='public' and table_name='content_approvals' and column_name='destination_channel'`,
    );
    if (!columns.rows[0]?.name) await pool.query(await readFile(new URL("../migrations/0017_multichannel_approvals.sql", import.meta.url), "utf8"));
  });

  beforeEach(async () => {
    await pool.query(
      "truncate content_approvals,content_reviews,content_versions,content_assets,campaigns,angles,claim_evidence,claims,evidence_references,research_dossiers,ideas,brand_opportunity_signals,brand_opportunities,public_signals,knowledge_source_derivations,brand_brain_field_sources,brand_brain_fields,knowledge_sources,audit_events,brands,workspace_memberships,workspaces,external_identities,accounts cascade",
    );
  });

  afterAll(() => pool.end());

  it("stores independent destination approvals and keeps duplicate destination approval idempotent", async () => {
    const user = await core.resolveAccount({ provider: "test", subject: "alice" });
    const made = await core.createWorkspaceWithBrand(user.id, { workspaceName: "Studio", brandName: "Kairo" });
    const workspaceId = made.workspace.id;
    const brandId = made.brand.id;

    const fixtures = [
      `insert into ideas(id,workspace_id,brand_id,title,premise,source_type,status,created_at) values('idea',$1,$2,'Idea','Premise','user','research-ready',now())`,
      `insert into research_dossiers(id,workspace_id,brand_id,idea_id,summary,unresolved_uncertainties,status,created_at) values('research',$1,$2,'idea','Research','[]','ready',now())`,
      `insert into angles(id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,status,version) values('angle',$1,$2,'idea','Angle','Frame','Audience','Goal','Hook','Value','low','text','linkedin','[]','selected',1)`,
      `insert into campaigns(id,workspace_id,brand_id,idea_id,research_id,angle_id,name,objective,supporting_claim_ids,status,created_at) values('campaign',$1,$2,'idea','research','angle','Campaign','Goal','[]','draft',now())`,
      `insert into content_assets(id,workspace_id,brand_id,campaign_id,channel,format,audience,topic,hook_type,cta,supporting_claim_ids,current_version,status,created_at) values('asset',$1,$2,'campaign','linkedin','text','Audience','Topic','fact','Read','[]',1,'draft',now())`,
      `insert into content_versions(id,workspace_id,brand_id,campaign_id,asset_id,version,content,supporting_claim_ids,actor,action,created_at) values('version',$1,$2,'campaign','asset',1,'Hello','[]','user','manual-edit',now())`,
      `insert into content_reviews(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,status,truth,critic,revision_cycle,requested_at,completed_at) values('review',$1,$2,'campaign','asset','version',1,'passed','{}','{"passed":true,"score":95,"findings":[]}',0,now(),now())`,
    ];
    for (const sql of fixtures) await pool.query(sql, [workspaceId, brandId]);

    const base = {
      workspaceId,
      brandId,
      campaignId: "campaign",
      assetId: "asset",
      versionId: "version",
      version: 1,
      reviewId: "review",
      approverAccountId: user.id,
      approvedAt: "2026-08-17T09:00:00Z",
    };
    const instagram: ContentApproval = {
      id: "approval-instagram",
      ...base,
      destination: { channel: "instagram", accountRef: "178414000001" },
    };
    const linkedin: ContentApproval = {
      id: "approval-linkedin",
      ...base,
      destination: { channel: "linkedin", accountRef: "urn:li:organization:1" },
    };

    const savedInstagram = await reviews.saveApproval(user.id, instagram);
    const savedLinkedin = await reviews.saveApproval(user.id, linkedin);
    const duplicateInstagram = await reviews.saveApproval(user.id, { ...instagram, id: "approval-instagram-retry" });

    expect(savedInstagram.id).toBe("approval-instagram");
    expect(savedLinkedin.id).toBe("approval-linkedin");
    expect(duplicateInstagram.id).toBe("approval-instagram");
    expect(await reviews.listApprovals(user.id, brandId, "asset")).toHaveLength(2);
    expect(await reviews.getApprovalForDestination(user.id, brandId, "asset", instagram.destination)).toMatchObject({
      id: "approval-instagram",
      destination: instagram.destination,
    });
    expect(await reviews.getApprovalForDestination(user.id, brandId, "asset", linkedin.destination)).toMatchObject({
      id: "approval-linkedin",
      destination: linkedin.destination,
    });
  });

  it("keeps legacy JSON-only approval inserts compatible", async () => {
    const user = await core.resolveAccount({ provider: "test", subject: "legacy" });
    const made = await core.createWorkspaceWithBrand(user.id, { workspaceName: "Legacy", brandName: "Kairo" });
    const workspaceId = made.workspace.id;
    const brandId = made.brand.id;
    const fixtures = [
      `insert into ideas(id,workspace_id,brand_id,title,premise,source_type,status,created_at) values('idea2',$1,$2,'Idea','Premise','user','research-ready',now())`,
      `insert into research_dossiers(id,workspace_id,brand_id,idea_id,summary,unresolved_uncertainties,status,created_at) values('research2',$1,$2,'idea2','Research','[]','ready',now())`,
      `insert into angles(id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,status,version) values('angle2',$1,$2,'idea2','Angle','Frame','Audience','Goal','Hook','Value','low','text','linkedin','[]','selected',1)`,
      `insert into campaigns(id,workspace_id,brand_id,idea_id,research_id,angle_id,name,objective,supporting_claim_ids,status,created_at) values('campaign2',$1,$2,'idea2','research2','angle2','Campaign','Goal','[]','draft',now())`,
      `insert into content_assets(id,workspace_id,brand_id,campaign_id,channel,format,audience,topic,hook_type,cta,supporting_claim_ids,current_version,status,created_at) values('asset2',$1,$2,'campaign2','linkedin','text','Audience','Topic','fact','Read','[]',1,'draft',now())`,
      `insert into content_versions(id,workspace_id,brand_id,campaign_id,asset_id,version,content,supporting_claim_ids,actor,action,created_at) values('version2',$1,$2,'campaign2','asset2',1,'Hello','[]','user','manual-edit',now())`,
      `insert into content_reviews(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,status,truth,revision_cycle,requested_at,completed_at) values('review2',$1,$2,'campaign2','asset2','version2',1,'passed','{}',0,now(),now())`,
    ];
    for (const sql of fixtures) await pool.query(sql, [workspaceId, brandId]);
    await pool.query(
      `insert into content_approvals(id,workspace_id,brand_id,campaign_id,asset_id,version_id,version,review_id,approver_account_id,destination,approved_at)
       values('legacy-approval',$1,$2,'campaign2','asset2','version2',1,'review2',$3,'{"channel":"linkedin","accountRef":"legacy-page"}',now())`,
      [workspaceId, brandId, user.id],
    );
    const row = await pool.query(`select destination_channel,destination_account_ref from content_approvals where id='legacy-approval'`);
    expect(row.rows[0]).toEqual({ destination_channel: "linkedin", destination_account_ref: "legacy-page" });
  });
});
