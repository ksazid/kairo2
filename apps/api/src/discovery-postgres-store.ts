import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OpportunityStatus, PublicSignalDto } from "@kairo/contracts";
import type { BrandOpportunityWithConceptDto, ConceptMockupDto } from "@kairo/contracts/concept-mockup";
import { ResourceNotFoundError } from "@kairo/domain";
import type { PreparedPublicSignal } from "@kairo/domain/discovery";
import type { CreateBrandOpportunityInput, DiscoveryRepository } from "@kairo/domain/discovery-service";

export class PgDiscoveryRepository implements DiscoveryRepository {
  constructor(private readonly pool: Pool) {}

  async upsertPublicSignal(input: PreparedPublicSignal): Promise<PublicSignalDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const lockKeys = [`duplicate:${input.duplicateKey}`, ...(input.contentHash ? [`hash:${input.contentHash}`] : [])].sort();
      for (const key of lockKeys) await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);

      const existing = await client.query<SignalRow>(
        `select id,title,summary,source_url,duplicate_key,platform,publisher,author,published_at,retrieved_at,provider,provider_version,content_hash,created_at,updated_at
           from public_signals
          where duplicate_key=$1 or ($2::text is not null and content_hash=$2)
          order by created_at,id limit 1`,
        [input.duplicateKey, input.contentHash ?? null],
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return toSignal(existing.rows[0]);
      }

      const id = randomUUID();
      const inserted = await client.query<SignalRow>(
        `insert into public_signals
           (id,title,summary,source_url,duplicate_key,platform,publisher,author,published_at,retrieved_at,provider,provider_version,content_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning id,title,summary,source_url,duplicate_key,platform,publisher,author,published_at,retrieved_at,provider,provider_version,content_hash,created_at,updated_at`,
        [
          id, input.title, input.summary ?? null, input.sourceUrl, input.duplicateKey, input.platform,
          input.publisher ?? null, input.author ?? null, input.publishedAt ?? null, input.retrievedAt,
          input.provider, input.providerVersion ?? null, input.contentHash ?? null,
        ],
      );
      await client.query("commit");
      const row = inserted.rows[0];
      if (!row) throw new Error("Public Signal was not persisted");
      return toSignal(row);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listBrandOpportunities(accountId: string, brandId: string): Promise<BrandOpportunityWithConceptDto[]> {
    const brand = await this.pool.query<{ workspace_id: string }>(
      `select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id
        where m.account_id=$1 and m.active=true and b.id=$2`,
      [accountId, brandId],
    );
    if (!brand.rows[0]) throw new ResourceNotFoundError("Brand not found");
    const result = await this.pool.query<OpportunityRow>(opportunitySelect(
      `join workspace_memberships m on m.workspace_id=o.workspace_id
       where m.account_id=$1 and m.active=true and o.workspace_id=$2 and o.brand_id=$3
       group by o.id
       order by o.overall desc,o.created_at desc,o.id`,
    ), [accountId, brand.rows[0].workspace_id, brandId]);
    return result.rows.map(toOpportunity);
  }

  async getBrandOpportunity(accountId: string, brandId: string, opportunityId: string): Promise<BrandOpportunityWithConceptDto | null> {
    const result = await this.pool.query<OpportunityRow>(opportunitySelect(
      `join workspace_memberships m on m.workspace_id=o.workspace_id
       where m.account_id=$1 and m.active=true and o.brand_id=$2 and o.id=$3
       group by o.id`,
    ), [accountId, brandId, opportunityId]);
    return result.rows[0] ? toOpportunity(result.rows[0]) : null;
  }

  async createBrandOpportunity(accountId: string, brandId: string, input: CreateBrandOpportunityInput): Promise<BrandOpportunityWithConceptDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const signalIds = [...new Set(input.signalIds)];
      const signals = await client.query<{ id: string }>(`select id from public_signals where id=any($1::text[])`, [signalIds]);
      if (!signalIds.length || signals.rows.length !== signalIds.length) throw new ResourceNotFoundError("Signal not found");

      const id = randomUUID();
      await client.query(
        `insert into brand_opportunities
          (id,workspace_id,brand_id,title,rationale,why_now,development_direction,status,relevance,evidence,novelty,timeliness,brand_authority,audience_fit,overall,scoring_version,brand_context_version,brand_intelligence_graph_version,opportunity_details,concept_mockup,concept_mockup_version,concept_mockup_generated_at)
         values ($1,$2,$3,$4,$5,$6,$7,'new',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21)`,
        [
          id, workspaceId, brandId, input.title, input.rationale, input.whyNow, input.developmentDirection,
          input.scores.relevance, input.scores.evidence, input.scores.novelty, input.scores.timeliness,
          input.scores.brandAuthority, input.scores.audienceFit, input.scores.overall,
          input.scores.scoringVersion, input.brandContextVersion, input.details?.intelligenceVersion ?? null,
          input.details ? JSON.stringify(input.details) : null,
          input.conceptMockup ? JSON.stringify(input.conceptMockup) : null,
          input.conceptMockup?.version ?? null,
          input.conceptMockupGeneratedAt ?? null,
        ],
      );
      await client.query(
        `insert into brand_opportunity_signals (workspace_id,brand_id,opportunity_id,signal_id)
         select $1,$2,$3,u.signal_id from unnest($4::text[]) as u(signal_id)`,
        [workspaceId, brandId, id, signalIds],
      );
      await audit(client, workspaceId, accountId, "opportunity.created", id);
      const opportunity = await fetchOpportunity(client, accountId, brandId, id);
      await client.query("commit");
      if (!opportunity) throw new Error("Opportunity was not persisted");
      return opportunity;
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async setBrandOpportunityStatus(
    accountId: string,
    brandId: string,
    opportunityId: string,
    status: OpportunityStatus,
  ): Promise<BrandOpportunityWithConceptDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const current = await client.query<{ status: OpportunityStatus }>(
        `select status from brand_opportunities where workspace_id=$1 and brand_id=$2 and id=$3 for update`,
        [workspaceId, brandId, opportunityId],
      );
      if (!current.rows[0]) throw new ResourceNotFoundError("Opportunity not found");
      if (current.rows[0].status !== status) {
        await client.query(`update brand_opportunities set status=$1,updated_at=now() where id=$2`, [status, opportunityId]);
        await audit(client, workspaceId, accountId, `opportunity.${status}`, opportunityId);
      }
      const opportunity = await fetchOpportunity(client, accountId, brandId, opportunityId);
      await client.query("commit");
      if (!opportunity) throw new Error("Opportunity disappeared after status change");
      return opportunity;
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

