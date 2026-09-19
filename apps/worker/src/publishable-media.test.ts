import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { StoredCreativePackage } from "./creative-renderer";
import {
  PublishableCreativeMediaService,
  type PublishableCreativeStorePort,
  type ReelEncoderPort,
} from "./publishable-media";

const scope = { workspaceId: "ws-1", brandId: "brand-1" } as const;
const lineage = { contentVersionId: "version-1" } as const;
const now = new Date("2026-08-15T12:00:00.000Z");
const pngA = new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
const pngB = new Uint8Array([137,80,78,71,13,10,26,10,5,6,7,8]);
const mp4 = new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,2,0,105,115,111,109,105,115,111,50]);
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

function carouselPackage(): StoredCreativePackage {
  return {
    format: "carousel",
    rendererVersion: "kairo-bitmap-v1",
    sourceFingerprint: "a".repeat(64),
    assets: [
      { objectId:"obj-slide-1", objectKey:"generated/a/carousel/one.png", role:"carousel-slide", filename:"carousel-01.png", contentType:"image/png", contentHash:sha(pngA), sizeBytes:pngA.byteLength, supportingClaimIds:["c1"], index:0 },
      { objectId:"obj-slide-2", objectKey:"generated/a/carousel/two.png", role:"carousel-slide", filename:"carousel-02.png", contentType:"image/png", contentHash:sha(pngB), sizeBytes:pngB.byteLength, supportingClaimIds:["c2"], index:1 },
    ],
  };
}

function reelPackage(): { pkg: StoredCreativePackage; manifest: Uint8Array } {
  const manifest = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    rendererVersion: "kairo-bitmap-v1",
    sourceFingerprint: "b".repeat(64),
    format: "reel",
    targetDurationSeconds: 5,
    hook: "Hook",
    caption: "Caption",
    cta: "CTA",
    supportingClaimIds: ["c1", "c2"],
    scenes: [
      { index:0, startSecond:0, endSecond:2, visual:"A", onScreenText:"A", voiceover:"A", supportingClaimIds:["c1"], storyboardFilename:"reel-scene-01.png", storyboardSha256:sha(pngA) },
      { index:1, startSecond:2, endSecond:5, visual:"B", onScreenText:"B", voiceover:"B", supportingClaimIds:["c2"], storyboardFilename:"reel-scene-02.png", storyboardSha256:sha(pngB) },
    ],
  }));
  return {
    manifest,
    pkg: {
      format: "reel",
      rendererVersion: "kairo-bitmap-v1",
      sourceFingerprint: "b".repeat(64),
      assets: [
        { objectId:"obj-frame-1", objectKey:"generated/b/reel/one.png", role:"reel-storyboard", filename:"reel-scene-01.png", contentType:"image/png", contentHash:sha(pngA), sizeBytes:pngA.byteLength, supportingClaimIds:["c1"], index:0 },
        { objectId:"obj-frame-2", objectKey:"generated/b/reel/two.png", role:"reel-storyboard", filename:"reel-scene-02.png", contentType:"image/png", contentHash:sha(pngB), sizeBytes:pngB.byteLength, supportingClaimIds:["c2"], index:1 },
        { objectId:"obj-manifest", objectKey:"generated/b/reel/reel-render.json", role:"reel-render-manifest", filename:"reel-render.json", contentType:"application/vnd.kairo.reel-render+json", contentHash:sha(manifest), sizeBytes:manifest.byteLength, supportingClaimIds:["c1","c2"], index:2 },
      ],
    },
  };
}

