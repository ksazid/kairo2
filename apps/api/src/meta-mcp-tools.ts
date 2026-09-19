import type { MetaMcpToolDefinition, MetaMcpToolName, MetaMcpToolResultMap } from "@kairo/contracts";
import type { InstagramInsightsReader, InstagramPublisher } from "@kairo/domain/instagram-publisher";

const publishSchema={type:"object" as const,additionalProperties:false as const,required:["brandId","publishCommandId"] as const,properties:{brandId:{type:"string" as const,minLength:1,maxLength:200},publishCommandId:{type:"string" as const,minLength:1,maxLength:200}}};
const insightsSchema={type:"object" as const,additionalProperties:false as const,required:["brandId","publishedPostId"] as const,properties:{brandId:{type:"string" as const,minLength:1,maxLength:200},publishedPostId:{type:"string" as const,minLength:1,maxLength:200}}};
export const META_MCP_TOOL_DEFINITIONS:readonly MetaMcpToolDefinition[]=[
  {name:"publish_reel",description:"Queue an approved Instagram Reel for publishing.",inputSchema:publishSchema},
  {name:"publish_carousel",description:"Queue an approved Instagram carousel for publishing.",inputSchema:publishSchema},
  {name:"publish_image",description:"Queue an approved Instagram image for publishing.",inputSchema:publishSchema},
  {name:"get_publish_status",description:"Read the verified status of an Instagram publish command.",inputSchema:publishSchema},
  {name:"get_instagram_insights",description:"Read stored Instagram insights for a published post.",inputSchema:insightsSchema},
] as const;

export class MetaMcpToolHandler{
  constructor(private publisher:InstagramPublisher,private insights:InstagramInsightsReader){}
  async invoke<T extends MetaMcpToolName>(accountId:string,name:T,raw:unknown):Promise<MetaMcpToolResultMap[T]>{
    const actor=required(accountId,"accountId"),input=record(raw),brandId=required(input.brandId,"brandId");
    if(name==="get_instagram_insights"){const publishedPostId=required(input.publishedPostId,"publishedPostId");rejectExtras(input,["brandId","publishedPostId"]);return await this.insights.getInstagramInsights(actor,{brandId,publishedPostId}) as MetaMcpToolResultMap[T]}
    const publishCommandId=required(input.publishCommandId,"publishCommandId");rejectExtras(input,["brandId","publishCommandId"]);
    if(name==="get_publish_status")return await this.publisher.getPublishStatus(actor,{brandId,publishCommandId}) as MetaMcpToolResultMap[T];
    const kinds={publish_reel:"reel",publish_carousel:"carousel",publish_image:"image"} as const;
    const kind=kinds[name as keyof typeof kinds];if(!kind)throw new Error("Meta MCP tool is not supported");
    return await this.publisher.publish(actor,{brandId,publishCommandId,kind}) as MetaMcpToolResultMap[T];
  }
}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Meta MCP tool input must be an object");return value as Record<string,unknown>}
function required(value:unknown,field:string){if(typeof value!=="string"||!value.trim()||value.trim().length>200)throw new Error(`${field} is required`);return value.trim()}
function rejectExtras(value:Record<string,unknown>,allowed:string[]){const extra=Object.keys(value).filter(key=>!allowed.includes(key));if(extra.length)throw new Error(`Meta MCP tool input contains unsupported fields: ${extra.join(", ")}`)}
