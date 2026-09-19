import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import {
  validateCarouselPlan,
  validateReelPlan,
  type MarketingCreativePlan,
} from "@kairo/domain/creative-formats";

export const CREATIVE_RENDERER_VERSION = "kairo-bitmap-v1";
export const INSTAGRAM_CAROUSEL_PRESET = Object.freeze({ width: 1080, height: 1350 } as const);
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);

type Rgb = readonly [number, number, number];
export interface ApprovedRasterAsset { id:string; approved:true; width:number; height:number; channels:3|4; pixels:Uint8Array }
export interface CreativeRenderTheme {
  width?: number;
  height?: number;
  background?: Rgb;
  foreground?: Rgb;
  accent?: Rgb;
  headingFontLabel?: string;
  bodyFontLabel?: string;
  logoAssetId?: string;
  logoAsset?: ApprovedRasterAsset;
  imageryAsset?: ApprovedRasterAsset;
  headingFontAssetId?: "kairo-bitmap-regular";
  bodyFontAssetId?: "kairo-bitmap-regular";
  logoPlacement?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "none";
}
export interface CreativeTextLayoutMetric { role: "cover" | "headline" | "body" | "cta"; alignment: "left" | "center" | "right"; lineCount: number; characterCount: number; x: number; y: number; width: number; height: number }
export interface CreativeLayoutMetrics {
  canvas: { width: number; height: number };
  safeArea: { x: number; y: number; width: number; height: number };
  palette: { background: Rgb; foreground: Rgb; accent: Rgb };
  text: CreativeTextLayoutMetric[];
  textOccupiedRatio: number;
  logoPlacement: NonNullable<CreativeRenderTheme["logoPlacement"]>;
  logoAssetId?: string;
  logoBounds?: { x: number; y: number; width: number; height: number };
  headingFontLabel: string;
  bodyFontLabel: string;
}
export type CreativeArtifactRole = "carousel-slide" | "carousel-thumbnail" | "reel-storyboard" | "reel-thumbnail" | "reel-render-manifest";
export interface RenderedCreativeArtifact {
  role: CreativeArtifactRole;
  filename: string;
  contentType: "image/png" | "application/vnd.kairo.reel-render+json";
  bytes: Uint8Array;
  sha256: string;
  supportingClaimIds: string[];
  index: number;
  layoutMetrics?: CreativeLayoutMetrics;
}
export interface CreativeRenderPackage {
  format: "carousel" | "reel";
  rendererVersion: string;
  sourceFingerprint: string;
  artifacts: RenderedCreativeArtifact[];
}
export interface CreativeScope { workspaceId: string; brandId: string }
export interface CreativeObjectStorePort {
  putPrivateObject(input: {
    workspaceId: string;
    brandId: string;
    objectKey: string;
    contentType: string;
    contentHash: string;
    bytes: Uint8Array;
  }): Promise<{ objectId: string }>;
}
export interface StoredCreativeAsset {
  objectId: string;
  objectKey: string;
  role: CreativeArtifactRole;
  filename: string;
  contentType: string;
  contentHash: string;
  sizeBytes: number;
  supportingClaimIds: string[];
  index: number;
  layoutMetrics?: CreativeLayoutMetrics;
}
export interface StoredCreativePackage {
  format: "carousel" | "reel";
  rendererVersion: string;
  sourceFingerprint: string;
  assets: StoredCreativeAsset[];
}

export function renderCreativePlan(plan: MarketingCreativePlan, theme: CreativeRenderTheme = {}): CreativeRenderPackage {
  if (plan.format === "carousel") return DEFAULT_CAROUSEL_RENDERER.render(validateCarouselPlan(plan), normalizeTheme("carousel", theme));
  return renderReel(validateReelPlan(plan), normalizeTheme("reel", theme));
}

export interface CarouselRendererPort {
  readonly version: string;
  render(plan: ReturnType<typeof validateCarouselPlan>, theme: NormalizedCreativeRenderTheme): CreativeRenderPackage;
}

export class BitmapCarouselRenderer implements CarouselRendererPort {
  readonly version = CREATIVE_RENDERER_VERSION;
  render(plan: ReturnType<typeof validateCarouselPlan>, theme: NormalizedCreativeRenderTheme): CreativeRenderPackage {
    return renderCarouselBitmap(plan, theme, this.version);
  }
}

export function carouselSourceFingerprint(plan: ReturnType<typeof validateCarouselPlan>, theme: NormalizedCreativeRenderTheme, rendererVersion: string): string {
  return fingerprint(plan, theme, label(rendererVersion, "rendererVersion"));
}

const DEFAULT_CAROUSEL_RENDERER: CarouselRendererPort = new BitmapCarouselRenderer();

