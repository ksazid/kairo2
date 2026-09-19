import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { ConceptMockupDto } from "@kairo/contracts/concept-mockup";
import { ResourceNotFoundError } from "@kairo/domain";

export type RecommendationFeedbackAction = "seen" | "dismissed";

export interface OpportunityDevelopmentResult {
  ideaId: string;
  opportunityId: string;
  status: "developing";
  reused: boolean;
}

export interface RecommendationFeedbackResult {
  opportunityId: string;
  action: RecommendationFeedbackAction;
  status: "new" | "saved" | "ignored" | "developing";
}

export interface HunterClosedLoopStore {
  learningContext(accountId: string, brandId: string): Promise<string | undefined>;
  recordFeedback(accountId: string, brandId: string, opportunityId: string, action: RecommendationFeedbackAction): Promise<RecommendationFeedbackResult>;
  developOpportunity(accountId: string, brandId: string, opportunityId: string): Promise<OpportunityDevelopmentResult>;
}

let environmentStore: PgHunterClosedLoopStore | undefined;
let environmentPool: Pool | undefined;
let shutdownRegistered = false;

export function hunterClosedLoopStoreFromEnvironment(): HunterClosedLoopStore | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  if (!environmentStore) {
    environmentPool = new Pool({ connectionString });
    environmentStore = new PgHunterClosedLoopStore(environmentPool);
  }
  if (!shutdownRegistered) {
    shutdownRegistered = true;
    const close = () => { if (environmentPool) void environmentPool.end().catch(() => undefined); };
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
  }
  return environmentStore;
}

export class PgHunterClosedLoopStore implements HunterClosedLoopStore {
  constructor(private readonly pool: Pool) {}