type RecordValue = { workspaceId:string; brandId:string; objectId:string; objectKey:string; contentType:string; contentHash:string; bytes:Uint8Array };
function storeWith(initial: RecordValue[], issue?: (input: Parameters<PublishableCreativeStorePort["issuePublishingUrl"]>[0]) => Promise<{url:string;expiresAt:string}>): PublishableCreativeStorePort {
  const records = new Map(initial.map(item => [item.objectId, item]));
  return {
    async readPrivateObject(input) {
      const item = records.get(input.objectId);
      if (!item || item.workspaceId !== input.workspaceId || item.brandId !== input.brandId) throw new Error("private object is outside requested scope");
      return { objectId:item.objectId, objectKey:item.objectKey, contentType:item.contentType, contentHash:item.contentHash, sizeBytes:item.bytes.byteLength, bytes:item.bytes };
    },
    async findPrivateObjectByKey(input) {
      const item = [...records.values()].find(value => value.workspaceId===input.workspaceId && value.brandId===input.brandId && value.objectKey===input.objectKey);
      return item ? { objectId:item.objectId, objectKey:item.objectKey, contentType:item.contentType, contentHash:item.contentHash, sizeBytes:item.bytes.byteLength } : null;
    },
    async putPrivateObject(input) {
      const objectId = `obj:${input.objectKey}`;
      records.set(objectId, { workspaceId:input.workspaceId, brandId:input.brandId, objectId, objectKey:input.objectKey, contentType:input.contentType, contentHash:input.contentHash, bytes:input.bytes });
      return { objectId };
    },
    issuePublishingUrl: issue ?? (async (input) => ({ url:`https://media.example.test/publish/${encodeURIComponent(input.objectId)}`, expiresAt:new Date(now.getTime()+input.ttlSeconds*1000).toISOString() })),
  };
}

function carouselRecords(): RecordValue[] {
  return [
    { workspaceId:scope.workspaceId, brandId:scope.brandId, objectId:"obj-slide-1", objectKey:"generated/a/carousel/one.png", contentType:"image/png", contentHash:sha(pngA), bytes:pngA },
    { workspaceId:scope.workspaceId, brandId:scope.brandId, objectId:"obj-slide-2", objectKey:"generated/a/carousel/two.png", contentType:"image/png", contentHash:sha(pngB), bytes:pngB },
  ];
}
function reelRecords(manifest: Uint8Array): RecordValue[] {
  return [
    { workspaceId:scope.workspaceId, brandId:scope.brandId, objectId:"obj-frame-1", objectKey:"generated/b/reel/one.png", contentType:"image/png", contentHash:sha(pngA), bytes:pngA },
    { workspaceId:scope.workspaceId, brandId:scope.brandId, objectId:"obj-frame-2", objectKey:"generated/b/reel/two.png", contentType:"image/png", contentHash:sha(pngB), bytes:pngB },
    { workspaceId:scope.workspaceId, brandId:scope.brandId, objectId:"obj-manifest", objectKey:"generated/b/reel/reel-render.json", contentType:"application/vnd.kairo.reel-render+json", contentHash:sha(manifest), bytes:manifest },
  ];
}

const unusedEncoder = (): ReelEncoderPort => ({ version:"ffmpeg-h264-v1", encode:vi.fn(async () => ({ contentType:"video/mp4" as const, bytes:mp4 })) });

