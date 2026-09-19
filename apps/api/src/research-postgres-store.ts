import type { Pool, PoolClient } from "pg";
import { ConcurrencyConflictError, ResourceNotFoundError } from "@kairo/domain";
import type { Angle, Idea, ResearchDossier } from "@kairo/domain/research";
import type { IdeaBundle, ResearchRepository } from "@kairo/domain/research-service";

export class PgResearchRepository implements ResearchRepository {
  constructor(private readonly pool: Pool) {}

  async createIdea(accountId: string, idea: Idea): Promise<Idea> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, idea.brandId);
      if (workspaceId !== idea.workspaceId) throw new ResourceNotFoundError("Brand not found");
      await client.query(
        `insert into ideas (id,workspace_id,brand_id,title,premise,source_type,opportunity_id,status,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [idea.id, idea.workspaceId, idea.brandId, idea.title, idea.premise, idea.source.type, idea.source.type === "opportunity" ? idea.source.opportunityId : null, idea.status, idea.createdAt],
      );
      await client.query("commit");
      return idea;
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async getIdea(accountId: string, brandId: string, ideaId: string): Promise<Idea | null> {
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const result = await client.query<IdeaRow>(
        `select id,workspace_id,brand_id,title,premise,source_type,opportunity_id,status,created_at
           from ideas where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId, brandId, ideaId],
      );
      return result.rows[0] ? toIdea(result.rows[0]) : null;
    } finally { client.release(); }
  }

  async listIdeas(accountId: string, brandId: string): Promise<Idea[]> {
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const result = await client.query<IdeaRow>(
        `select id,workspace_id,brand_id,title,premise,source_type,opportunity_id,status,created_at
           from ideas where workspace_id=$1 and brand_id=$2 order by created_at desc,id`, [workspaceId, brandId],
      );
      return result.rows.map(toIdea);
    } finally { client.release(); }
  }

  async getIdeaBundle(accountId: string, brandId: string, ideaId: string): Promise<IdeaBundle | null> {
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const ideaResult = await client.query<IdeaRow>(
        `select id,workspace_id,brand_id,title,premise,source_type,opportunity_id,status,created_at
           from ideas where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId, brandId, ideaId],
      );
      const row = ideaResult.rows[0];
      if (!row) return null;
      const dossierResult = await client.query<DossierRow>(
        `select id,workspace_id,brand_id,idea_id,summary,unresolved_uncertainties,runtime_provenance,status,created_at
           from research_dossiers where workspace_id=$1 and brand_id=$2 and idea_id=$3`, [workspaceId, brandId, ideaId],
      );
      const dossierRow = dossierResult.rows[0];
      let research: ResearchDossier | null = null;
      if (dossierRow) {
        const [evidenceResult, claimResult] = await Promise.all([
          client.query<EvidenceRow>(`select id,source_url,source_title,published_at,retrieved_at from evidence_references where research_id=$1 order by id`, [dossierRow.id]),
          client.query<ClaimRow>(
            `select c.id,c.text,c.classification,c.confidence,c.evidence_strength,c.verification_state,c.freshness,c.first_person_authorization,
                    coalesce(array_agg(ce.evidence_id order by ce.evidence_id) filter (where ce.evidence_id is not null),'{}'::text[]) evidence_ids
               from claims c left join claim_evidence ce on ce.research_id=c.research_id and ce.claim_id=c.id
              where c.research_id=$1 group by c.id order by c.id`, [dossierRow.id],
          ),
        ]);
        research = {
          id: dossierRow.id, workspaceId, brandId, ideaId, summary: dossierRow.summary,
          unresolvedUncertainties: dossierRow.unresolved_uncertainties, status: "ready", createdAt: iso(dossierRow.created_at),
          ...(dossierRow.runtime_provenance ? { runtimeProvenance: dossierRow.runtime_provenance } : {}),
          evidence: evidenceResult.rows.map((item) => ({ id: item.id, sourceUrl: item.source_url, sourceTitle: item.source_title, ...(item.published_at ? { publishedAt: iso(item.published_at) } : {}), retrievedAt: iso(item.retrieved_at) })),
          claims: claimResult.rows.map((item) => ({ id: item.id, text: item.text, classification: item.classification, confidence: Number(item.confidence), evidenceStrength: item.evidence_strength, verificationState: item.verification_state, freshness: item.freshness, evidenceIds: item.evidence_ids, firstPersonAuthorization: item.first_person_authorization })),
        };
      }
      const angles = await client.query<AngleRow>(angleSelect, [workspaceId, brandId, ideaId]);
      return { idea: toIdea(row), research, angles: angles.rows.map(toAngle) };
    } finally { client.release(); }
  }

  async saveResearchDossier(accountId: string, dossier: ResearchDossier): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, dossier.brandId);
      if (workspaceId !== dossier.workspaceId) throw new ResourceNotFoundError("Brand not found");
      const idea = await client.query(`select id from ideas where workspace_id=$1 and brand_id=$2 and id=$3 for update`, [workspaceId, dossier.brandId, dossier.ideaId]);
      if (!idea.rows[0]) throw new ResourceNotFoundError("Idea not found");
      const existing = await client.query<{ id: string }>(
        `select id from research_dossiers where workspace_id=$1 and brand_id=$2 and idea_id=$3`,
        [workspaceId, dossier.brandId, dossier.ideaId],
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return;
      }
      await client.query(
        `insert into research_dossiers (id,workspace_id,brand_id,idea_id,summary,unresolved_uncertainties,runtime_provenance,status,created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
        [dossier.id, workspaceId, dossier.brandId, dossier.ideaId, dossier.summary, JSON.stringify(dossier.unresolvedUncertainties), dossier.runtimeProvenance ? JSON.stringify(dossier.runtimeProvenance) : null, dossier.status, dossier.createdAt],
      );
      for (const evidence of dossier.evidence) {
        await client.query(
          `insert into evidence_references (id,workspace_id,brand_id,research_id,source_url,source_title,published_at,retrieved_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [evidence.id, workspaceId, dossier.brandId, dossier.id, evidence.sourceUrl, evidence.sourceTitle, evidence.publishedAt ?? null, evidence.retrievedAt],
        );
      }
      for (const claim of dossier.claims) {
        await client.query(
          `insert into claims (id,workspace_id,brand_id,research_id,text,classification,confidence,evidence_strength,verification_state,freshness,first_person_authorization)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [claim.id, workspaceId, dossier.brandId, dossier.id, claim.text, claim.classification, claim.confidence, claim.evidenceStrength, claim.verificationState, claim.freshness, claim.firstPersonAuthorization],
        );
        for (const evidenceId of claim.evidenceIds) {
          await client.query(`insert into claim_evidence (research_id,claim_id,evidence_id) values ($1,$2,$3)`, [dossier.id, claim.id, evidenceId]);
        }
      }
      await client.query(`update ideas set status='research-ready',updated_at=now() where id=$1`, [dossier.ideaId]);
      await client.query("commit");
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async saveCandidateAngles(accountId: string, angles: readonly Angle[]): Promise<void> {
    if (!angles.length) return;
    const first = angles[0]!;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, first.brandId);
      if (workspaceId !== first.workspaceId || angles.some((angle) => angle.workspaceId !== workspaceId || angle.brandId !== first.brandId || angle.ideaId !== first.ideaId)) {
        throw new ResourceNotFoundError("Idea not found");
      }
      const idea = await client.query(`select id from ideas where workspace_id=$1 and brand_id=$2 and id=$3 for update`, [workspaceId, first.brandId, first.ideaId]);
      if (!idea.rows[0]) throw new ResourceNotFoundError("Idea not found");
      const existingAngles = await client.query<{ count: number }>(
        `select count(*)::int as count from angles where workspace_id=$1 and brand_id=$2 and idea_id=$3`,
        [workspaceId, first.brandId, first.ideaId],
      );
      if (Number(existingAngles.rows[0]?.count ?? 0) >= 2) {
        await client.query("commit");
        return;
      }
      const claimIds = [...new Set(angles.flatMap((angle) => angle.supportingClaimIds))];
      const claims = await client.query<{ id: string }>(
        `select c.id from claims c join research_dossiers r on r.id=c.research_id
          where r.workspace_id=$1 and r.brand_id=$2 and r.idea_id=$3 and c.id=any($4::text[])`,
        [workspaceId, first.brandId, first.ideaId, claimIds],
      );
      if (claims.rows.length !== claimIds.length) throw new ResourceNotFoundError("Supporting Claim not found");
      for (const angle of angles) {
        await client.query(
          `insert into angles (id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,runtime_provenance,status,version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17)`,
          [angle.id, workspaceId, angle.brandId, angle.ideaId, angle.title, angle.framing, angle.audience, angle.objective, angle.hookDirection, angle.expectedValue, angle.effort, angle.recommendedFormat, angle.recommendedChannel, JSON.stringify(angle.supportingClaimIds), angle.runtimeProvenance ? JSON.stringify(angle.runtimeProvenance) : null, angle.status, angle.version],
        );
      }
      await client.query(`update ideas set status='angles-ready',updated_at=now() where id=$1`, [first.ideaId]);
      await client.query("commit");
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async selectAngle(accountId: string, brandId: string, ideaId: string, angleId: string, expectedVersion: number): Promise<Angle[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const target = await client.query<{ version: number }>(
        `select version from angles where workspace_id=$1 and brand_id=$2 and idea_id=$3 and id=$4 for update`,
        [workspaceId, brandId, ideaId, angleId],
      );
      if (!target.rows[0]) throw new ResourceNotFoundError("Angle not found");
      if (target.rows[0].version !== expectedVersion) throw new ConcurrencyConflictError("Angle version is stale");
      await client.query(
        `update angles set status='candidate',version=version+1,updated_at=now()
          where workspace_id=$1 and brand_id=$2 and idea_id=$3 and id<>$4`,
        [workspaceId, brandId, ideaId, angleId],
      );
      await client.query(
        `update angles set status='selected',version=version+1,updated_at=now()
          where workspace_id=$1 and brand_id=$2 and idea_id=$3 and id=$4`,
        [workspaceId, brandId, ideaId, angleId],
      );
      const result = await client.query<AngleRow>(angleSelect, [workspaceId, brandId, ideaId]);
      await client.query("commit");
      return result.rows.map(toAngle);
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async editAngleFraming(accountId: string, brandId: string, ideaId: string, angleId: string, framing: string, expectedVersion: number): Promise<Angle> {
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const result = await client.query<AngleRow>(
        `update angles set framing=$5,version=version+1,updated_at=now()
          where workspace_id=$1 and brand_id=$2 and idea_id=$3 and id=$4 and version=$6
          returning id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,runtime_provenance,status,version`,
        [workspaceId, brandId, ideaId, angleId, framing, expectedVersion],
      );
      if (result.rows[0]) return toAngle(result.rows[0]);
      const target = await client.query(`select 1 from angles where workspace_id=$1 and brand_id=$2 and idea_id=$3 and id=$4`, [workspaceId, brandId, ideaId, angleId]);
      if (!target.rows[0]) throw new ResourceNotFoundError("Angle not found");
      throw new ConcurrencyConflictError("Angle version is stale");
    } finally { client.release(); }
  }
}

type IdeaRow = { id: string; workspace_id: string; brand_id: string; title: string; premise: string; source_type: "opportunity" | "user"; opportunity_id: string | null; status: Idea["status"]; created_at: Date | string };
type AngleRow = { id: string; workspace_id: string; brand_id: string; idea_id: string; title: string; framing: string; audience: string; objective: string; hook_direction: string; expected_value: string; effort: Angle["effort"]; recommended_format: string; recommended_channel: string; supporting_claim_ids: string[]; runtime_provenance: Angle["runtimeProvenance"] | null; status: Angle["status"]; version: number };
type DossierRow = { id: string; workspace_id: string; brand_id: string; idea_id: string; summary: string; unresolved_uncertainties: string[]; runtime_provenance: ResearchDossier["runtimeProvenance"] | null; status: "ready"; created_at: Date | string };
type EvidenceRow = { id: string; source_url: string; source_title: string; published_at: Date | string | null; retrieved_at: Date | string };
type ClaimRow = { id: string; text: string; classification: ResearchDossier["claims"][number]["classification"]; confidence: number; evidence_strength: ResearchDossier["claims"][number]["evidenceStrength"]; verification_state: ResearchDossier["claims"][number]["verificationState"]; freshness: ResearchDossier["claims"][number]["freshness"]; first_person_authorization: ResearchDossier["claims"][number]["firstPersonAuthorization"]; evidence_ids: string[] };

const angleSelect = `select id,workspace_id,brand_id,idea_id,title,framing,audience,objective,hook_direction,expected_value,effort,recommended_format,recommended_channel,supporting_claim_ids,runtime_provenance,status,version from angles where workspace_id=$1 and brand_id=$2 and idea_id=$3 order by id`;

function toIdea(row: IdeaRow): Idea { return { id: row.id, workspaceId: row.workspace_id, brandId: row.brand_id, title: row.title, premise: row.premise, source: row.source_type === "opportunity" ? { type: "opportunity", opportunityId: row.opportunity_id! } : { type: "user" }, status: row.status, createdAt: iso(row.created_at) }; }
function toAngle(row: AngleRow): Angle { return { id: row.id, workspaceId: row.workspace_id, brandId: row.brand_id, ideaId: row.idea_id, title: row.title, framing: row.framing, audience: row.audience, objective: row.objective, hookDirection: row.hook_direction, expectedValue: row.expected_value, effort: row.effort, recommendedFormat: row.recommended_format, recommendedChannel: row.recommended_channel, supportingClaimIds: row.supporting_claim_ids, status: row.status, version: row.version, ...(row.runtime_provenance ? { runtimeProvenance: row.runtime_provenance } : {}) }; }
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

async function requireBrandWorkspace(client: PoolClient, accountId: string, brandId: string): Promise<string> {
  const result = await client.query<{ workspace_id: string }>(`select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id where m.account_id=$1 and m.active=true and b.id=$2`, [accountId, brandId]);
  const workspaceId = result.rows[0]?.workspace_id;
  if (!workspaceId) throw new ResourceNotFoundError("Brand not found");
  return workspaceId;
}

async function safeRollback(client: PoolClient): Promise<void> { try { await client.query("rollback"); } catch { /* preserve original error */ } }
