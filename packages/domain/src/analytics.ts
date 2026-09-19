import { DomainValidationError } from "./index";
import type { PublishedPost } from "./publishing";

export type MetricName="impressions"|"reach"|"reactions"|"likes"|"comments"|"shares"|"saves"|"clicks"|"videoViews";
export type MetricProvider="linkedin"|"instagram";
export type MetricUnavailableReason="provider-did-not-return"|"unsupported"|"permission-required"|"post-not-eligible";

export interface RawMetricSnapshot{
  id:string;workspaceId:string;brandId:string;publishedPostId:string;campaignId:string;assetId:string;versionId:string;
  channel:string;accountRef:string;externalPostId:string;provider:MetricProvider;capturedAt:string;
  raw:Readonly<Record<string,unknown>>;providerRequestId?:string;
}

export interface NormalizedMetric{
  id:string;workspaceId:string;brandId:string;publishedPostId:string;name:MetricName;capturedAt:string;
  status:"available"|"unavailable";value?:number;reason?:MetricUnavailableReason;
  sourceSnapshotId:string;sourceField:string;transformationVersion:string;
}

export interface MetricTransformation{version:string;supported:Partial<Record<MetricName,string>>;unavailableReason?:MetricUnavailableReason}

export function createMetricSnapshot(input:{id:string;post:PublishedPost;provider:MetricProvider;capturedAt:string;raw:Record<string,unknown>;providerRequestId?:string}):RawMetricSnapshot{
  const provider=one(input.provider,["linkedin","instagram"],"provider");
  if(input.post.channel!==provider)throw new DomainValidationError("Metric provider does not match Published Post channel");
  const capturedAt=time(input.capturedAt,"capturedAt");
  if(Date.parse(capturedAt)<Date.parse(input.post.publishedAt))throw new DomainValidationError("Metric snapshot cannot predate Published Post");
  if(!plain(input.raw))throw new DomainValidationError("raw metrics must be an object");
  return Object.freeze({id:text(input.id,"id"),workspaceId:input.post.workspaceId,brandId:input.post.brandId,publishedPostId:input.post.id,campaignId:input.post.campaignId,assetId:input.post.assetId,versionId:input.post.versionId,channel:input.post.channel,accountRef:input.post.accountRef,externalPostId:input.post.externalPostId,provider,capturedAt,raw:Object.freeze(structuredClone(input.raw)),...(input.providerRequestId?{providerRequestId:text(input.providerRequestId,"providerRequestId")}:{})});
}

export function normalizeMetricSnapshot(snapshot:RawMetricSnapshot,transformation:MetricTransformation):NormalizedMetric[]{
  const version=text(transformation.version,"transformation version");
  return Object.entries(transformation.supported).map(([metric,field])=>{
    const name=one(metric,["impressions","reach","reactions","likes","comments","shares","saves","clicks","videoViews"],"metric name");
    const sourceField=text(field,"source field");const value=snapshot.raw[sourceField];
    const base={id:`${snapshot.id}:${name}:${version}`,workspaceId:snapshot.workspaceId,brandId:snapshot.brandId,publishedPostId:snapshot.publishedPostId,name,capturedAt:snapshot.capturedAt,sourceSnapshotId:snapshot.id,sourceField,transformationVersion:version};
    if(value===undefined||value===null)return{...base,status:"unavailable" as const,reason:transformation.unavailableReason??"provider-did-not-return"};
    if(typeof value!=="number"||!Number.isFinite(value)||value<0)throw new DomainValidationError(`${name} must be a non-negative finite number`);
    return{...base,status:"available" as const,value};
  });
}

export function summarizeMetricFreshness(capturedAt:string,asOf:string,staleAfterSeconds:number):{status:"fresh"|"stale";ageSeconds:number}{
  const captured=Date.parse(time(capturedAt,"capturedAt")),now=Date.parse(time(asOf,"asOf"));
  if(!Number.isInteger(staleAfterSeconds)||staleAfterSeconds<1)throw new DomainValidationError("staleAfterSeconds must be a positive integer");
  if(now<captured)throw new DomainValidationError("asOf cannot predate capturedAt");
  const ageSeconds=Math.floor((now-captured)/1000);return{status:ageSeconds>staleAfterSeconds?"stale":"fresh",ageSeconds};
}

function text(value:unknown,field:string){if(typeof value!=="string"||!value.trim())throw new DomainValidationError(`${field} is required`);if(value.trim().length>500)throw new DomainValidationError(`${field} is too long`);return value.trim()}
function time(value:unknown,field:string){const v=text(value,field);if(Number.isNaN(Date.parse(v)))throw new DomainValidationError(`${field} must be a valid timestamp`);return v}
function one<const T extends string>(value:unknown,values:readonly T[],field:string):T{if(typeof value!=="string"||!values.includes(value as T))throw new DomainValidationError(`${field} is not supported`);return value as T}
function plain(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value)}
