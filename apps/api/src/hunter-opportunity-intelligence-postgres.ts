import type { Pool, PoolClient } from "pg";
import { ResourceNotFoundError } from "@kairo/domain";
import type { OpportunityIntelligence } from "@kairo/domain/opportunity-intelligence";
import type { HunterOpportunityIntelligenceWriter } from "@kairo/worker/hunter";

export class PgHunterOpportunityIntelligenceWriter implements HunterOpportunityIntelligenceWriter {
  constructor(private readonly pool: Pool) {}

  async save(accountId: string, value: OpportunityIntelligence): Promise<void> {
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, value.brandId);
      if (workspaceId !== value.workspaceId) throw new ResourceNotFoundError("Brand not found");
      const opportunity = await client.query<{ id: string }>(
        `select id from brand_opportunities where workspace_id=$1 and brand_id=$2 and id=$3`,
        [workspaceId, value.brandId, value.id],
      );
      if (!opportunity.rows[0]) throw new ResourceNotFoundError("Opportunity not found");

      await client.query(
        `insert into opportunity_intelligence_v2
          (workspace_id,brand_id,opportunity_id,schema_version,ranking_version,eei_version,payload,created_at,updated_at)
         values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now())
         on conflict(workspace_id,brand_id,opportunity_id) do update
         set schema_version=excluded.schema_version,
             ranking_version=excluded.ranking_version,
             eei_version=excluded.eei_version,
             payload=excluded.payload,
             updated_at=now()`,
        [
          workspaceId, value.brandId, value.id, value.schemaVersion,
          value.provenance.rankingVersion, value.provenance.eeiVersion,
          JSON.stringify(value), value.createdAt,
        ],
      );
    } finally {
      client.release();
    }
  }
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
