import{createHmac}from"node:crypto";
import type{TemporaryObjectSigner}from"./carousel-studio-postgres";
export class HmacObjectStorageTemporarySigner implements TemporaryObjectSigner{
 private base:URL;
 constructor(baseUrl:string,private secret:string){this.base=httpsBase(baseUrl);if(secret.trim().length<32)throw new Error("OBJECT_STORAGE_SIGNING_SECRET must contain at least 32 characters")}
 async sign(input:{storageProvider:string;objectKey:string;expiresInSeconds:number}){const provider=segment(input.storageProvider,"storageProvider"),key=objectKey(input.objectKey),seconds=Math.max(60,Math.min(3600,Math.floor(input.expiresInSeconds))),expires=Math.floor(Date.now()/1000)+seconds,path=[provider,...key.split("/").map(part=>encodeURIComponent(part))].join("/"),signature=createHmac("sha256",this.secret).update(`${provider}\n${key}\n${expires}`).digest("hex"),url=new URL(path,this.base);url.searchParams.set("expires",String(expires));url.searchParams.set("signature",signature);if(url.protocol!=="https:"||url.hostname!==this.base.hostname)throw new Error("Temporary object URL escaped the configured host");return url.toString()}
}
function httpsBase(value:string){let url:URL;try{url=new URL(value)}catch{throw new Error("OBJECT_STORAGE_PUBLIC_BASE_URL must be a valid URL")}if(url.protocol!=="https:"||url.username||url.password||!url.hostname)throw new Error("OBJECT_STORAGE_PUBLIC_BASE_URL must be credential-free HTTPS");if(!url.pathname.endsWith("/"))url.pathname+=`/`;url.search="";url.hash="";return url}
function segment(value:string,field:string){const normalized=value.trim();if(!/^[A-Za-z0-9._-]{1,100}$/.test(normalized))throw new Error(`${field} is invalid`);return normalized}
function objectKey(value:string){const normalized=value.trim();if(!normalized||normalized.startsWith("/")||normalized.includes("..")||normalized.includes("\\")||normalized.split("/").some(part=>!part))throw new Error("objectKey is invalid");return normalized}
