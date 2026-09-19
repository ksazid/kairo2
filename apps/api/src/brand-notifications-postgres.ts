import type{Pool,PoolClient}from"pg";
import{ResourceNotFoundError}from"@kairo/domain";
import type{BrandNotificationDto,BrandNotificationsDto}from"@kairo/contracts";

export class PgBrandNotificationRepository{
 constructor(private pool:Pool){}
 async list(accountId:string,brandId:string):Promise<BrandNotificationsDto>{const client=await this.pool.connect();try{const workspaceId=await scope(client,accountId,brandId);const result=await client.query(`
select * from (
 select 'approval-required:'||r.id id,'approval-required' kind,r.id source_id,'content-review' source_type,coalesce(r.completed_at,r.requested_at) occurred_at,r.campaign_id,r.asset_id,null::text channel,null::text account_ref,null::text failure_reason
 from content_reviews r where r.workspace_id=$1 and r.brand_id=$2 and r.status='passed' and not exists(select 1 from content_approvals a where a.workspace_id=r.workspace_id and a.brand_id=r.brand_id and a.review_id=r.id)
 union all
 select 'publishing-failed:'||c.id,'publishing-failed',c.id,'publish-command',coalesce(c.last_attempt_at,c.created_at),c.campaign_id,c.asset_id,c.channel,c.account_ref,c.failure_reason
 from publish_commands c where c.workspace_id=$1 and c.brand_id=$2 and c.status='failed'
 union all
 select 'connection-reconnect-required:'||a.id,'connection-reconnect-required',a.id,'channel-account',coalesce(a.last_verified_at,a.connected_at),null,null,a.channel,a.account_ref,null
 from channel_accounts a where a.workspace_id=$1 and a.brand_id=$2 and a.status='reconnect-required'
) notifications order by occurred_at desc,id`,[workspaceId,brandId]);return{brandId,items:result.rows.map(row=>toDto(brandId,row))}}finally{client.release()}}
}
async function scope(client:PoolClient,accountId:string,brandId:string){const row=(await client.query(`select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id where m.account_id=$1 and m.active=true and b.id=$2`,[accountId,brandId])).rows[0];if(!row)throw new ResourceNotFoundError("Brand not found");return String(row.workspace_id)}
function toDto(brandId:string,row:any):BrandNotificationDto{return{id:String(row.id),kind:row.kind,brandId,occurredAt:iso(row.occurred_at),source:{type:row.source_type,id:String(row.source_id)},context:{...(row.campaign_id?{campaignId:String(row.campaign_id)}:{}),...(row.asset_id?{assetId:String(row.asset_id)}:{}),...(row.channel?{channel:String(row.channel)}:{}),...(row.account_ref?{accountRef:String(row.account_ref)}:{}),...(row.failure_reason?{failureReason:String(row.failure_reason)}:{})}}}
function iso(value:Date|string){return value instanceof Date?value.toISOString():new Date(value).toISOString()}
