import { describe, expect, it } from "vitest";
import { createMetricSnapshot, normalizeMetricSnapshot, summarizeMetricFreshness } from "./analytics";
import type { PublishedPost } from "./publishing";

const post: PublishedPost = { id:"post-1",workspaceId:"ws-1",brandId:"brand-1",campaignId:"campaign-1",assetId:"asset-1",versionId:"version-2",publishCommandId:"publish-1",channel:"linkedin",accountRef:"page-1",externalPostId:"urn:li:share:1",publishedAt:"2026-08-12T10:00:00Z" };

describe("VS-08 analytics domain",()=>{
  it("preserves complete lineage and reproducible normalization provenance",()=>{
    const snapshot=createMetricSnapshot({id:"snapshot-1",post,provider:"linkedin",capturedAt:"2026-08-13T10:00:00Z",raw:{impressions:1250,reactions:50,comments:8},providerRequestId:"request-1"});
    const metrics=normalizeMetricSnapshot(snapshot,{version:"linkedin-v1",supported:{impressions:"impressions",reactions:"reactions",comments:"comments"}});
    expect(snapshot).toMatchObject({workspaceId:"ws-1",brandId:"brand-1",publishedPostId:"post-1",versionId:"version-2",raw:{impressions:1250}});
    expect(metrics.find(x=>x.name==="impressions")).toMatchObject({status:"available",value:1250,sourceSnapshotId:"snapshot-1",transformationVersion:"linkedin-v1"});
  });

  it("labels unsupported metrics unavailable and never invents zero",()=>{
    const snapshot=createMetricSnapshot({id:"snapshot-1",post,provider:"linkedin",capturedAt:"2026-08-13T10:00:00Z",raw:{impressions:1250}});
    const metric=normalizeMetricSnapshot(snapshot,{version:"linkedin-v1",supported:{shares:"shares"}})[0]!;
    expect(metric).toMatchObject({name:"shares",status:"unavailable",reason:"provider-did-not-return"});
    expect(metric.value).toBeUndefined();
  });

  it("rejects invalid metric values rather than corrupting evidence",()=>{
    const snapshot=createMetricSnapshot({id:"snapshot-1",post,provider:"linkedin",capturedAt:"2026-08-13T10:00:00Z",raw:{reach:-1}});
    expect(()=>normalizeMetricSnapshot(snapshot,{version:"linkedin-v1",supported:{reach:"reach"}})).toThrow("reach must be a non-negative finite number");
  });

  it("distinguishes fresh and stale observations",()=>{
    expect(summarizeMetricFreshness("2026-08-13T10:00:00Z","2026-08-13T11:00:00Z",7200)).toEqual({status:"fresh",ageSeconds:3600});
    expect(summarizeMetricFreshness("2026-08-13T10:00:00Z","2026-08-13T13:00:00Z",7200)).toEqual({status:"stale",ageSeconds:10800});
  });
});
