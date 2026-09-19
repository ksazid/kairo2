import type { Pool } from "pg";
import type { CommandSearchResultDto, CommandSearchResultKind } from "@kairo/contracts";
import type { CommandSearchQuery, CommandSearchRepository } from "./command-search";

export class PgCommandSearchRepository implements CommandSearchRepository {
  constructor(private readonly pool: Pool) {}

  async search(accountId: string, input: CommandSearchQuery): Promise<CommandSearchResultDto[]> {
    const pattern = `%${escapeLike(input.query.toLocaleLowerCase())}%`;
    const result = await this.pool.query(
      `with accessible_brands as (
         select b.id,b.name,b.workspace_id
         from brands b
         join workspace_memberships m on m.workspace_id=b.workspace_id
         where m.account_id=$1 and m.active=true and ($3::text is null or b.id=$3)
       ), matches as (
         select 'brand'::text kind,b.id,b.id brand_id,b.name brand_name,b.name label,
                'Brand'::text detail,null::text campaign_id,1 rank
         from accessible_brands b where lower(b.name) like $2 escape '\\'
         union all
         select 'campaign',c.id,b.id,b.name,c.name,
                coalesce(nullif(c.objective,''),'Campaign'),c.id,2
         from campaigns c join accessible_brands b on b.id=c.brand_id and b.workspace_id=c.workspace_id
         where lower(c.name) like $2 escape '\\' or lower(c.objective) like $2 escape '\\'
         union all
         select 'content-asset',a.id,b.id,b.name,
                coalesce(nullif(a.topic,''),nullif(a.format,''),'Content asset'),
                concat_ws(' · ',nullif(a.format,''),nullif(a.channel,'')),a.campaign_id,3
         from content_assets a join accessible_brands b on b.id=a.brand_id and b.workspace_id=a.workspace_id
         where lower(a.topic) like $2 escape '\\' or lower(a.format) like $2 escape '\\'
            or lower(a.audience) like $2 escape '\\' or lower(a.cta) like $2 escape '\\'
       )
       select * from matches order by rank,lower(label),id limit $4`,
      [accountId, pattern, input.brandId ?? null, input.limit],
    );
    return result.rows.map(mapResult);
  }
}

function mapResult(row: Record<string, unknown>): CommandSearchResultDto {
  const kind = row.kind as CommandSearchResultKind;
  const brandId = String(row.brand_id);
  const id = String(row.id);
  const campaignId = row.campaign_id ? String(row.campaign_id) : undefined;
  const href = kind === "brand"
    ? `/brands/${encodeURIComponent(brandId)}/brain`
    : kind === "campaign"
      ? `/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(id)}`
      : `/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(campaignId!)}#asset-${encodeURIComponent(id)}`;
  return { kind,id,brandId,brandName:String(row.brand_name),label:String(row.label),detail:String(row.detail),href,...(campaignId?{campaignId}:{}) };
}

function escapeLike(value: string) { return value.replace(/[\\%_]/g, character => `\\${character}`); }
