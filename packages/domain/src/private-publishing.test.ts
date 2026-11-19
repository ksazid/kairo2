import { describe, expect, it, vi } from 'vitest';
import { PublishingService } from './publishing-service';

describe('private library image scheduling', () => {
  it('resolves only approved version references under the caller Brand and keeps retries idempotent', async () => {
    const approval = {id:'approval',workspaceId:'ws',brandId:'brand',campaignId:'campaign',assetId:'asset',versionId:'v1',version:1,destination:{channel:'instagram',accountRef:'ig'},approvedAt:'2026-01-01T00:00:00Z',approverAccountId:'user'};
    const channel = {id:'channel',workspaceId:'ws',brandId:'brand',channel:'instagram',accountRef:'ig',status:'connected',capabilities:['publish-image']};
    let saved:any;
    const resolvePrivateMedia = vi.fn(async () => [{kind:'image',url:'https://storage.example/private.jpg?signature=short-lived'}]);
    const repo:any = {getChannelAccount:async()=>channel,getCommandByApproval:async()=>saved,resolvePrivateMedia,saveCommand:async(_:string,c:any)=>(saved=c)};
    const service = new PublishingService({getBrandForAccount:async()=>({id:'brand',workspaceId:'ws'})} as any,{getCampaign:async()=>({assets:[{asset:{id:'asset'},versions:[{id:'v1',libraryAssetRefs:[{kind:'image',libraryAssetId:'private-image'}]}]}]})} as any,{getApprovalForDestination:async()=>approval} as any,repo,()=>new Date('2026-01-01T00:00:00Z'));
    const input = {channelAccountId:'channel',contentType:'image' as const,scheduledFor:'2026-01-01T00:02:00Z'};
    const command = await service.schedule('user','brand','campaign','asset',input);
    expect(resolvePrivateMedia).toHaveBeenCalledWith('user','brand',['private-image'],input.scheduledFor);
    expect(command.mediaItems).toHaveLength(1);
    expect(await service.schedule('user','brand','campaign','asset',input)).toEqual(command);
    expect(resolvePrivateMedia).toHaveBeenCalledTimes(1);
  });
});