export class CreativeAssetProductionService {
  private readonly maxArtifactBytes: number;
  private readonly maxPackageBytes: number;
  private readonly carouselRenderer: CarouselRendererPort;
  constructor(private readonly store: CreativeObjectStorePort, options: { maxArtifactBytes?: number; maxPackageBytes?: number; carouselRenderer?: CarouselRendererPort } = {}) {
    this.maxArtifactBytes = boundedPositive(options.maxArtifactBytes ?? 12 * 1024 * 1024, "maxArtifactBytes", 128 * 1024 * 1024);
    this.maxPackageBytes = boundedPositive(options.maxPackageBytes ?? 80 * 1024 * 1024, "maxPackageBytes", 512 * 1024 * 1024);
    this.carouselRenderer = validateCarouselRenderer(options.carouselRenderer ?? DEFAULT_CAROUSEL_RENDERER);
  }
  async produce(scopeInput: CreativeScope, plan: MarketingCreativePlan, theme: CreativeRenderTheme = {}): Promise<StoredCreativePackage> {
    const scope = validateScope(scopeInput);
    const rendered = plan.format === "carousel"
      ? this.carouselRenderer.render(validateCarouselPlan(plan), normalizeTheme("carousel", theme))
      : renderCreativePlan(plan, theme);
    if (plan.format === "carousel") validateCarouselRendererOutput(rendered, validateCarouselPlan(plan), normalizeTheme("carousel", theme), this.carouselRenderer.version);
    const artifacts=[...rendered.artifacts,thumbnailArtifact(rendered)];
    let total = 0;
    for (const artifact of artifacts) {
      if (artifact.bytes.byteLength > this.maxArtifactBytes) throw new Error("Generated artifact size exceeds configured artifact size bound");
      total += artifact.bytes.byteLength;
    }
    if (total > this.maxPackageBytes) throw new Error("Generated package size exceeds configured package size bound");
    const scopeKey = sha256(Buffer.from(`${scope.workspaceId}\u0000${scope.brandId}`)).slice(0, 24);
    const assets: StoredCreativeAsset[] = [];
    const objectKeys = new Set<string>();
    for (const artifact of artifacts) {
      const objectKey = `generated/${scopeKey}/${rendered.format}/${rendered.sourceFingerprint}/${artifact.filename}`;
      if (objectKeys.has(objectKey)) throw new Error("Generated creative object keys must be unique");
      objectKeys.add(objectKey);
      const stored = await this.store.putPrivateObject({
        workspaceId: scope.workspaceId,
        brandId: scope.brandId,
        objectKey,
        contentType: artifact.contentType,
        contentHash: artifact.sha256,
        bytes: artifact.bytes,
      });
      if (!stored?.objectId || typeof stored.objectId !== "string") throw new Error("Generated media store did not return an object identifier");
      assets.push({
        objectId: stored.objectId,
        objectKey,
        role: artifact.role,
        filename: artifact.filename,
        contentType: artifact.contentType,
        contentHash: artifact.sha256,
        sizeBytes: artifact.bytes.byteLength,
        supportingClaimIds: [...artifact.supportingClaimIds],
        index: artifact.index,
        ...(artifact.layoutMetrics ? { layoutMetrics: artifact.layoutMetrics } : {}),
      });
    }
    return { format: rendered.format, rendererVersion: rendered.rendererVersion, sourceFingerprint: rendered.sourceFingerprint, assets };
  }
}

