import { DomainValidationError } from "./index";
import type { PublishContentType, PublishLifecycleStatus } from "./publishing";

export type InstagramPublishKind=Extract<PublishContentType,"reel"|"carousel"|"image">;
export interface InstagramPublishReceipt{publishCommandId:string;status:PublishLifecycleStatus;containerId?:string;publishId?:string;publishedUrl?:string;failureReason?:string}
export interface InstagramInsight{name:string;status:"available"|"unavailable";value?:number;reason?:string;capturedAt:string}
export interface InstagramPublisher{
  publish(accountId:string,input:{brandId:string;publishCommandId:string;kind:InstagramPublishKind}):Promise<InstagramPublishReceipt>;
  getPublishStatus(accountId:string,input:{brandId:string;publishCommandId:string}):Promise<InstagramPublishReceipt>;
}
export interface InstagramInsightsReader{getInstagramInsights(accountId:string,input:{brandId:string;publishedPostId:string}):Promise<{publishedPostId:string;metrics:InstagramInsight[]}>}

export interface InstagramPublishingOperations{
  command(accountId:string,brandId:string,publishCommandId:string):Promise<{id:string;channel:string;contentType:string;lifecycleStatus?:PublishLifecycleStatus;status:string;metaContainerId?:string;providerPublishId?:string;publishedUrl?:string;failureReason?:string}|null>;
  enqueue(accountId:string,brandId:string,publishCommandId:string):Promise<void>;
}

export class KairoInstagramPublisher implements InstagramPublisher{
  constructor(private operations:InstagramPublishingOperations){}
  async publish(accountId:string,input:{brandId:string;publishCommandId:string;kind:InstagramPublishKind}){const scoped=normalize(input),command=await this.operations.command(required(accountId,"accountId"),scoped.brandId,scoped.publishCommandId);if(!command||command.channel!=="instagram")throw new DomainValidationError("Instagram Publish Command not found");if(command.contentType!==input.kind)throw new DomainValidationError(`Publish Command is not an Instagram ${input.kind}`);if(["published","failed"].includes(command.lifecycleStatus??""))return receipt(command);if(!["scheduled","dispatching","unknown"].includes(command.status))throw new DomainValidationError("Instagram Publish Command is not publishable");await this.operations.enqueue(accountId,scoped.brandId,scoped.publishCommandId);return receipt(command)}
  async getPublishStatus(accountId:string,input:{brandId:string;publishCommandId:string}){const scoped=normalize(input),command=await this.operations.command(required(accountId,"accountId"),scoped.brandId,scoped.publishCommandId);if(!command||command.channel!=="instagram")throw new DomainValidationError("Instagram Publish Command not found");return receipt(command)}
}
function receipt(command:Awaited<ReturnType<InstagramPublishingOperations["command"]>> extends infer T?NonNullable<T>:never):InstagramPublishReceipt{return{publishCommandId:command.id,status:command.lifecycleStatus??status(command.status),...(command.metaContainerId?{containerId:command.metaContainerId}:{}),...(command.providerPublishId?{publishId:command.providerPublishId}:{}),...(command.publishedUrl?{publishedUrl:command.publishedUrl}:{}),...(command.failureReason?{failureReason:command.failureReason}:{})}}
function status(value:string):PublishLifecycleStatus{return value==="dispatching"?"publishing":value==="published"?"published":value==="failed"?"failed":"approved"}
function normalize(input:{brandId:string;publishCommandId:string}){return{brandId:required(input?.brandId,"brandId"),publishCommandId:required(input?.publishCommandId,"publishCommandId")}}
function required(value:unknown,field:string){if(typeof value!=="string"||!value.trim()||value.trim().length>200)throw new DomainValidationError(`${field} is required`);return value.trim()}
