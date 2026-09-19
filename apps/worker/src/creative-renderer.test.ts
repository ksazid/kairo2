import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { CarouselPlan, ReelPlan } from "@kairo/domain/creative-formats";
import {
  BitmapCarouselRenderer,
  carouselSourceFingerprint,
  CreativeAssetProductionService,
  INSTAGRAM_CAROUSEL_PRESET,
  renderCreativePlan,
  type CarouselRendererPort,
  type CreativeObjectStorePort,
} from "./creative-renderer";

const carousel: CarouselPlan = {
  format: "carousel",
  coverHook: "Three things that changed",
  slides: [
    { headline: "First change", body: "A concise explanation for the audience.", supportingClaimIds: ["c1"] },
    { headline: "Second change", body: "Another evidence-linked explanation.", supportingClaimIds: ["c2"] },
    { headline: "What to do next", body: "Turn the evidence into a practical action.", supportingClaimIds: ["c1", "c2"] },
  ],
  caption: "A useful carousel caption.",
  cta: "Save this for later.",
  supportingClaimIds: ["c1", "c2"],
};

const reel: ReelPlan = {
  format: "reel",
  hook: "This changed faster than expected",
  targetDurationSeconds: 12,
  scenes: [
    { startSecond: 0, endSecond: 5, visual: "Close crop of the product", onScreenText: "The old assumption", voiceover: "Start with the established assumption.", supportingClaimIds: ["c1"] },
    { startSecond: 5, endSecond: 12, visual: "Simple comparison graphic", onScreenText: "What changed", voiceover: "Explain the verified change and what it means.", supportingClaimIds: ["c2"] },
  ],
  caption: "A concise Reel caption.",
  cta: "Follow for the next update.",
  supportingClaimIds: ["c1", "c2"],
};

const tinySquare = { width: 180, height: 180 } as const;
const tinyVertical = { width: 180, height: 320 } as const;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

describe("creative renderer", () => {
  it("renders a deterministic PNG for every carousel slide", () => {
    const a = renderCreativePlan(carousel, tinySquare);
    const b = renderCreativePlan(carousel, tinySquare);
    expect(a.format).toBe("carousel");
    expect(a.artifacts).toHaveLength(3);
    expect(a.sourceFingerprint).toBe(b.sourceFingerprint);
    expect(a.artifacts.map((item) => item.sha256)).toEqual(b.artifacts.map((item) => item.sha256));
    for (const artifact of a.artifacts) {
      expect(artifact.contentType).toBe("image/png");
      expect(Array.from(artifact.bytes.slice(0, 8))).toEqual(pngSignature);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.supportingClaimIds.length).toBeGreaterThan(0);
    }
  });

  it("defaults carousel output to the Instagram 4:5 preset", () => {
    const rendered = renderCreativePlan(carousel);
    const first = rendered.artifacts[0]!;
    expect(pngDimensions(first.bytes)).toEqual(INSTAGRAM_CAROUSEL_PRESET);
    expect(first.layoutMetrics?.canvas).toEqual(INSTAGRAM_CAROUSEL_PRESET);
    expect(first.layoutMetrics?.safeArea).toEqual({ x: 81, y: 81, width: 918, height: 1188 });
  });

  it("renders approved Brand imagery and logo assets with bounded font selection", () => {
    const logo=solidRaster("private-logo-object-1",2,2,[220,20,40,255]);
    const imagery=solidRaster("approved-brand-image-1",2,2,[20,80,180,255]);
    const rendered = renderCreativePlan(carousel, {
      ...tinySquare,
      headingFontLabel: "Brand Display",
      bodyFontLabel: "Brand Sans",
      logoAssetId: "private-logo-object-1",
      logoAsset:logo,
      imageryAsset:imagery,
      logoPlacement: "bottom-right",
    });
    expect(rendered.artifacts[0]?.layoutMetrics).toMatchObject({
      headingFontLabel: "Brand Display",
      bodyFontLabel: "Brand Sans",
      logoAssetId: "private-logo-object-1",
      logoPlacement: "bottom-right",
      logoBounds: { x: 143, y: 151, width: 24, height: 16 },
      palette: { background: [247, 247, 244], foreground: [24, 24, 24], accent: [72, 92, 75] },
    });
    expect(rendered.artifacts[0]?.layoutMetrics?.text.map(item => item.role)).toEqual(["cover", "headline", "body"]);
    expect(rendered.artifacts[0]?.layoutMetrics?.textOccupiedRatio).toBeGreaterThan(0);
    expect(rendered.sourceFingerprint).not.toBe(renderCreativePlan(carousel,{...tinySquare,logoAsset:logo,logoPlacement:"bottom-right"}).sourceFingerprint);
    expect(() => renderCreativePlan(carousel, { ...tinySquare, logoAssetId: " ", logoPlacement: "bottom-right" })).toThrow(/logoAssetId/i);
    expect(() => renderCreativePlan(carousel, { ...tinySquare, headingFontAssetId:"unapproved-font" as never })).toThrow(/unsupported/i);
    expect(() => renderCreativePlan(carousel, { ...tinySquare, logoAsset:{...logo,approved:false as true},logoPlacement:"bottom-right" })).toThrow(/approved/i);
  });

  it("renders a deterministic Reel storyboard and canonical timed manifest", () => {
    const a = renderCreativePlan(reel, tinyVertical);
    const b = renderCreativePlan(reel, tinyVertical);
    expect(a.format).toBe("reel");
    expect(a.artifacts.filter((item) => item.role === "reel-storyboard")).toHaveLength(2);
    const manifest = a.artifacts.find((item) => item.role === "reel-render-manifest");
    expect(manifest?.contentType).toBe("application/vnd.kairo.reel-render+json");
    const decoded = JSON.parse(new TextDecoder().decode(manifest!.bytes));
    expect(decoded.targetDurationSeconds).toBe(12);
    expect(decoded.scenes).toHaveLength(2);
    expect(decoded.scenes[1].startSecond).toBe(5);
    expect(a.artifacts.map((item) => item.sha256)).toEqual(b.artifacts.map((item) => item.sha256));
  });

  it("rejects unsafe rendering dimensions", () => {
    expect(() => renderCreativePlan(carousel, { width: 0, height: 180 })).toThrow(/width/i);
    expect(() => renderCreativePlan(reel, { width: 180, height: 5000 })).toThrow(/height/i);
  });

  it("fails closed rather than silently truncating approved copy", () => {
    const crowded: CarouselPlan = {
      ...carousel,
      slides: [
        { ...carousel.slides[0]!, body: "evidence ".repeat(180).trim() },
        carousel.slides[1]!,
        carousel.slides[2]!,
      ],
    };
    expect(() => renderCreativePlan(crowded, tinySquare)).toThrow(/does not fit/i);
  });

  it("fails closed for glyphs the deterministic bitmap renderer cannot faithfully represent", () => {
    const multilingual: CarouselPlan = { ...carousel, coverHook: "Umrah تحديث" };
    expect(() => renderCreativePlan(multilingual, tinySquare)).toThrow(/unsupported character/i);
  });
});