describe("PublishableCreativeMediaService", () => {
  it("prepares ordered carousel images with Brand, Content Version and Claim lineage", async () => {
    const encoder = unusedEncoder();
    const service = new PublishableCreativeMediaService(storeWith(carouselRecords()), encoder, { clock:() => now, publishingTtlSeconds:600 });
    const result = await service.prepare(scope, carouselPackage(), lineage);
    expect(result.format).toBe("carousel");
    expect(result.workspaceId).toBe("ws-1");
    expect(result.brandId).toBe("brand-1");
    expect(result.contentVersionId).toBe("version-1");
    expect(result.supportingClaimIds).toEqual(["c1","c2"]);
    expect(result.mediaItems).toEqual([
      { kind:"image", url:"https://media.example.test/publish/obj-slide-1" },
      { kind:"image", url:"https://media.example.test/publish/obj-slide-2" },
    ]);
    expect(result.objects.map(item => item.objectId)).toEqual(["obj-slide-1","obj-slide-2"]);
    expect(result.objects.map(item => item.supportingClaimIds)).toEqual([["c1"],["c2"]]);
    expect(encoder.encode).not.toHaveBeenCalled();
  });

  it("encodes a verified Reel once, stores it privately and reuses the deterministic encoded object", async () => {
    const { pkg, manifest } = reelPackage();
    const encoder: ReelEncoderPort = { version:"ffmpeg-h264-v1", encode:vi.fn(async (input:Parameters<ReelEncoderPort["encode"]>[0]) => { expect(input.frames.map((frame) => frame.durationSeconds)).toEqual([2,3]); return { contentType:"video/mp4" as const, bytes:mp4 }; }) };
    const store = storeWith(reelRecords(manifest));
    const service = new PublishableCreativeMediaService(store, encoder, { clock:() => now, publishingTtlSeconds:600 });
    const first = await service.prepare(scope, pkg, lineage);
    const second = await service.prepare(scope, pkg, lineage);
    expect(first.mediaItems).toEqual([{ kind:"video", url:expect.stringContaining("https://media.example.test/publish/") }]);
    expect(first.encoderVersion).toBe("ffmpeg-h264-v1");
    expect(first.contentVersionId).toBe("version-1");
    expect(first.supportingClaimIds).toEqual(["c1","c2"]);
    expect(first.objects[0]?.supportingClaimIds).toEqual(["c1","c2"]);
    expect(first.objects[0]?.contentHash).toBe(sha(mp4));
    expect(second.objects[0]?.objectId).toBe(first.objects[0]?.objectId);
    expect(encoder.encode).toHaveBeenCalledTimes(1);
  });

  it("requires exact Content Version lineage before preparing media", async () => {
    const service = new PublishableCreativeMediaService(storeWith(carouselRecords()), unusedEncoder(), { clock:() => now });
    await expect(service.prepare(scope, carouselPackage(), { contentVersionId:"" })).rejects.toThrow(/contentVersionId/i);
  });

  it("binds delivered object hashes to the exact approved asset version",async()=>{const service=new PublishableCreativeMediaService(storeWith(carouselRecords()),unusedEncoder(),{clock:()=>now}),contentApproval={id:"content-approval-1",reviewId:"review-1",approverAccountId:"human-1",workspaceId:"ws-1",brandId:"brand-1",campaignId:"campaign-1",assetId:"asset-1",versionId:"version-1",version:1,destination:{channel:"instagram" as const,accountRef:"123"},approvedAt:now.toISOString()},prepared=await service.prepare(scope,carouselPackage(),{contentVersionId:"version-1"}),fingerprint=createHash("sha256").update(JSON.stringify(prepared.objects.map(object=>({objectId:object.objectId,contentHash:object.contentHash,contentType:object.contentType,sizeBytes:object.sizeBytes})))).digest("hex"),approved=await service.prepareApproved(scope,carouselPackage(),contentApproval,{id:"rendered-approval-1",workspaceId:"ws-1",brandId:"brand-1",assetId:"asset-1",contentVersionId:"version-1",assetVersionId:"carousel-version-7",mediaFingerprint:fingerprint,approvedAt:now.toISOString()});expect(approved).toMatchObject({approvalId:"rendered-approval-1",approvedAssetVersionId:"carousel-version-7",approvedMediaFingerprint:fingerprint});await expect(service.prepareApproved(scope,carouselPackage(),contentApproval,{id:"bad",workspaceId:"ws-1",brandId:"brand-1",assetId:"asset-1",contentVersionId:"version-1",assetVersionId:"carousel-version-8",mediaFingerprint:"0".repeat(64),approvedAt:now.toISOString()})).rejects.toThrow(/immutable approval/i)});

  it("fails before encoding when a private storyboard no longer matches its recorded hash", async () => {
    const { pkg, manifest } = reelPackage();
    const records = reelRecords(manifest);
    records[0] = { ...records[0]!, bytes:new Uint8Array([...pngA.slice(0,-1),99]) };
    const encoder = unusedEncoder();
    const service = new PublishableCreativeMediaService(storeWith(records), encoder, { clock:() => now });
    await expect(service.prepare(scope, pkg, lineage)).rejects.toThrow(/hash/i);
    expect(encoder.encode).not.toHaveBeenCalled();
  });

  it("rejects a Reel manifest with a timeline gap before invoking the encoder", async () => {
    const base = reelPackage();
    const parsed = JSON.parse(new TextDecoder().decode(base.manifest)) as { scenes:Array<{startSecond:number}> };
    parsed.scenes[1]!.startSecond = 2.5;
    const manifest = new TextEncoder().encode(JSON.stringify(parsed));
    const pkg:StoredCreativePackage = {
      ...base.pkg,
      assets: base.pkg.assets.map((asset) => asset.role === "reel-render-manifest" ? { ...asset, contentHash:sha(manifest), sizeBytes:manifest.byteLength } : asset),
    };
    const encoder = unusedEncoder();
    const service = new PublishableCreativeMediaService(storeWith(reelRecords(manifest)), encoder, { clock:() => now });
    await expect(service.prepare(scope, pkg, lineage)).rejects.toThrow(/continuous|gap|overlap/i);
    expect(encoder.encode).not.toHaveBeenCalled();
  });

  it("fails closed when another Brand tries to prepare this Brand's private objects", async () => {
    const service = new PublishableCreativeMediaService(storeWith(carouselRecords()), unusedEncoder(), { clock:() => now });
    await expect(service.prepare({ workspaceId:"ws-1", brandId:"brand-2" }, carouselPackage(), lineage)).rejects.toThrow(/scope/i);
  });

  it("rejects non-HTTPS publishing egress URLs", async () => {
    const store = storeWith(carouselRecords(), async () => ({ url:"http://media.example.test/file", expiresAt:new Date(now.getTime()+60_000).toISOString() }));
    const service = new PublishableCreativeMediaService(store, unusedEncoder(), { clock:() => now });
    await expect(service.prepare(scope, carouselPackage(), lineage)).rejects.toThrow(/https/i);
  });

  it("rejects private IPv6 publishing egress URLs", async () => {
    const store = storeWith(carouselRecords(), async () => ({ url:"https://[fd00::1]/file", expiresAt:new Date(now.getTime()+60_000).toISOString() }));
    const service = new PublishableCreativeMediaService(store, unusedEncoder(), { clock:() => now });
    await expect(service.prepare(scope, carouselPackage(), lineage)).rejects.toThrow(/private host/i);
  });

  it("rejects a store that grants a publishing URL beyond the configured TTL", async () => {
    const store = storeWith(carouselRecords(), async () => ({ url:"https://media.example.test/file", expiresAt:new Date(now.getTime()+3_600_000).toISOString() }));
    const service = new PublishableCreativeMediaService(store, unusedEncoder(), { clock:() => now, publishingTtlSeconds:600 });
    await expect(service.prepare(scope, carouselPackage(), lineage)).rejects.toThrow(/expiry|ttl/i);
  });

  it("rejects malformed encoder output before storing or exposing it", async () => {
    const { pkg, manifest } = reelPackage();
    const encoder: ReelEncoderPort = { version:"ffmpeg-h264-v1", encode:vi.fn(async () => ({ contentType:"video/mp4" as const, bytes:new Uint8Array([1,2,3,4,5,6,7,8]) })) };
    const store = storeWith(reelRecords(manifest));
    const service = new PublishableCreativeMediaService(store, encoder, { clock:() => now });
    await expect(service.prepare(scope, pkg, lineage)).rejects.toThrow(/mp4|ftyp/i);
  });
});
