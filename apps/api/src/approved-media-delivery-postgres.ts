import type{Pool}from"pg";
import type{ApprovedMediaDeliveryPort}from"@kairo/worker/publishing";
import type{TemporaryObjectSigner}from"./carousel-studio-postgres";

export class PgApprovedMediaDelivery implements ApprovedMediaDeliveryPort{
 constructor(private pool:Pool,private signer:TemporaryObjectSigner,private ttlSeconds=900,private now:()=>Date=()=>new Date()){}
 async deliver(input:{commandId:string;approvedAssetVersionId:string;approvedMediaFingerprint:string}){
  const client=await this.pool.connect();try{
   const version=(await client.query(`select v.id,v.storage_provider,v.media_fingerprint from publish_commands c join carousel_rendered_approvals a on a.rendered_version_id=c.approved_asset_version_id join carousel_rendered_asset_versions v on v.id=a.rendered_version_id where c.id=$1 and c.approved_asset_version_id=$2 and c.approved_media_fingerprint=$3 and v.status='ready'`,[input.commandId,input.approvedAssetVersionId,input.approvedMediaFingerprint])).rows[0];
   if(!version)throw new Error("Approved rendered media is unavailable");
   const slides=await client.query(`select object_key from carousel_rendered_slide_assets where rendered_version_id=$1 order by position`,[version.id]);
   if(slides.rowCount===0)throw new Error("Approved rendered media has no slides");
   const seconds=Math.max(60,Math.min(3600,Math.floor(this.ttlSeconds)));
   const mediaItems=await Promise.all(slides.rows.map(async row=>({kind:"image" as const,url:await this.signer.sign({storageProvider:String(version.storage_provider),objectKey:String(row.object_key),expiresInSeconds:seconds})})));
   return{approvedAssetVersionId:String(version.id),approvedMediaFingerprint:String(version.media_fingerprint),mediaItems,expiresAt:new Date(this.now().getTime()+seconds*1000).toISOString()};
  }finally{client.release()}
 }
}