describe("CreativeAssetProductionService", () => {
  it("uses a replaceable carousel renderer port beneath production", async () => {
    const delegate = new BitmapCarouselRenderer();
    const renderer: CarouselRendererPort = {
      version: "test-carousel-engine-v1",
      render(plan, theme) {
        const result = delegate.render(plan, theme);
        return { ...result, rendererVersion: this.version, sourceFingerprint: carouselSourceFingerprint(plan, theme, this.version) };
      },
    };
    const store: CreativeObjectStorePort = { async putPrivateObject(input) { return { objectId: input.objectKey }; } };
    const produced = await new CreativeAssetProductionService(store, { carouselRenderer: renderer }).produce(
      { workspaceId: "ws-1", brandId: "brand-1" },
      carousel,
      tinySquare,
    );
    expect(produced.rendererVersion).toBe("test-carousel-engine-v1");
    expect(produced.assets.filter(asset=>asset.role==="carousel-slide").every(asset => asset.layoutMetrics?.canvas.width === 180)).toBe(true);
    expect(produced.assets.find(asset=>asset.role==="carousel-thumbnail")).toMatchObject({filename:"carousel-thumbnail.png",index:0});
  });

  it.each([
    ["format", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, format: "reel" as const })],
    ["version", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, rendererVersion: "wrong-version" })],
    ["fingerprint", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, sourceFingerprint: "0".repeat(64) })],
    ["artifact count", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.slice(1) })],
    ["PNG", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index ? item : { ...item, contentType: "application/vnd.kairo.reel-render+json" as const }) })],
    ["indexes", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index === 1 ? { ...item, index: 0 } : item) })],
    ["duplicate filename", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index === 1 ? { ...item, filename: pkg.artifacts[0]!.filename } : item) })],
    ["truncated PNG", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index ? item : rehash({ ...item, bytes: item.bytes.slice(0, 32) })) })],
    ["fabricated PNG", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => { if(index)return item;const bytes=item.bytes.slice();bytes[40]=(bytes[40]??0)^0xff;return rehash({ ...item, bytes }); }) })],
    ["unsupported IHDR", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index ? item : rehash({ ...item, bytes: mutateFirstPngChunk(item.bytes,"IHDR",data=>{data[8]=16;return data}) })) })],
    ["corrupt IDAT", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index ? item : rehash({ ...item, bytes: mutateFirstPngChunk(item.bytes,"IDAT",data=>{data[0]=(data[0]??0)^0xff;return data}) })) })],
    ["invalid scanline filter", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index ? item : rehash({ ...item, bytes: mutateFirstPngChunk(item.bytes,"IDAT",data=>{const raw=inflateSync(data);raw[0]=5;return deflateSync(raw)}) })) })],
    ["Claim lineage", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index ? item : { ...item, supportingClaimIds: ["c2"] }) })],
    ["layout", (pkg: ReturnType<BitmapCarouselRenderer["render"]>) => ({ ...pkg, artifacts: pkg.artifacts.map((item, index) => index ? item : { ...item, layoutMetrics: undefined }) })],
  ])("rejects malformed injected renderer %s before storage", async (_label, mutate) => {
    const version = "malformed-test-v1", delegate = new BitmapCarouselRenderer();
    const renderer: CarouselRendererPort = { version, render(plan, theme) { const valid = delegate.render(plan, theme); return mutate({ ...valid, rendererVersion: version, sourceFingerprint: carouselSourceFingerprint(plan, theme, version) }); } };
    const store: CreativeObjectStorePort = { putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })) };
    await expect(new CreativeAssetProductionService(store, { carouselRenderer: renderer }).produce({ workspaceId: "ws-1", brandId: "brand-1" }, carousel, tinySquare)).rejects.toThrow();
    expect(store.putPrivateObject).not.toHaveBeenCalled();
  });

  it("stores generated media privately with stable scoped object keys", async () => {
    const puts: Array<{ objectKey: string; workspaceId: string; brandId: string; contentHash: string }> = [];
    const store: CreativeObjectStorePort = {
      async putPrivateObject(input) {
        puts.push({ objectKey: input.objectKey, workspaceId: input.workspaceId, brandId: input.brandId, contentHash: input.contentHash });
        return { objectId: `obj:${input.objectKey}` };
      },
    };
    const service = new CreativeAssetProductionService(store);
    const first = await service.produce({ workspaceId: "ws-1", brandId: "brand-1" }, carousel, tinySquare);
    const firstKeys = puts.map((item) => item.objectKey);
    puts.length = 0;
    const second = await service.produce({ workspaceId: "ws-1", brandId: "brand-1" }, carousel, tinySquare);
    expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
    expect(puts.map((item) => item.objectKey)).toEqual(firstKeys);
    expect(first.assets).toHaveLength(4);
    expect(first.assets.find((item)=>item.role==="carousel-thumbnail")?.objectKey).toContain(first.sourceFingerprint);
    expect(first.assets.every((item) => item.objectId.startsWith("obj:generated/"))).toBe(true);
  });

  it("keeps content deterministic while scoping stored identity per Brand", async () => {
    const keys: string[] = [];
    const store: CreativeObjectStorePort = { async putPrivateObject(input) { keys.push(input.objectKey); return { objectId: input.objectKey }; } };
    const service = new CreativeAssetProductionService(store);
    const one = await service.produce({ workspaceId: "ws-1", brandId: "brand-1" }, reel, tinyVertical);
    const firstHashes = one.assets.map((item) => item.contentHash);
    keys.length = 0;
    const two = await service.produce({ workspaceId: "ws-1", brandId: "brand-2" }, reel, tinyVertical);
    expect(two.assets.map((item) => item.contentHash)).toEqual(firstHashes);
    expect(two.assets.map((item) => item.objectKey)).not.toEqual(one.assets.map((item) => item.objectKey));
  });

  it("fails closed when a generated artifact exceeds the configured bound", async () => {
    const store: CreativeObjectStorePort = { putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })) };
    const service = new CreativeAssetProductionService(store, { maxArtifactBytes: 16 });
    await expect(service.produce({ workspaceId: "ws-1", brandId: "brand-1" }, carousel, tinySquare)).rejects.toThrow(/artifact size/i);
    expect(store.putPrivateObject).not.toHaveBeenCalled();
  });
});

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
function solidRaster(id:string,width:number,height:number,rgba:readonly[number,number,number,number]){const pixels=new Uint8Array(width*height*4);for(let index=0;index<pixels.length;index+=4)pixels.set(rgba,index);return{id,approved:true as const,width,height,channels:4 as const,pixels}}
function rehash<T extends { bytes: Uint8Array; sha256: string }>(artifact: T): T { return { ...artifact, sha256: createHash("sha256").update(artifact.bytes).digest("hex") }; }
function mutateFirstPngChunk(bytes:Uint8Array,target:string,mutate:(data:Buffer)=>Uint8Array):Uint8Array{
  const output:Buffer[]=[Buffer.from(bytes.slice(0,8))];let offset=8,changed=false;
  while(offset<bytes.byteLength){const view=new DataView(bytes.buffer,bytes.byteOffset+offset,bytes.byteLength-offset),length=view.getUint32(0),type=Buffer.from(bytes.slice(offset+4,offset+8)).toString("ascii"),end=offset+12+length;if(end>bytes.byteLength)throw new Error("test PNG is malformed");
    if(!changed&&type===target){output.push(testPngChunk(type,mutate(Buffer.from(bytes.slice(offset+8,offset+8+length)))));changed=true;}else output.push(Buffer.from(bytes.slice(offset,end)));offset=end;
  }
  if(!changed)throw new Error(`test PNG lacks ${target}`);return Buffer.concat(output);
}
function testPngChunk(type:string,data:Uint8Array):Buffer{const typeBytes=Buffer.from(type,"ascii"),body=Buffer.from(data),out=Buffer.alloc(12+body.length);out.writeUInt32BE(body.length,0);typeBytes.copy(out,4);body.copy(out,8);out.writeUInt32BE(testCrc32(Buffer.concat([typeBytes,body])),8+body.length);return out}
function testCrc32(data:Uint8Array):number{let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0}
