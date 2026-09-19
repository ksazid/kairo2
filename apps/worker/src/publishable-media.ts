import { createHash } from "node:crypto";
import type { PublishMediaItem, RenderedMediaApproval } from "@kairo/domain/publishing";
import type { ContentApproval } from "@kairo/domain/review";
import type { CreativeScope, StoredCreativeAsset, StoredCreativePackage } from "./creative-renderer";

export interface PrivateCreativeObjectDescriptor {
  objectId: string;
  objectKey: string;
  contentType: string;
  contentHash: string;
  sizeBytes: number;
}
export interface PrivateCreativeObject extends PrivateCreativeObjectDescriptor { bytes: Uint8Array }
export interface PublishableCreativeStorePort {
  readPrivateObject(input:{workspaceId:string;brandId:string;objectId:string}):Promise<PrivateCreativeObject>;
  findPrivateObjectByKey(input:{workspaceId:string;brandId:string;objectKey:string}):Promise<PrivateCreativeObjectDescriptor|null>;
  putPrivateObject(input:{workspaceId:string;brandId:string;objectKey:string;contentType:string;contentHash:string;bytes:Uint8Array}):Promise<{objectId:string}>;
  issuePublishingUrl(input:{workspaceId:string;brandId:string;objectId:string;ttlSeconds:number;audience:"publishing"}):Promise<{url:string;expiresAt:string}>;
}
export interface ReelEncoderFrame { bytes:Uint8Array; durationSeconds:number }
export interface ReelEncoderPort {
  readonly version:string;
  encode(input:{sourceFingerprint:string;frames:ReelEncoderFrame[]}):Promise<{contentType:"video/mp4";bytes:Uint8Array}>;
}
export interface CreativePublicationLineage { contentVersionId:string }
export interface PreparedPublishableObject extends PrivateCreativeObjectDescriptor { expiresAt:string; supportingClaimIds:string[] }
export interface PreparedPublishableCreativeMedia {
  format:"carousel"|"reel";
  workspaceId:string;
  brandId:string;
  contentVersionId:string;
  sourceFingerprint:string;
  supportingClaimIds:string[];
  mediaItems:PublishMediaItem[];
  objects:PreparedPublishableObject[];
  expiresAt:string;
  encoderVersion?:string;
}
export interface ApprovedPublishableCreativeMedia extends PreparedPublishableCreativeMedia { approvedAssetVersionId:string; approvedMediaFingerprint:string; approvalId:string }

interface Options { publishingTtlSeconds?:number; maxEncodedBytes?:number; clock?:()=>Date }
interface ReelManifestScene { index:number; startSecond:number; endSecond:number; storyboardFilename:string; storyboardSha256:string }
interface ReelManifest { schemaVersion:number; rendererVersion:string; sourceFingerprint:string; format:string; targetDurationSeconds:number; scenes:ReelManifestScene[] }