type SignalRow = {
  id: string; title: string; summary: string | null; source_url: string; duplicate_key: string; platform: string;
  publisher: string | null; author: string | null; published_at: Date | string | null; retrieved_at: Date | string;
  provider: string; provider_version: string | null; content_hash: string | null; created_at: Date | string; updated_at: Date | string;
};

type OpportunityRow = {
  id: string; workspace_id: string; brand_id: string; title: string; rationale: string; why_now: string;
  development_direction: string; status: OpportunityStatus; relevance: number; evidence: number; novelty: number;
  timeliness: number; brand_authority: number; audience_fit: number; overall: number; scoring_version: string;
  brand_context_version: string; created_at: Date | string; updated_at: Date | string; signal_ids: string[];
  opportunity_details: import("@kairo/contracts").OpportunityDetailsDto | null;
  concept_mockup: ConceptMockupDto | null;
  concept_mockup_version: number | null;
  concept_mockup_generated_at: Date | string | null;
};

function opportunitySelect(tail: string): string {
  return `select o.id,o.workspace_id,o.brand_id,o.title,o.rationale,o.why_now,o.development_direction,o.status,
                 o.relevance,o.evidence,o.novelty,o.timeliness,o.brand_authority,o.audience_fit,o.overall,
                 o.scoring_version,o.brand_context_version,o.opportunity_details,o.concept_mockup,o.concept_mockup_version,
                 o.concept_mockup_generated_at,o.created_at,o.updated_at,
                 coalesce(array_agg(os.signal_id order by os.signal_id) filter (where os.signal_id is not null),'{}'::text[]) as signal_ids
            from brand_opportunities o
            left join brand_opportunity_signals os on os.opportunity_id=o.id and os.workspace_id=o.workspace_id and os.brand_id=o.brand_id
            ${tail}`;
}

async function fetchOpportunity(
  client: PoolClient,
  accountId: string,
  brandId: string,
  opportunityId: string,
): Promise<BrandOpportunityWithConceptDto | null> {
  const result = await client.query<OpportunityRow>(opportunitySelect(
    `join workspace_memberships m on m.workspace_id=o.workspace_id
     where m.account_id=$1 and m.active=true and o.brand_id=$2 and o.id=$3
     group by o.id`,
  ), [accountId, brandId, opportunityId]);
  return result.rows[0] ? toOpportunity(result.rows[0]) : null;
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

async function audit(client: PoolClient, workspaceId: string, accountId: string, eventType: string, subjectId: string): Promise<void> {
  await client.query(
    `insert into audit_events (id,workspace_id,account_id,event_type,subject_id) values ($1,$2,$3,$4,$5)`,
    [randomUUID(), workspaceId, accountId, eventType, subjectId],
  );
}

function toSignal(row: SignalRow): PublicSignalDto {
  return {
    id: row.id,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    sourceUrl: row.source_url,
    duplicateKey: row.duplicate_key,
    platform: row.platform,
    ...(row.publisher ? { publisher: row.publisher } : {}),
    ...(row.author ? { author: row.author } : {}),
    ...(row.published_at ? { publishedAt: iso(row.published_at) } : {}),
    retrievedAt: iso(row.retrieved_at),
    provider: row.provider,
    ...(row.provider_version ? { providerVersion: row.provider_version } : {}),
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toOpportunity(row: OpportunityRow): BrandOpportunityWithConceptDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
    title: row.title,
    rationale: row.rationale,
    whyNow: row.why_now,
    developmentDirection: row.development_direction,
    status: row.status,
    signalIds: row.signal_ids ?? [],
    scores: {
      relevance: Number(row.relevance), evidence: Number(row.evidence), novelty: Number(row.novelty), timeliness: Number(row.timeliness),
      brandAuthority: Number(row.brand_authority), audienceFit: Number(row.audience_fit), overall: Number(row.overall), scoringVersion: row.scoring_version,
    },
    brandContextVersion: row.brand_context_version,
    ...(row.opportunity_details ? { details: row.opportunity_details } : {}),
    ...(row.concept_mockup ? { conceptMockup: row.concept_mockup } : {}),
    ...(row.concept_mockup_generated_at ? { conceptMockupGeneratedAt: iso(row.concept_mockup_generated_at) } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query("rollback"); } catch { /* preserve original error */ }
}
