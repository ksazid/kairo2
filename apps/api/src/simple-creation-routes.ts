import type{FastifyInstance,FastifyReply,FastifyRequest}from"fastify";
import{KairoService,type KairoRepository}from"@kairo/domain";
import type{IdentityVerifier}from"./auth";
import type{BeginHomeMediaUploadInput,HomeMediaService}from"./home-media";
import{SimpleCreationService,type StartSimpleCreationInput}from"./simple-creation";

export function registerSimpleCreationRoutes(app:FastifyInstance,d:{
  coreStore:KairoRepository;
  identityVerifier:IdentityVerifier;
  service:SimpleCreationService;
  homeMedia?:HomeMediaService;
  trigger?:()=>void;
}){
 const core=new KairoService(d.coreStore);
 app.post<{Params:{brandId:string};Body:StartSimpleCreationInput}>("/api/v1/brands/:brandId/simple-creations",async(q,r)=>{const a=await auth(q,r,core,d.identityVerifier);if(!a)return;const b=await core.getBrand(a.id,q.params.brandId);const value=await d.service.start(a.id,b.workspaceId,b.id,q.body??({}as StartSimpleCreationInput));d.trigger?.();return r.status(202).send(await d.service.get(a.id,b.id,value.id));});
 app.get<{Params:{brandId:string;creationId:string}}>("/api/v1/brands/:brandId/simple-creations/:creationId",async(q,r)=>{const a=await auth(q,r,core,d.identityVerifier);if(!a)return;return d.service.get(a.id,q.params.brandId,q.params.creationId);});

 app.get<{Params:{brandId:string}}>("/api/v1/brands/:brandId/home-media",async(q,r)=>{const a=await auth(q,r,core,d.identityVerifier);if(!a)return;await core.getBrand(a.id,q.params.brandId);if(!d.homeMedia)return unavailable(r,q.id);return d.homeMedia.list(a.id,q.params.brandId);});
 app.post<{Params:{brandId:string};Body:BeginHomeMediaUploadInput}>("/api/v1/brands/:brandId/home-media/uploads",async(q,r)=>{const a=await auth(q,r,core,d.identityVerifier);if(!a)return;const b=await core.getBrand(a.id,q.params.brandId);if(!d.homeMedia)return unavailable(r,q.id);return r.status(201).send(await d.homeMedia.begin(a.id,b.workspaceId,b.id,q.body??({}as BeginHomeMediaUploadInput)));});
 app.post<{Params:{brandId:string;mediaAssetId:string}}>("/api/v1/brands/:brandId/home-media/uploads/:mediaAssetId/complete",async(q,r)=>{const a=await auth(q,r,core,d.identityVerifier);if(!a)return;await core.getBrand(a.id,q.params.brandId);if(!d.homeMedia)return unavailable(r,q.id);return d.homeMedia.complete(a.id,q.params.brandId,q.params.mediaAssetId);});
}
function unavailable(r:FastifyReply,id:string){return r.status(503).send({type:"about:blank",title:"Media unavailable",status:503,detail:"Kairo private media storage is not configured right now.",code:"media_unavailable",correlationId:id});}
async function auth(q:FastifyRequest,r:FastifyReply,s:KairoService,v:IdentityVerifier){const i=await v.verify(q.headers.authorization);if(!i){await r.status(401).send({title:"Unauthorized",status:401,code:"unauthorized",correlationId:q.id});return null;}return s.establishSession(i);}
