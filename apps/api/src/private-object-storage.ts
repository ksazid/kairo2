import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CreativeObjectStorePort } from "@kairo/worker/creative-renderer";
import type { TemporaryObjectSigner } from "./carousel-studio-postgres";

export interface S3PrivateObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  provider: string;
}

interface Options { fetch?: typeof fetch; now?: () => Date }

export class S3PrivateCreativeObjectStore implements CreativeObjectStorePort {
  private readonly client: S3SigV4Client;
  constructor(config: S3PrivateObjectStorageConfig, options: Options = {}) { this.client = new S3SigV4Client(config, options); }
  async putPrivateObject(input: { workspaceId:string; brandId:string; objectKey:string; contentType:string; contentHash:string; bytes:Uint8Array }): Promise<{objectId:string}> {
    const key = scopedKey(input.workspaceId,input.brandId,input.objectKey);
    const hash = sha256(input.bytes);
    if (!safeHash(input.contentHash,hash)) throw new Error("Private object content hash does not match bytes");
    await this.client.put(key,input.contentType,input.bytes,hash);
    return { objectId:key };
  }
}

export class S3TemporaryObjectSigner implements TemporaryObjectSigner {
  private readonly client:S3SigV4Client;
  private readonly provider:string;
  constructor(config:S3PrivateObjectStorageConfig,options:Pick<Options,"now">={}) { this.client=new S3SigV4Client(config,options);this.provider=provider(config.provider); }
  async sign(input:{storageProvider:string;objectKey:string;expiresInSeconds:number}):Promise<string>{
    if(provider(input.storageProvider)!==this.provider)throw new Error("Rendered object storage provider does not match configured storage");
    return this.client.presignGet(input.objectKey,input.expiresInSeconds);
  }
}

export class S3PrivateUploadSigner {
  private readonly client:S3SigV4Client;
  constructor(config:S3PrivateObjectStorageConfig,options:Pick<Options,"now">={}){this.client=new S3SigV4Client(config,options)}
  async signPut(input:{objectKey:string;contentType:string;expiresInSeconds:number}):Promise<string>{return this.client.presignPut(input.objectKey,input.contentType,input.expiresInSeconds)}
}

export function privateMediaObjectKey(workspaceId:string,brandId:string,assetId:string){return `workspaces/${segment(workspaceId,"workspaceId",200)}/brands/${segment(brandId,"brandId",200)}/media/${segment(assetId,"assetId",200)}/original`}
export function privateMediaDerivativeObjectKey(workspaceId:string,brandId:string,assetId:string,derivative:"thumbnail.webp"|"poster.webp"){return `workspaces/${segment(workspaceId,"workspaceId",200)}/brands/${segment(brandId,"brandId",200)}/media/${segment(assetId,"assetId",200)}/${derivative}`}

