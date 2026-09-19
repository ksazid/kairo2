import { ResourceNotFoundError } from "@kairo/domain";
import type { AnalyticsRepository } from "@kairo/domain/analytics-service";
import type { InstagramInsightsReader, InstagramPublishingOperations } from "@kairo/domain/instagram-publisher";
import type { PublishingRepository } from "@kairo/domain/publishing-service";

export class RepositoryInstagramPublishingOperations implements InstagramPublishingOperations{
  constructor(private publishing:PublishingRepository,private wakePublisher:()=>Promise<void>=async()=>undefined){}
  command(accountId:string,brandId:string,publishCommandId:string){return this.publishing.getCommand(accountId,brandId,publishCommandId)}
  async enqueue(accountId:string,brandId:string,publishCommandId:string){const command=await this.publishing.getCommand(accountId,brandId,publishCommandId);if(!command)throw new ResourceNotFoundError("Instagram Publish Command not found");if(command.status==="scheduled")await this.wakePublisher()}
}

export class StoredInstagramInsightsReader implements InstagramInsightsReader{
  constructor(private analytics:AnalyticsRepository){}
  async getInstagramInsights(accountId:string,input:{brandId:string;publishedPostId:string}){const post=await this.analytics.getPublishedPost(accountId,input.brandId,input.publishedPostId);if(!post||post.channel!=="instagram")throw new ResourceNotFoundError("Instagram Published Post not found");const metrics=(await this.analytics.list(accountId,input.brandId)).filter(metric=>metric.publishedPostId===post.id).map(metric=>({name:metric.name,status:metric.status,value:metric.value,reason:metric.reason,capturedAt:metric.capturedAt}));return{publishedPostId:post.id,metrics}}
}