export class PublishableCreativeMediaService {
  private readonly ttl:number;
  private readonly maxEncodedBytes:number;
  private readonly clock:()=>Date;
  constructor(private readonly store:PublishableCreativeStorePort,private readonly encoder:ReelEncoderPort,options:Options={}){
    this.ttl=boundedInt(options.publishingTtlSeconds??600,"publishingTtlSeconds",1,900);
    this.maxEncodedBytes=boundedInt(options.maxEncodedBytes??100*1024*1024,"maxEncodedBytes",1,512*1024*1024);
    this.clock=options.clock??(()=>new Date());
    if(!encoder||typeof encoder.version!=="string"||!encoder.version.trim()||encoder.version.length>200)throw new Error("Reel encoder version is required");
  }
  async prepare(scopeInput:CreativeScope,pkg:StoredCreativePackage,lineageInput:CreativePublicationLineage):Promise<PreparedPublishableCreativeMedia>{
    const scope=validScope(scopeInput);validPackage(pkg);const contentVersionId=required(lineageInput?.contentVersionId,"contentVersionId",200);
    return pkg.format==="carousel"?this.prepareCarousel(scope,pkg,contentVersionId):this.prepareReel(scope,pkg,contentVersionId);
  }
  async prepareApproved(scopeInput:CreativeScope,pkg:StoredCreativePackage,approval:ContentApproval,renderedApproval:RenderedMediaApproval):Promise<ApprovedPublishableCreativeMedia>{
    const scope=validScope(scopeInput);if(approval.workspaceId!==scope.workspaceId||approval.brandId!==scope.brandId)throw new Error("Approval is outside generated media scope");
    const prepared=await this.prepare(scope,pkg,{contentVersionId:approval.versionId});
    const approvedMediaFingerprint=sha256(JSON.stringify(prepared.objects.map(object=>({objectId:object.objectId,contentHash:object.contentHash,contentType:object.contentType,sizeBytes:object.sizeBytes}))));
    if(renderedApproval.workspaceId!==scope.workspaceId||renderedApproval.brandId!==scope.brandId||renderedApproval.assetId!==approval.assetId||renderedApproval.contentVersionId!==approval.versionId||renderedApproval.mediaFingerprint!==approvedMediaFingerprint)throw new Error("Rendered media does not match its immutable approval");
    return{...prepared,approvalId:required(renderedApproval.id,"renderedApproval.id",200),approvedAssetVersionId:required(renderedApproval.assetVersionId,"assetVersionId",200),approvedMediaFingerprint};
  }
  private async prepareCarousel(scope:CreativeScope,pkg:StoredCreativePackage,contentVersionId:string):Promise<PreparedPublishableCreativeMedia>{
    const assets=pkg.assets.filter(a=>a.role==="carousel-slide").sort((a,b)=>a.index-b.index);
    const thumbnails=pkg.assets.filter(a=>a.role==="carousel-thumbnail");
    if(assets.length<2||assets.length>10||thumbnails.length>1||assets.length+thumbnails.length!==pkg.assets.length)throw new Error("Carousel package must contain 2 to 10 slide assets and at most one thumbnail");
    contiguous(assets.map(a=>a.index),"carousel slide");
    const mediaItems:PublishMediaItem[]=[];const objects:PreparedPublishableObject[]=[];
    for(const asset of assets){
      const verified=await this.verifyAsset(scope,asset,"image/png");
      const issued=await this.issue(scope,verified.objectId);
      mediaItems.push({kind:"image",url:issued.url});objects.push({...descriptor(verified),expiresAt:issued.expiresAt,supportingClaimIds:claims(asset.supportingClaimIds)});
    }
    return{format:"carousel",workspaceId:scope.workspaceId,brandId:scope.brandId,contentVersionId,sourceFingerprint:pkg.sourceFingerprint,supportingClaimIds:packageClaims(pkg),mediaItems,objects,expiresAt:earliest(objects)};
  }
  private async prepareReel(scope:CreativeScope,pkg:StoredCreativePackage,contentVersionId:string):Promise<PreparedPublishableCreativeMedia>{
    const manifestAsset=pkg.assets.filter(a=>a.role==="reel-render-manifest");
    const frameAssets=pkg.assets.filter(a=>a.role==="reel-storyboard").sort((a,b)=>a.index-b.index);
    const thumbnails=pkg.assets.filter(a=>a.role==="reel-thumbnail");
    if(manifestAsset.length!==1||frameAssets.length<1||thumbnails.length>1||manifestAsset.length+frameAssets.length+thumbnails.length!==pkg.assets.length)throw new Error("Reel package must contain storyboard frames, one render manifest and at most one thumbnail");
    contiguous(frameAssets.map(a=>a.index),"reel storyboard");
    const manifestObject=await this.verifyAsset(scope,manifestAsset[0]!,"application/vnd.kairo.reel-render+json");
    const manifest=parseManifest(manifestObject.bytes,pkg);
    if(manifest.scenes.length!==frameAssets.length)throw new Error("Reel manifest scene count does not match storyboard assets");
    const frames:ReelEncoderFrame[]=[];
    for(let i=0;i<manifest.scenes.length;i++){
      const scene=manifest.scenes[i]!,asset=frameAssets[i]!;
      if(scene.index!==i||scene.storyboardFilename!==asset.filename||scene.storyboardSha256!==asset.contentHash)throw new Error("Reel manifest storyboard provenance does not match stored asset");
      const verified=await this.verifyAsset(scope,asset,"image/png");
      if(sha256(verified.bytes)!==scene.storyboardSha256)throw new Error("Reel storyboard hash does not match manifest");
      const duration=scene.endSecond-scene.startSecond;
      if(!Number.isFinite(duration)||duration<=0)throw new Error("Reel scene duration is invalid");
      frames.push({bytes:verified.bytes,durationSeconds:duration});
    }
    const objectKey=encodedObjectKey(scope,pkg.sourceFingerprint,this.encoder.version);
    let encoded=await this.store.findPrivateObjectByKey({workspaceId:scope.workspaceId,brandId:scope.brandId,objectKey});
    let verifiedEncoded:PrivateCreativeObject;
    if(encoded){
      verifiedEncoded=await this.verifyDescriptor(scope,encoded,"video/mp4",this.maxEncodedBytes,true);
    }else{
      const result=await this.encoder.encode({sourceFingerprint:pkg.sourceFingerprint,frames});
      if(result.contentType!=="video/mp4")throw new Error("Reel encoder returned an unsupported content type");
      validateMp4(result.bytes,this.maxEncodedBytes);
      const contentHash=sha256(result.bytes);
      const stored=await this.store.putPrivateObject({workspaceId:scope.workspaceId,brandId:scope.brandId,objectKey,contentType:"video/mp4",contentHash,bytes:result.bytes});
      if(!stored?.objectId||typeof stored.objectId!=="string")throw new Error("Generated media store did not return an encoded object identifier");
      encoded={objectId:stored.objectId,objectKey,contentType:"video/mp4",contentHash,sizeBytes:result.bytes.byteLength};
      verifiedEncoded=await this.verifyDescriptor(scope,encoded,"video/mp4",this.maxEncodedBytes,true);
    }
    const issued=await this.issue(scope,verifiedEncoded.objectId),supportingClaimIds=packageClaims(pkg);
    const obj:PreparedPublishableObject={...descriptor(verifiedEncoded),expiresAt:issued.expiresAt,supportingClaimIds};
    return{format:"reel",workspaceId:scope.workspaceId,brandId:scope.brandId,contentVersionId,sourceFingerprint:pkg.sourceFingerprint,supportingClaimIds,mediaItems:[{kind:"video",url:issued.url}],objects:[obj],expiresAt:issued.expiresAt,encoderVersion:this.encoder.version};
  }
  private async verifyAsset(scope:CreativeScope,asset:StoredCreativeAsset,expectedType:string):Promise<PrivateCreativeObject>{
    if(asset.contentType!==expectedType)throw new Error("Generated asset content type does not match expected media type");
    const object=await this.store.readPrivateObject({workspaceId:scope.workspaceId,brandId:scope.brandId,objectId:asset.objectId});
    if(object.objectId!==asset.objectId||object.objectKey!==asset.objectKey)throw new Error("Private object identity does not match generated asset");
    if(object.contentType!==asset.contentType||object.contentHash!==asset.contentHash||object.sizeBytes!==asset.sizeBytes)throw new Error("Private object metadata does not match generated asset");
    if(object.bytes.byteLength!==asset.sizeBytes||sha256(object.bytes)!==asset.contentHash)throw new Error("Private object content hash does not match generated asset");
    return object;
  }
  private async verifyDescriptor(scope:CreativeScope,value:PrivateCreativeObjectDescriptor,expectedType:string,maxBytes:number,mp4:boolean):Promise<PrivateCreativeObject>{
    const object=await this.store.readPrivateObject({workspaceId:scope.workspaceId,brandId:scope.brandId,objectId:value.objectId});
    if(object.objectId!==value.objectId||object.objectKey!==value.objectKey||object.contentType!==value.contentType||object.contentHash!==value.contentHash||object.sizeBytes!==value.sizeBytes)throw new Error("Private encoded object metadata mismatch");
    if(object.contentType!==expectedType||sha256(object.bytes)!==value.contentHash||object.bytes.byteLength!==value.sizeBytes)throw new Error("Private encoded object hash/type mismatch");
    if(object.bytes.byteLength>maxBytes)throw new Error("Encoded media exceeds configured size bound");
    if(mp4)validateMp4(object.bytes,maxBytes);
    return object;
  }
  private async issue(scope:CreativeScope,objectId:string):Promise<{url:string;expiresAt:string}>{
    const base=this.clock();if(Number.isNaN(base.getTime()))throw new Error("Publishing clock returned an invalid time");
    const issued=await this.store.issuePublishingUrl({workspaceId:scope.workspaceId,brandId:scope.brandId,objectId,ttlSeconds:this.ttl,audience:"publishing"});
    const url=safeHttps(issued?.url),expiry=Date.parse(issued?.expiresAt??"");
    if(!Number.isFinite(expiry)||expiry<=base.getTime())throw new Error("Publishing URL expiry is invalid");
    if(expiry>base.getTime()+this.ttl*1000+1000)throw new Error("Publishing URL expiry exceeds configured TTL");
    return{url,expiresAt:new Date(expiry).toISOString()};
  }
}