class S3SigV4Client {
  private readonly endpoint:URL;
  private readonly fetcher:typeof fetch;
  private readonly now:()=>Date;
  private readonly config:S3PrivateObjectStorageConfig;
  constructor(config:S3PrivateObjectStorageConfig,options:Options={}){
    this.config=validateConfig(config);this.endpoint=new URL(this.config.endpoint);this.fetcher=options.fetch??fetch;this.now=options.now??(()=>new Date());
  }
  async put(key:string,contentType:string,bytes:Uint8Array,payloadHash:string):Promise<void>{
    const now=validNow(this.now()),date=amzDate(now),day=date.slice(0,8),url=this.objectUrl(key),canonicalPath=url.pathname;
    const canonicalHeaders=`content-type:${contentType.trim()}\nhost:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`,signedHeaders="content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest=`PUT\n${canonicalPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`,scope=`${day}/${this.config.region}/s3/aws4_request`,signature=sign(this.config.secretAccessKey,day,this.config.region,`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256(canonicalRequest)}`);
    const response=await this.fetcher(url,{method:"PUT",headers:{"content-type":contentType,"x-amz-content-sha256":payloadHash,"x-amz-date":date,authorization:`AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`},body:Buffer.from(bytes)});
    if(!response.ok)throw new Error(`Private object upload failed (${response.status})`);
  }
  presignGet(key:string,ttlInput:number):string{
    const ttl=Math.max(60,Math.min(3600,Math.floor(ttlInput))),now=validNow(this.now()),date=amzDate(now),day=date.slice(0,8),url=this.objectUrl(key),scope=`${day}/${this.config.region}/s3/aws4_request`;
    url.searchParams.set("X-Amz-Algorithm","AWS4-HMAC-SHA256");url.searchParams.set("X-Amz-Credential",`${this.config.accessKeyId}/${scope}`);url.searchParams.set("X-Amz-Date",date);url.searchParams.set("X-Amz-Expires",String(ttl));url.searchParams.set("X-Amz-SignedHeaders","host");
    const canonicalQuery=canonicalSearch(url.searchParams),canonicalRequest=`GET\n${url.pathname}\n${canonicalQuery}\nhost:${url.host}\n\nhost\nUNSIGNED-PAYLOAD`,signature=sign(this.config.secretAccessKey,day,this.config.region,`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256(canonicalRequest)}`);url.searchParams.set("X-Amz-Signature",signature);
    return url.toString();
  }
  presignPut(key:string,contentTypeInput:string,ttlInput:number):string{
    const contentType=label(contentTypeInput,"contentType",200).toLowerCase(),ttl=Math.max(60,Math.min(3600,Math.floor(ttlInput))),now=validNow(this.now()),date=amzDate(now),day=date.slice(0,8),url=this.objectUrl(key),scope=`${day}/${this.config.region}/s3/aws4_request`,signedHeaders="content-type;host";
    url.searchParams.set("X-Amz-Algorithm","AWS4-HMAC-SHA256");url.searchParams.set("X-Amz-Credential",`${this.config.accessKeyId}/${scope}`);url.searchParams.set("X-Amz-Date",date);url.searchParams.set("X-Amz-Expires",String(ttl));url.searchParams.set("X-Amz-SignedHeaders",signedHeaders);
    const canonicalQuery=canonicalSearch(url.searchParams),canonicalHeaders=`content-type:${contentType}\nhost:${url.host}\n`,canonicalRequest=`PUT\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`,signature=sign(this.config.secretAccessKey,day,this.config.region,`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256(canonicalRequest)}`);url.searchParams.set("X-Amz-Signature",signature);
    return url.toString();
  }
  private objectUrl(keyInput:string){const key=objectKey(keyInput),url=new URL(this.endpoint);url.pathname=`${this.endpoint.pathname.replace(/\/$/,"")}/${encodeURIComponent(this.config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;url.search="";url.hash="";return url}
}

export function s3PrivateObjectStorageConfigFromEnv(env:NodeJS.ProcessEnv):S3PrivateObjectStorageConfig|null{
  const names=["OBJECT_STORAGE_ENDPOINT","OBJECT_STORAGE_REGION","OBJECT_STORAGE_BUCKET","OBJECT_STORAGE_ACCESS_KEY_ID","OBJECT_STORAGE_SECRET_ACCESS_KEY"] as const;
  const values=Object.fromEntries(names.map(name=>[name,env[name]?.trim()??""])) as Record<(typeof names)[number],string>;
  if(names.every(name=>!values[name]))return null;
  const missing=names.filter(name=>!values[name]);if(missing.length)throw new Error(`Private object-storage configuration is incomplete: ${missing.join(", ")}`);
  return validateConfig({endpoint:values.OBJECT_STORAGE_ENDPOINT,region:values.OBJECT_STORAGE_REGION,bucket:values.OBJECT_STORAGE_BUCKET,accessKeyId:values.OBJECT_STORAGE_ACCESS_KEY_ID,secretAccessKey:values.OBJECT_STORAGE_SECRET_ACCESS_KEY,provider:env.OBJECT_STORAGE_PROVIDER?.trim()||"s3-private"});
}

function validateConfig(input:S3PrivateObjectStorageConfig):S3PrivateObjectStorageConfig{let endpoint:URL;try{endpoint=new URL(input.endpoint)}catch{throw new Error("OBJECT_STORAGE_ENDPOINT must be a valid URL")}if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password||!endpoint.hostname||endpoint.search||endpoint.hash)throw new Error("OBJECT_STORAGE_ENDPOINT must be credential-free HTTPS");const region=label(input.region,"OBJECT_STORAGE_REGION",100),bucket=label(input.bucket,"OBJECT_STORAGE_BUCKET",255),accessKeyId=label(input.accessKeyId,"OBJECT_STORAGE_ACCESS_KEY_ID",300),secretAccessKey=label(input.secretAccessKey,"OBJECT_STORAGE_SECRET_ACCESS_KEY",500);if(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(bucket))throw new Error("OBJECT_STORAGE_BUCKET is invalid");return{endpoint:endpoint.toString(),region,bucket,accessKeyId,secretAccessKey,provider:provider(input.provider)}}
function scopedKey(workspaceId:string,brandId:string,key:string){const expected=createHash("sha256").update(`${label(workspaceId,"workspaceId",200)}\u0000${label(brandId,"brandId",200)}`).digest("hex").slice(0,24),normalized=objectKey(key);if(!normalized.startsWith(`generated/${expected}/`))throw new Error("Private creative object key is outside Brand scope");return normalized}
function objectKey(value:string){const normalized=label(value,"objectKey",1000);if(normalized.startsWith("/")||normalized.includes("\\")||normalized.split("/").some(part=>!part||part==="."||part===".."))throw new Error("objectKey is invalid");return normalized}
function segment(value:string,field:string,max:number){const normalized=label(value,field,max);if(!/^[A-Za-z0-9._-]+$/.test(normalized))throw new Error(`${field} is invalid`);return normalized}
function provider(value:string){const normalized=label(value,"storageProvider",100);if(!/^[A-Za-z0-9._-]+$/.test(normalized))throw new Error("storageProvider is invalid");return normalized}
function label(value:string,field:string,max:number){if(typeof value!=="string"||!value.trim()||value.trim().length>max)throw new Error(`${field} is required`);return value.trim()}
function validNow(value:Date){if(!(value instanceof Date)||Number.isNaN(value.getTime()))throw new Error("Object-storage clock is invalid");return value}
function amzDate(value:Date){return value.toISOString().replace(/[:-]|\.\d{3}/g,"")}
function sha256(value:Uint8Array|string){return createHash("sha256").update(value).digest("hex")}
function safeHash(expected:string,actual:string){if(!/^[a-f0-9]{64}$/.test(expected))return false;return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(actual,"hex"))}
function hmac(key:Uint8Array|string,value:string){return createHmac("sha256",key).update(value).digest()}
function sign(secret:string,day:string,region:string,stringToSign:string){const dateKey=hmac(`AWS4${secret}`,day),regionKey=hmac(dateKey,region),serviceKey=hmac(regionKey,"s3"),signingKey=hmac(serviceKey,"aws4_request");return createHmac("sha256",signingKey).update(stringToSign).digest("hex")}
function canonicalSearch(params:URLSearchParams){return [...params.entries()].sort(([a,av],[b,bv])=>a===b?av.localeCompare(bv):a.localeCompare(b)).map(([key,value])=>`${awsEncode(key)}=${awsEncode(value)}`).join("&")}
function awsEncode(value:string){return encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)}