export interface NormalizedCreativeRenderTheme { width: number; height: number; background: Rgb; foreground: Rgb; accent: Rgb; headingFontLabel: string; bodyFontLabel: string; headingFontAssetId:"kairo-bitmap-regular"; bodyFontAssetId:"kairo-bitmap-regular"; logoPlacement: NonNullable<CreativeRenderTheme["logoPlacement"]>; logoAssetId?: string; logoAsset?:ApprovedRasterAsset; imageryAsset?:ApprovedRasterAsset }
function normalizeTheme(format: "carousel" | "reel", input: CreativeRenderTheme): NormalizedCreativeRenderTheme {
  const width = dimension(input.width ?? 1080, "width", 64, 2160);
  const height = dimension(input.height ?? (format === "carousel" ? INSTAGRAM_CAROUSEL_PRESET.height : 1920), "height", 64, 3840);
  const logoAsset=input.logoAsset?approvedRaster(input.logoAsset,"logoAsset"):undefined,imageryAsset=input.imageryAsset?approvedRaster(input.imageryAsset,"imageryAsset"):undefined,placement=logoPlacement(input.logoPlacement ?? "none");
  const logoAssetId=input.logoAssetId?label(input.logoAssetId,"logoAssetId"):logoAsset?.id;
  if(logoAssetId&&!logoAsset)throw new Error("Creative logoAssetId requires an approved resolved logoAsset");
  if(logoAsset&&logoAssetId!==logoAsset.id)throw new Error("Creative logoAssetId does not match the approved logoAsset");
  if(logoAsset&&placement==="none")throw new Error("Creative approved logoAsset requires a visible logoPlacement");
  return {
    width,
    height,
    background: color(input.background ?? [247,247,244], "background"),
    foreground: color(input.foreground ?? [24,24,24], "foreground"),
    accent: color(input.accent ?? [72,92,75], "accent"),
    headingFontLabel: label(input.headingFontLabel ?? "Kairo Bitmap", "headingFontLabel"),
    bodyFontLabel: label(input.bodyFontLabel ?? "Kairo Bitmap", "bodyFontLabel"),
    headingFontAssetId:fontAsset(input.headingFontAssetId??"kairo-bitmap-regular","headingFontAssetId"),
    bodyFontAssetId:fontAsset(input.bodyFontAssetId??"kairo-bitmap-regular","bodyFontAssetId"),
    logoPlacement: placement,
    ...(logoAssetId ? { logoAssetId } : {}),
    ...(logoAsset?{logoAsset}:{}),
    ...(imageryAsset?{imageryAsset}:{}),
  };
}
function fontAsset(value:unknown,field:string):"kairo-bitmap-regular"{if(value!=="kairo-bitmap-regular")throw new Error(`Creative ${field} is unsupported`);return value}
function approvedRaster(value:ApprovedRasterAsset,field:string):ApprovedRasterAsset{if(!value||value.approved!==true)throw new Error(`Creative ${field} must be approved`);const id=label(value.id,`${field}.id`),width=dimension(value.width,`${field}.width`,1,4096),height=dimension(value.height,`${field}.height`,1,4096);if(value.channels!==3&&value.channels!==4)throw new Error(`Creative ${field}.channels is invalid`);if(!(value.pixels instanceof Uint8Array)||value.pixels.byteLength!==width*height*value.channels)throw new Error(`Creative ${field}.pixels are invalid`);return{id,approved:true,width,height,channels:value.channels,pixels:value.pixels.slice()}}
function label(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim() || value.trim().length > 200) throw new Error(`Creative ${field} is invalid`); return value.trim(); }
function logoPlacement(value: unknown): NonNullable<CreativeRenderTheme["logoPlacement"]> { if (!["top-left","top-right","bottom-left","bottom-right","none"].includes(String(value))) throw new Error("Creative logoPlacement is invalid"); return value as NonNullable<CreativeRenderTheme["logoPlacement"]>; }
function validateCarouselRenderer(value: CarouselRendererPort): CarouselRendererPort { if (!value || typeof value.render !== "function" || typeof value.version !== "string" || !value.version.trim() || value.version.length > 200) throw new Error("Carousel renderer is invalid"); return value; }
function validateCarouselRendererOutput(rendered: CreativeRenderPackage, plan: ReturnType<typeof validateCarouselPlan>, theme: NormalizedCreativeRenderTheme, rendererVersion: string): void {
  if (!rendered || rendered.format !== "carousel") throw new Error("Carousel renderer returned an invalid format");
  if (rendered.rendererVersion !== rendererVersion) throw new Error("Carousel renderer version does not match the configured engine");
  if (rendered.sourceFingerprint !== carouselSourceFingerprint(plan, theme, rendererVersion)) throw new Error("Carousel renderer returned an invalid source fingerprint");
  if (!Array.isArray(rendered.artifacts) || rendered.artifacts.length !== plan.slides.length) throw new Error("Carousel renderer must return exactly one artifact per slide");
  const seen = new Set<number>();
  rendered.artifacts.forEach((item, index) => {
    const expectedFilename = `carousel-${String(index + 1).padStart(2,"0")}.png`;
    if (!item || item.role !== "carousel-slide" || item.contentType !== "image/png" || item.filename !== expectedFilename) throw new Error("Carousel renderer artifact filename does not match its slide index");
    if (!Number.isInteger(item.index) || item.index !== index || seen.has(item.index)) throw new Error("Carousel renderer slide indexes must be unique, ordered and contiguous");
    seen.add(item.index);
    if (!(item.bytes instanceof Uint8Array)) throw new Error("Carousel renderer artifact is not a valid preset-sized PNG");
    assertValidPng(item.bytes, theme.width, theme.height);
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || item.sha256 !== sha256(item.bytes)) throw new Error("Carousel renderer artifact hash is invalid");
    if (!sameIds(item.supportingClaimIds, plan.slides[index]!.supportingClaimIds)) throw new Error("Carousel renderer artifact Claim lineage does not match its slide");
    validateLayoutMetrics(item.layoutMetrics, theme);
  });
}
function assertValidPng(bytes:Uint8Array,width:number,height:number):void{
  const invalid=(reason:string):never=>{throw new Error(`Carousel renderer PNG ${reason}`)};
  if(bytes.byteLength<45||!PNG_SIGNATURE.every((byte,offset)=>bytes[offset]===byte))invalid("signature is invalid");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,chunkIndex=0,sawIdat=false,sawIend=false,idatEnded=false;const idatParts:Uint8Array[]=[];
  while(offset<bytes.byteLength){
    if(offset+12>bytes.byteLength)invalid("chunk is truncated");
    const length=view.getUint32(offset),typeStart=offset+4,dataStart=offset+8,dataEnd=dataStart+length,crcOffset=dataEnd,next=crcOffset+4;
    if(!Number.isSafeInteger(next)||dataEnd<dataStart||next>bytes.byteLength)invalid("chunk length is invalid");
    const type=String.fromCharCode(...bytes.slice(typeStart,typeStart+4));
    if(!/^[A-Za-z]{4}$/.test(type)||view.getUint32(crcOffset)!==crc32(bytes.slice(typeStart,dataEnd)))invalid("chunk CRC is invalid");
    if(chunkIndex===0){if(type!=="IHDR"||length!==13||view.getUint32(dataStart)!==width||view.getUint32(dataStart+4)!==height||bytes[dataStart+8]!==8||bytes[dataStart+9]!==2||bytes[dataStart+10]!==0||bytes[dataStart+11]!==0||bytes[dataStart+12]!==0)invalid("IHDR is unsupported");}
    else if(type==="IHDR")invalid("contains duplicate IHDR");
    if(type==="IDAT"){if(idatEnded)invalid("IDAT chunks are not consecutive");sawIdat=true;idatParts.push(bytes.slice(dataStart,dataEnd));}else if(sawIdat&&type!=="IEND")idatEnded=true;
    if(type==="IEND"){if(length!==0||!sawIdat||next!==bytes.byteLength)invalid("IEND is invalid");sawIend=true;}
    if(sawIend&&next!==bytes.byteLength)invalid("contains trailing data");
    offset=next;chunkIndex++;
  }
  if(!sawIend||offset!==bytes.byteLength)invalid("is missing terminal IEND");
  const rowBytes=width*3+1,expected=rowBytes*height;if(!Number.isSafeInteger(expected)||expected<=0)invalid("decoded size is invalid");
  const raw=inflatePngIdat(Buffer.concat(idatParts.map(part=>Buffer.from(part))),expected+1);
  if(raw.byteLength!==expected)invalid("decoded scanline length is invalid");
  for(let row=0;row<height;row++){const filter=raw[row*rowBytes];if(filter===undefined||filter>4)invalid("scanline filter is invalid");}
}
function inflatePngIdat(compressed:Uint8Array,maxOutputLength:number):Buffer{try{return inflateSync(compressed,{maxOutputLength});}catch{throw new Error("Carousel renderer PNG IDAT deflate stream is invalid");}}
function validateLayoutMetrics(value: CreativeLayoutMetrics | undefined, theme: NormalizedCreativeRenderTheme): void {
  if (!value || value.canvas.width !== theme.width || value.canvas.height !== theme.height) throw new Error("Carousel renderer layout canvas is invalid");
  const safe=value.safeArea;if(!safe||![safe.x,safe.y,safe.width,safe.height].every(nonNegativeFinite)||safe.width<=0||safe.height<=0||safe.x+safe.width>theme.width||safe.y+safe.height>theme.height)throw new Error("Carousel renderer safe area is invalid");
  if(!value.palette||!sameColor(value.palette.background,theme.background)||!sameColor(value.palette.foreground,theme.foreground)||!sameColor(value.palette.accent,theme.accent))throw new Error("Carousel renderer palette metrics are invalid");
  if(!Array.isArray(value.text)||!value.text.length||value.text.some(metric=>!metric||!["cover","headline","body","cta"].includes(metric.role)||!["left","center","right"].includes(metric.alignment)||!Number.isInteger(metric.lineCount)||metric.lineCount<1||!Number.isInteger(metric.characterCount)||metric.characterCount<1||![metric.x,metric.y,metric.width,metric.height].every(nonNegativeFinite)||metric.width<=0||metric.height<=0||metric.x+metric.width>theme.width||metric.y+metric.height>theme.height))throw new Error("Carousel renderer text layout metrics are invalid");
  if(!Number.isFinite(value.textOccupiedRatio)||value.textOccupiedRatio<0||value.textOccupiedRatio>1)throw new Error("Carousel renderer text occupancy is invalid");
  if(value.logoPlacement!==theme.logoPlacement||value.logoAssetId!==theme.logoAssetId||value.headingFontLabel!==theme.headingFontLabel||value.bodyFontLabel!==theme.bodyFontLabel)throw new Error("Carousel renderer Brand layout metadata is invalid");
  if(value.logoBounds){const box=value.logoBounds;if(!theme.logoAssetId||theme.logoPlacement==="none"||![box.x,box.y,box.width,box.height].every(nonNegativeFinite)||box.width<=0||box.height<=0||box.x+box.width>theme.width||box.y+box.height>theme.height)throw new Error("Carousel renderer logo bounds are invalid");}
}
function nonNegativeFinite(value:number):boolean{return Number.isFinite(value)&&value>=0}
function sameColor(a:Rgb,b:Rgb):boolean{return a.length===3&&a.every((part,index)=>part===b[index])}
function sameIds(a:string[],b:string[]):boolean{return Array.isArray(a)&&a.length===b.length&&a.every((id,index)=>id===b[index])}
function dimension(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Creative ${field} must be an integer between ${min} and ${max}`);
  return value;
}
function color(value: Rgb, field: string): Rgb {
  if (!Array.isArray(value) || value.length !== 3 || value.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error(`Creative ${field} color is invalid`);
  return [value[0], value[1], value[2]];
}
function validateScope(input: CreativeScope): CreativeScope {
  return { workspaceId: scopeText(input?.workspaceId, "workspaceId"), brandId: scopeText(input?.brandId, "brandId") };
}
function scopeText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) throw new Error(`${field} is required`);
  return value.trim();
}
function boundedPositive(value: number, field: string, max: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > max) throw new Error(`${field} is invalid`);
  return value;
}

function renderCarouselBitmap(plan: ReturnType<typeof validateCarouselPlan>, theme: NormalizedCreativeRenderTheme, rendererVersion: string): CreativeRenderPackage {
  const sourceFingerprint = fingerprint(plan, theme, rendererVersion);
  const artifacts = plan.slides.map((slide, index) => {
    const canvas = new Canvas(theme.width, theme.height, theme.background);
    const pad = Math.max(12, Math.floor(theme.width * 0.075));
    const headScale = Math.max(2, Math.floor(theme.width / 90));
    const bodyScale = Math.max(2, Math.floor(theme.width / 150));
    canvas.fillRect(0, 0, theme.width, Math.max(5, Math.floor(theme.height * 0.025)), theme.accent);
    drawBrandAssets(canvas,theme,pad);
    let y = pad; const text: CreativeTextLayoutMetric[] = [];
    if (index === 0) { const metric = canvas.drawMeasured(plan.coverHook, "cover", pad, y, theme.width - pad * 2, headScale, theme.accent, 3); text.push(metric); y = metric.y + metric.height + bodyScale * 3; }
    const headline = canvas.drawMeasured(slide.headline, "headline", pad, y, theme.width - pad * 2, headScale, theme.foreground, 4); text.push(headline); y = headline.y + headline.height + bodyScale * 3;
    text.push(canvas.drawMeasured(slide.body, "body", pad, y, theme.width - pad * 2, bodyScale, theme.foreground, 12));
    if (index === plan.slides.length - 1) text.push(canvas.drawMeasured(plan.cta, "cta", pad, theme.height - pad - bodyScale * 12, theme.width - pad * 2, bodyScale, theme.accent, 3));
    const bytes = encodePng(canvas);
    const layoutMetrics = layout(theme, pad, text);
    return artifact("carousel-slide", `carousel-${String(index + 1).padStart(2,"0")}.png`, "image/png", bytes, slide.supportingClaimIds, index, layoutMetrics);
  });
  return { format: "carousel", rendererVersion, sourceFingerprint, artifacts };
}

function renderReel(plan: ReturnType<typeof validateReelPlan>, theme: NormalizedCreativeRenderTheme): CreativeRenderPackage {
  const sourceFingerprint = fingerprint(plan, theme, CREATIVE_RENDERER_VERSION);
  const frames = plan.scenes.map((scene, index) => {
    const canvas = new Canvas(theme.width, theme.height, theme.background);
    const pad = Math.max(12, Math.floor(theme.width * 0.075));
    const hookScale = Math.max(2, Math.floor(theme.width / 90));
    const textScale = Math.max(2, Math.floor(theme.width / 145));
    canvas.fillRect(0, 0, Math.max(6, Math.floor(theme.width * 0.025)), theme.height, theme.accent);
    drawBrandAssets(canvas,theme,pad);
    let y = pad;
    y = canvas.drawWrapped(plan.hook, pad * 1.5, y, theme.width - pad * 2.5, hookScale, theme.accent, 4) + textScale * 8;
    y = canvas.drawWrapped(scene.onScreenText, pad * 1.5, y, theme.width - pad * 2.5, hookScale, theme.foreground, 7) + textScale * 10;
    canvas.drawWrapped(`SCENE ${index + 1}  ${scene.startSecond}-${scene.endSecond} SEC`, pad * 1.5, theme.height - pad - textScale * 28, theme.width - pad * 2.5, textScale, theme.accent, 2);
    canvas.drawWrapped(scene.visual, pad * 1.5, theme.height - pad - textScale * 16, theme.width - pad * 2.5, textScale, theme.foreground, 4);
    const bytes = encodePng(canvas);
    return artifact("reel-storyboard", `reel-scene-${String(index + 1).padStart(2,"0")}.png`, "image/png", bytes, scene.supportingClaimIds, index);
  });
  const manifestObject = {
    schemaVersion: 1,
    rendererVersion: CREATIVE_RENDERER_VERSION,
    sourceFingerprint,
    format: "reel",
    targetDurationSeconds: plan.targetDurationSeconds,
    hook: plan.hook,
    caption: plan.caption,
    cta: plan.cta,
    supportingClaimIds: plan.supportingClaimIds,
    scenes: plan.scenes.map((scene, index) => ({
      index,
      startSecond: scene.startSecond,
      endSecond: scene.endSecond,
      visual: scene.visual,
      onScreenText: scene.onScreenText,
      voiceover: scene.voiceover,
      supportingClaimIds: scene.supportingClaimIds,
      storyboardFilename: frames[index]!.filename,
      storyboardSha256: frames[index]!.sha256,
    })),
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifestObject));
  const manifest = artifact("reel-render-manifest", "reel-render.json", "application/vnd.kairo.reel-render+json", manifestBytes, plan.supportingClaimIds, plan.scenes.length);
  return { format: "reel", rendererVersion: CREATIVE_RENDERER_VERSION, sourceFingerprint, artifacts: [...frames, manifest] };
}

function thumbnailArtifact(rendered:CreativeRenderPackage):RenderedCreativeArtifact{const source=rendered.artifacts.find((item)=>item.contentType==="image/png");if(!source)throw new Error("Generated creative package has no visual source for its thumbnail");const raster=decodeRgbPng(source.bytes),width=270,height=Math.max(1,Math.round(width*raster.height/raster.width)),canvas=new Canvas(width,height,[255,255,255]);canvas.drawRaster({...raster,id:`${rendered.sourceFingerprint}:thumbnail-source`,approved:true,channels:3},0,0,width,height,1);const bytes=encodePng(canvas),carousel=rendered.format==="carousel";return artifact(carousel?"carousel-thumbnail":"reel-thumbnail",carousel?"carousel-thumbnail.png":"reel-thumbnail.png","image/png",bytes,source.supportingClaimIds,0)}
function decodeRgbPng(bytes:Uint8Array):{width:number;height:number;pixels:Uint8Array}{assertPngSignature(bytes);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,width=0,height=0;const compressed:Uint8Array[]=[];while(offset<bytes.byteLength){const length=view.getUint32(offset),type=Buffer.from(bytes.slice(offset+4,offset+8)).toString("ascii"),dataStart=offset+8,dataEnd=dataStart+length;if(type==="IHDR"){width=view.getUint32(dataStart);height=view.getUint32(dataStart+4);if(bytes[dataStart+8]!==8||bytes[dataStart+9]!==2)throw new Error("Thumbnail source PNG format is unsupported")}if(type==="IDAT")compressed.push(bytes.slice(dataStart,dataEnd));offset=dataEnd+4}const stride=width*3,raw=inflatePngIdat(Buffer.concat(compressed.map((item)=>Buffer.from(item))),(stride+1)*height+1);if(raw.byteLength!==(stride+1)*height)throw new Error("Thumbnail source PNG scanlines are invalid");const pixels=new Uint8Array(stride*height),previous=new Uint8Array(stride);for(let y=0;y<height;y++){const sourceOffset=y*(stride+1),filter=raw[sourceOffset]!,row=new Uint8Array(stride);for(let x=0;x<stride;x++){const encoded=raw[sourceOffset+1+x]!,left=x>=3?row[x-3]!:0,up=previous[x]!,upLeft=x>=3?previous[x-3]!:0;row[x]=(encoded+filterPredictor(filter,left,up,upLeft))&255}pixels.set(row,y*stride);previous.set(row)}return{width,height,pixels}}
function assertPngSignature(bytes:Uint8Array){if(bytes.byteLength<33||!PNG_SIGNATURE.every((byte,index)=>bytes[index]===byte))throw new Error("Thumbnail source PNG signature is invalid")}
function filterPredictor(filter:number,left:number,up:number,upLeft:number){if(filter===0)return 0;if(filter===1)return left;if(filter===2)return up;if(filter===3)return Math.floor((left+up)/2);if(filter===4){const p=left+up-upLeft,pa=Math.abs(p-left),pb=Math.abs(p-up),pc=Math.abs(p-upLeft);return pa<=pb&&pa<=pc?left:pb<=pc?up:upLeft}throw new Error("Thumbnail source PNG filter is unsupported")}

function fingerprint(plan: MarketingCreativePlan, theme: NormalizedCreativeRenderTheme, rendererVersion: string): string {
  return sha256(Buffer.from(JSON.stringify({ rendererVersion, plan, theme:themeIdentity(theme) })));
}
function themeIdentity(theme:NormalizedCreativeRenderTheme){const{logoAsset,imageryAsset,...values}=theme;return{...values,...(logoAsset?{logoAsset:{id:logoAsset.id,width:logoAsset.width,height:logoAsset.height,channels:logoAsset.channels,sha256:sha256(logoAsset.pixels)}}:{}),...(imageryAsset?{imageryAsset:{id:imageryAsset.id,width:imageryAsset.width,height:imageryAsset.height,channels:imageryAsset.channels,sha256:sha256(imageryAsset.pixels)}}:{})}}
function artifact(role: CreativeArtifactRole, filename: string, contentType: RenderedCreativeArtifact["contentType"], bytes: Uint8Array, supportingClaimIds: string[], index: number, layoutMetrics?: CreativeLayoutMetrics): RenderedCreativeArtifact {
  return { role, filename, contentType, bytes, sha256: sha256(bytes), supportingClaimIds: [...supportingClaimIds], index, ...(layoutMetrics ? { layoutMetrics } : {}) };
}
function layout(theme: NormalizedCreativeRenderTheme, pad: number, text: CreativeTextLayoutMetric[]): CreativeLayoutMetrics { const occupied = text.reduce((sum,item)=>sum+item.width*item.height,0), logo = theme.logoAssetId && theme.logoPlacement !== "none" ? logoBounds(theme, pad) : undefined; return { canvas:{width:theme.width,height:theme.height}, safeArea:{x:pad,y:pad,width:theme.width-pad*2,height:theme.height-pad*2}, palette:{background:theme.background,foreground:theme.foreground,accent:theme.accent}, text, textOccupiedRatio:Number((occupied/(theme.width*theme.height)).toFixed(6)), logoPlacement:theme.logoPlacement, ...(theme.logoAssetId?{logoAssetId:theme.logoAssetId}:{}), ...(logo?{logoBounds:logo}:{}), headingFontLabel:theme.headingFontLabel, bodyFontLabel:theme.bodyFontLabel }; }
function logoBounds(theme: NormalizedCreativeRenderTheme, pad: number): { x: number; y: number; width: number; height: number } { const width=Math.max(24,Math.floor(theme.width*.12)),height=Math.max(16,Math.floor(width*.5)),right=theme.logoPlacement.endsWith("right"),bottom=theme.logoPlacement.startsWith("bottom"); return{x:right?theme.width-pad-width:pad,y:bottom?theme.height-pad-height:pad,width,height}; }
function drawBrandAssets(canvas:Canvas,theme:NormalizedCreativeRenderTheme,pad:number){if(theme.imageryAsset){const width=Math.max(1,Math.floor(theme.width*.34));canvas.drawRaster(theme.imageryAsset,theme.width-width,0,width,theme.height,.28)}if(theme.logoAsset&&theme.logoPlacement!=="none"){const box=logoBounds(theme,pad);canvas.drawRaster(theme.logoAsset,box.x,box.y,box.width,box.height,1)}}
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

class Canvas {
  readonly pixels: Uint8Array;
  constructor(readonly width: number, readonly height: number, background: Rgb) {
    this.pixels = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width, height, background);
  }
  fillRect(x: number, y: number, width: number, height: number, color: Rgb): void {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + width)), y1 = Math.min(this.height, Math.ceil(y + height));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this.pixel(px, py, color);
  }
  drawRaster(asset:ApprovedRasterAsset,x:number,y:number,width:number,height:number,opacity:number):void{const targetWidth=Math.max(1,Math.floor(width)),targetHeight=Math.max(1,Math.floor(height)),alphaMultiplier=Math.max(0,Math.min(1,opacity));for(let ty=0;ty<targetHeight;ty++)for(let tx=0;tx<targetWidth;tx++){const sx=Math.min(asset.width-1,Math.floor(tx*asset.width/targetWidth)),sy=Math.min(asset.height-1,Math.floor(ty*asset.height/targetHeight)),source=(sy*asset.width+sx)*asset.channels,r=asset.pixels[source]!,g=asset.pixels[source+1]!,b=asset.pixels[source+2]!,alpha=(asset.channels===4?asset.pixels[source+3]!/255:1)*alphaMultiplier;this.blendPixel(Math.floor(x)+tx,Math.floor(y)+ty,[r,g,b],alpha)}}
  drawWrapped(text: string, x: number, y: number, maxWidth: number, scale: number, color: Rgb, maxLines: number): number {
    const metric = this.drawMeasured(text, "body", x, y, maxWidth, scale, color, maxLines); return metric.y + metric.height;
  }
  drawMeasured(text: string, role: CreativeTextLayoutMetric["role"], x: number, y: number, maxWidth: number, scale: number, color: Rgb, maxLines: number): CreativeTextLayoutMetric {
    assertRenderableText(text);
    const lines = wrapStrict(text, Math.max(1, Math.floor(maxWidth / (4 * scale))), maxLines);
    let cursorY = Math.floor(y);
    for (const line of lines) { this.drawLine(line, Math.floor(x), cursorY, scale, color); cursorY += 7 * scale; }
    const width = Math.min(maxWidth, Math.max(...lines.map(line => line.length * 4 * scale), 0));
    return { role, alignment: "left", lineCount: lines.length, characterCount: text.length, x: Math.floor(x), y: Math.floor(y), width, height: cursorY - Math.floor(y) };
  }
  private drawLine(text: string, x: number, y: number, scale: number, color: Rgb): void {
    let cursor = x;
    for (const char of text.toUpperCase()) {
      const glyph = char === " " ? GLYPHS[" "]! : GLYPHS[char]!;
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) if (glyph[row]![col] === "1") this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
      cursor += 4 * scale;
      if (cursor >= this.width) throw new Error("Creative text does not fit the rendered line");
    }
  }
  private pixel(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.pixels[offset] = color[0]; this.pixels[offset + 1] = color[1]; this.pixels[offset + 2] = color[2];
  }
  private blendPixel(x:number,y:number,color:Rgb,alpha:number):void{if(x<0||y<0||x>=this.width||y>=this.height||alpha<=0)return;const offset=(y*this.width+x)*3,inverse=1-alpha;this.pixels[offset]=Math.round(color[0]*alpha+this.pixels[offset]!*inverse);this.pixels[offset+1]=Math.round(color[1]*alpha+this.pixels[offset+1]!*inverse);this.pixels[offset+2]=Math.round(color[2]*alpha+this.pixels[offset+2]!*inverse)}
}

function assertRenderableText(input: string): void {
  for (const char of input.toUpperCase()) {
    if (/\s/u.test(char)) continue;
    if (!GLYPHS[char]) throw new Error(`Creative text contains unsupported character: ${char}`);
  }
}

function wrapStrict(input: string, maxChars: number, maxLines: number): string[] {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const tokens = words.flatMap((word) => word.length > maxChars ? (word.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [word]) : [word]);
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const next = line ? `${line} ${token}` : token;
    if (next.length <= maxChars) { line = next; continue; }
    if (line) lines.push(line);
    if (lines.length >= maxLines) throw new Error("Creative text does not fit the configured render area");
    line = token;
  }
  if (line) {
    if (lines.length >= maxLines) throw new Error("Creative text does not fit the configured render area");
    lines.push(line);
  }
  if (!lines.length) lines.push("");
  return lines;
}

function encodePng(canvas: Canvas): Uint8Array {
  const stride = canvas.width * 3;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const target = y * (stride + 1); raw[target] = 0;
    raw.set(canvas.pixels.subarray(y * stride, (y + 1) * stride), target + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0); ihdr.writeUInt32BE(canvas.height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii"), body = Buffer.from(data), out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0); typeBytes.copy(out, 4); body.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])), 8 + body.length); return out;
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

const GLYPHS: Record<string, readonly string[]> = {
  " ":["000","000","000","000","000"],"?":["110","001","010","000","010"],".":["000","000","000","000","010"],",":["000","000","000","010","100"],"!":["010","010","010","000","010"],":":["000","010","000","010","000"],";":["000","010","000","010","100"],"-":["000","000","111","000","000"],"/":["001","001","010","100","100"],"&":["010","101","010","101","011"],"+":["000","010","111","010","000"],"%":["101","001","010","100","101"],"#":["101","111","101","111","101"],"'":["010","010","000","000","000"],"(":["010","100","100","100","010"],")":["010","001","001","001","010"],"=":["000","111","000","111","000"],
  "A":["010","101","111","101","101"],"B":["110","101","110","101","110"],"C":["011","100","100","100","011"],"D":["110","101","101","101","110"],"E":["111","100","110","100","111"],"F":["111","100","110","100","100"],"G":["011","100","101","101","011"],"H":["101","101","111","101","101"],"I":["111","010","010","010","111"],"J":["001","001","001","101","010"],"K":["101","101","110","101","101"],"L":["100","100","100","100","111"],"M":["101","111","111","101","101"],"N":["101","111","111","111","101"],"O":["010","101","101","101","010"],"P":["110","101","110","100","100"],"Q":["010","101","101","111","011"],"R":["110","101","110","101","101"],"S":["011","100","010","001","110"],"T":["111","010","010","010","010"],"U":["101","101","101","101","111"],"V":["101","101","101","101","010"],"W":["101","101","111","111","101"],"X":["101","101","010","101","101"],"Y":["101","101","010","010","010"],"Z":["111","001","010","100","111"],
  "0":["111","101","101","101","111"],"1":["010","110","010","010","111"],"2":["110","001","010","100","111"],"3":["110","001","010","001","110"],"4":["101","101","111","001","001"],"5":["111","100","110","001","110"],"6":["011","100","110","101","010"],"7":["111","001","010","010","010"],"8":["010","101","010","101","010"],"9":["010","101","011","001","110"]
};
