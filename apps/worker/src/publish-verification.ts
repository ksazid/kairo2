import { markPublishProcessing, verifyPublishOutcome, type PublishCommand } from "@kairo/domain/publishing";

export type ProviderVerificationResult =
  | { status:"processing" }
  | { status:"published"; publishId:string; publishedUrl:string }
  | { status:"failed"; failureReason:string };

export interface PublishVerificationPort { getStatus(input:{channel:PublishCommand["channel"];accountRef:string;containerId:string}):Promise<ProviderVerificationResult> }

export class BoundedPublishVerifier {
  constructor(private provider:PublishVerificationPort,private policy:{maxChecks:number;intervalMs:number;sleep(ms:number):Promise<void>},private now:()=>Date=()=>new Date()) {
    if(!Number.isInteger(policy.maxChecks)||policy.maxChecks<1||policy.maxChecks>100)throw new Error("maxChecks is invalid");
    if(!Number.isInteger(policy.intervalMs)||policy.intervalMs<0||policy.intervalMs>60_000)throw new Error("intervalMs is invalid");
  }
  async verify(command:PublishCommand,containerId:string):Promise<PublishCommand>{
    let current=markPublishProcessing(command,{containerId,at:this.now().toISOString()});
    for(let check=0;check<this.policy.maxChecks;check+=1){
      const result=await this.provider.getStatus({channel:current.channel,accountRef:current.accountRef,containerId});
      if(result.status==="published")return verifyPublishOutcome(current,{outcome:"published",publishId:result.publishId,publishedUrl:result.publishedUrl,at:this.now().toISOString()});
      if(result.status==="failed")return verifyPublishOutcome(current,{outcome:"failed",failureReason:result.failureReason,at:this.now().toISOString()});
      if(check<this.policy.maxChecks-1)await this.policy.sleep(this.policy.intervalMs);
    }
    return verifyPublishOutcome(current,{outcome:"failed",failureReason:"provider-processing-timeout",at:this.now().toISOString()});
  }
}