function parseManifest(bytes:Uint8Array,pkg:StoredCreativePackage):ReelManifest{
  let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new Error("Reel render manifest is invalid JSON")}
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Reel render manifest is invalid");
  const m=raw as Record<string,unknown>;
  if(m.schemaVersion!==1||m.format!=="reel"||m.rendererVersion!==pkg.rendererVersion||m.sourceFingerprint!==pkg.sourceFingerprint||!Array.isArray(m.scenes))throw new Error("Reel render manifest provenance is invalid");
  const scenes=m.scenes.map((item,index)=>{
    if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Reel render manifest scene is invalid");
    const s=item as Record<string,unknown>,i=finite(s.index,"scene index"),start=finite(s.startSecond,"scene start"),end=finite(s.endSecond,"scene end");
    if(i!==index||start<0||end<=start)throw new Error("Reel render manifest scene timing is invalid");
    const filename=required(s.storyboardFilename,"storyboardFilename",200),hash=required(s.storyboardSha256,"storyboardSha256",64);
    if(!/^[a-f0-9]{64}$/.test(hash))throw new Error("Reel storyboard hash is invalid");
    return{index:i,startSecond:start,endSecond:end,storyboardFilename:filename,storyboardSha256:hash};
  });
  if(!scenes.length||Math.abs(scenes[0]!.startSecond)>0.001)throw new Error("Reel scene timeline must start at zero");
  for(let i=1;i<scenes.length;i++)if(Math.abs(scenes[i]!.startSecond-scenes[i-1]!.endSecond)>0.001)throw new Error("Reel scene timeline must be continuous without gaps or overlaps");
  const target=finite(m.targetDurationSeconds,"targetDurationSeconds");if(target<=0||Math.abs(scenes[scenes.length-1]!.endSecond-target)>0.001)throw new Error("Reel target duration does not match scenes");
  return{schemaVersion:1,rendererVersion:pkg.rendererVersion,sourceFingerprint:pkg.sourceFingerprint,format:"reel",targetDurationSeconds:target,scenes};
}
function validPackage(pkg:StoredCreativePackage){if(!pkg||!(["carousel","reel"] as string[]).includes(pkg.format)||!/^[a-f0-9]{64}$/.test(pkg.sourceFingerprint)||!pkg.rendererVersion?.trim()||!Array.isArray(pkg.assets))throw new Error("Generated creative package is invalid")}
function validScope(scope:CreativeScope):CreativeScope{return{workspaceId:required(scope?.workspaceId,"workspaceId",200),brandId:required(scope?.brandId,"brandId",200)}}
function required(value:unknown,name:string,max:number){if(typeof value!=="string"||!value.trim()||value.trim().length>max)throw new Error(`${name} is required`);return value.trim()}
function finite(value:unknown,name:string){if(typeof value!=="number"||!Number.isFinite(value))throw new Error(`${name} is invalid`);return value}
function boundedInt(value:number,name:string,min:number,max:number){if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} is invalid`);return value}
function contiguous(values:number[],label:string){for(let i=0;i<values.length;i++)if(values[i]!==i)throw new Error(`${label} indexes must be contiguous`)}
function descriptor(value:PrivateCreativeObject|PrivateCreativeObjectDescriptor):PrivateCreativeObjectDescriptor{return{objectId:value.objectId,objectKey:value.objectKey,contentType:value.contentType,contentHash:value.contentHash,sizeBytes:value.sizeBytes}}
function earliest(items:PreparedPublishableObject[]){return new Date(Math.min(...items.map(item=>Date.parse(item.expiresAt)))).toISOString()}
function sha256(value:Uint8Array|string){return createHash("sha256").update(value).digest("hex")}
function encodedObjectKey(scope:CreativeScope,fingerprint:string,version:string){const scopeKey=sha256(`${scope.workspaceId}\u0000${scope.brandId}`).slice(0,24),encoderKey=sha256(version).slice(0,16);return`generated/${scopeKey}/reel/${fingerprint}/encoded/${encoderKey}/reel.mp4`}
function validateMp4(bytes:Uint8Array,max:number){if(!(bytes instanceof Uint8Array)||bytes.byteLength<12)throw new Error("Encoded output is not a valid MP4");if(bytes.byteLength>max)throw new Error("Encoded MP4 exceeds configured size bound");if(bytes[4]!==0x66||bytes[5]!==0x74||bytes[6]!==0x79||bytes[7]!==0x70)throw new Error("Encoded output is missing MP4 ftyp signature")}
function claims(value:string[]){if(!Array.isArray(value)||!value.length)throw new Error("Generated media requires supporting Claim lineage");const normalized=value.map((id,index)=>required(id,`supportingClaimIds[${index}]`,200));return[...new Set(normalized)]}
function packageClaims(pkg:StoredCreativePackage){return claims(pkg.assets.flatMap(asset=>asset.supportingClaimIds))}
function safeHttps(value:unknown){if(typeof value!=="string")throw new Error("Publishing URL must use HTTPS");let url:URL;try{url=new URL(value)}catch{throw new Error("Publishing URL must use HTTPS")};if(url.protocol!=="https:"||url.username||url.password)throw new Error("Publishing URL must use HTTPS without embedded credentials");const host=url.hostname.toLowerCase();if(privateHost(host))throw new Error("Publishing URL must not target a private host");return url.toString()}
function privateHost(host:string){return host==="localhost"||host.endsWith(".localhost")||host==="[::1]"||/^\[(fc|fd|fe8|fe9|fea|feb)/.test(host)||/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)}