  async learningContext(accountId: string, brandId: string): Promise<string | undefined> {
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const [learning, choices, feedback] = await Promise.all([
        client.query<{ statement: string; interpretation: string }>(
          `select statement,interpretation from brand_learnings
            where workspace_id=$1 and brand_id=$2 and status='accepted'
            order by confidence desc,created_at desc,id limit 5`,
          [workspaceId, brandId],
        ),
        client.query<{ title: string; status: string }>(
          `select title,status from brand_opportunities
            where workspace_id=$1 and brand_id=$2 and status in ('saved','ignored','developing')
            order by updated_at desc,id limit 8`,
          [workspaceId, brandId],
        ),
        client.query<{ title: string; action: RecommendationFeedbackAction }>(
          `select o.title,f.action from opportunity_feedback_events f
             join brand_opportunities o on o.workspace_id=f.workspace_id and o.brand_id=f.brand_id and o.id=f.opportunity_id
            where f.workspace_id=$1 and f.brand_id=$2
            order by f.created_at desc,f.id limit 8`,
          [workspaceId, brandId],
        ).catch(() => ({ rows: [] as Array<{ title: string; action: RecommendationFeedbackAction }> })),
      ]);
      const parts: string[] = [];
      if (learning.rows.length) {
        parts.push(`Accepted performance learning: ${learning.rows.map((item) => `${item.statement} — ${item.interpretation}`).join(" | ")}`);
      }
      if (choices.rows.length) {
        parts.push(`Past opportunity choices: ${choices.rows.map((item) => `${item.status}: ${item.title}`).join(" | ")}`);
      }
      if (feedback.rows.length) {
        parts.push(`Recommendation feedback: ${feedback.rows.map((item) => `${item.action}: ${item.title}`).join(" | ")}`);
      }
      return parts.length ? parts.join("\n").slice(0, 4_000) : undefined;
    } finally {
      client.release();
    }
  }

  async recordFeedback(
    accountId: string,
    brandId: string,
    opportunityId: string,
    action: RecommendationFeedbackAction,
  ): Promise<RecommendationFeedbackResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const current = await client.query<{ status: RecommendationFeedbackResult["status"] }>(
        `select status from brand_opportunities where workspace_id=$1 and brand_id=$2 and id=$3 for update`,
        [workspaceId, brandId, opportunityId],
      );
      const row = current.rows[0];
      if (!row) throw new ResourceNotFoundError("Opportunity not found");
      const inserted = await client.query(
        `insert into opportunity_feedback_events(id,workspace_id,brand_id,opportunity_id,account_id,action)
         values($1,$2,$3,$4,$5,$6)
         on conflict(workspace_id,brand_id,opportunity_id,account_id,action) do nothing`,
        [randomUUID(), workspaceId, brandId, opportunityId, accountId, action],
      );
      const status = action === "dismissed" ? "ignored" : row.status;
      if (status !== row.status) {
        await client.query(`update brand_opportunities set status=$1,updated_at=now() where workspace_id=$2 and brand_id=$3 and id=$4`, [status, workspaceId, brandId, opportunityId]);
      }
      if (inserted.rowCount) await audit(client, workspaceId, accountId, `opportunity.feedback.${action}`, opportunityId);
      await client.query("commit");
      return { opportunityId, action, status };
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async developOpportunity(accountId: string, brandId: string, opportunityId: string): Promise<OpportunityDevelopmentResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const opportunity = await client.query<{
        title: string;
        rationale: string;
        why_now: string;
        development_direction: string;
        concept_mockup: ConceptMockupDto | null;
      }>(
        `select title,rationale,why_now,development_direction,concept_mockup from brand_opportunities
          where workspace_id=$1 and brand_id=$2 and id=$3 for update`,
        [workspaceId, brandId, opportunityId],
      );
      const source = opportunity.rows[0];
      if (!source) throw new ResourceNotFoundError("Opportunity not found");
      const existing = await client.query<{ id: string }>(
        `select id from ideas where workspace_id=$1 and brand_id=$2 and source_type='opportunity' and opportunity_id=$3 order by created_at,id limit 1`,
        [workspaceId, brandId, opportunityId],
      );
      const existingId = existing.rows[0]?.id;
      if (existingId) {
        await client.query(`update brand_opportunities set status='developing',updated_at=now() where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId, brandId, opportunityId]);
        await client.query("commit");
        return { ideaId: existingId, opportunityId, status: "developing", reused: true };
      }
      const ideaId = randomUUID();
      const basePremise = `${source.development_direction}\n\nWhy now: ${source.why_now}\n\nContext: ${source.rationale}`;
      const conceptBrief = conceptMockupBrief(source.concept_mockup);
      const premise = [basePremise, conceptBrief ? `Concept brief:\n${conceptBrief}` : ""].filter(Boolean).join("\n\n").slice(0, 2_000);
      await client.query(
        `insert into ideas(id,workspace_id,brand_id,title,premise,source_type,opportunity_id,status,created_at)
         values($1,$2,$3,$4,$5,'opportunity',$6,'new',now())`,
        [ideaId, workspaceId, brandId, source.title, premise, opportunityId],
      );
      await client.query(`update brand_opportunities set status='developing',updated_at=now() where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId, brandId, opportunityId]);
      await audit(client, workspaceId, accountId, "opportunity.development.idea-created", opportunityId);
      await client.query("commit");
      return { ideaId, opportunityId, status: "developing", reused: false };
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function conceptMockupBrief(mockup: ConceptMockupDto | null | undefined): string | undefined {
  if (!mockup) return undefined;
  const lines = [
    `Format: ${mockup.format}`,
    `Hook: ${mockup.hook}`,
    mockup.copyPreview ? `Copy direction: ${mockup.copyPreview}` : "",
    mockup.visualDirection ? `Visual direction: ${mockup.visualDirection}` : "",
    mockup.cta ? `CTA: ${mockup.cta}` : "",
  ];
  if (mockup.format === "text" && mockup.text) {
    lines.push(...mockup.text.keyPoints.slice(0, 3).map((point) => `Key point: ${point}`));
  } else if (mockup.format === "image" && mockup.image) {
    lines.push(`Visual subject: ${mockup.image.visualSubject}`);
    if (mockup.image.overlayText) lines.push(`Overlay: ${mockup.image.overlayText}`);
  } else if (mockup.format === "carousel" && mockup.carousel) {
    lines.push(`Cover: ${mockup.carousel.cover.headline}`);
    lines.push(...mockup.carousel.slides.slice(0, 3).map((slide) => `Slide: ${slide.headline}${slide.body ? ` — ${slide.body}` : ""}`));
  } else if (mockup.format === "reel" && mockup.reel) {
    lines.push(`Opening frame: ${mockup.reel.openingFrame}`);
    lines.push(...mockup.reel.scenes.slice(0, 4).map((scene) => `${scene.startSeconds}-${scene.endSeconds}s: ${scene.beat}${scene.onScreenText ? ` — ${scene.onScreenText}` : ""}`));
  }
  return lines.filter(Boolean).join("\n").slice(0, 900);
}

async function audit(client: PoolClient, workspaceId: string, accountId: string, eventType: string, subjectId: string): Promise<void> {
  await client.query(
    `insert into audit_events(id,workspace_id,account_id,event_type,subject_id) values($1,$2,$3,$4,$5)`,
    [randomUUID(), workspaceId, accountId, eventType, subjectId],
  );
}

async function requireBrandWorkspace(client: PoolClient, accountId: string, brandId: string): Promise<string> {
  const result = await client.query<{ workspace_id: string }>(
    `select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id
      where m.account_id=$1 and m.active=true and b.id=$2`,
    [accountId, brandId],
  );
  const workspaceId = result.rows[0]?.workspace_id;
  if (!workspaceId) throw new ResourceNotFoundError("Brand not found");
  return workspaceId;
}

async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query("rollback"); } catch { /* keep original error */ }
}
