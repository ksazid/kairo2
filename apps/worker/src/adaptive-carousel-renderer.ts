import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { validateCarouselPlan } from "@kairo/domain/creative-formats";
import {
  carouselSourceFingerprint,
  type ApprovedRasterAsset,
  type CarouselRendererPort,
  type CreativeLayoutMetrics,
  type CreativeRenderPackage,
  type CreativeTextLayoutMetric,
  type NormalizedCreativeRenderTheme,
  type RenderedCreativeArtifact,
} from "./creative-renderer";

export const ADAPTIVE_CAROUSEL_RENDERER_VERSION = "kairo-bitmap-adaptive-v3";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
type Rgb = readonly [number, number, number];
type CarouselPlan = ReturnType<typeof validateCarouselPlan>;

/**
 * Production carousel renderer that preserves approved copy while adapting
 * deterministic bitmap scale to bounded layout space. It also avoids drawing
 * bootstrap-equivalent cover/headline and body/CTA text twice on the same slide.
 */
export class AdaptiveBitmapCarouselRenderer implements CarouselRendererPort {
  readonly version = ADAPTIVE_CAROUSEL_RENDERER_VERSION;

  render(plan: CarouselPlan, theme: NormalizedCreativeRenderTheme): CreativeRenderPackage {
    const sourceFingerprint = carouselSourceFingerprint(plan, theme, this.version);
    const artifacts = plan.slides.map((slide, index) => {
      const canvas = new Canvas(theme.width, theme.height, theme.background);
      const pad = Math.max(12, Math.floor(theme.width * 0.075));
      const safeBottom = theme.height - pad;
      const headScale = Math.max(2, Math.floor(theme.width / 90));
      const bodyScale = Math.max(2, Math.floor(theme.width / 150));
      const maxWidth = theme.width - pad * 2;
      const text: CreativeTextLayoutMetric[] = [];

      canvas.fillRect(0, 0, theme.width, Math.max(5, Math.floor(theme.height * 0.025)), theme.accent);
      drawBrandAssets(canvas, theme, pad);

      let y = pad;
      if (index === 0) {
        const cover = canvas.drawMeasured(plan.coverHook, "cover", pad, y, maxWidth, headScale, theme.accent, 3, safeBottom - y);
        text.push(cover);
        y = cover.y + cover.height + bodyScale * 3;
      }

      const duplicateHeadline = index === 0 && sameText(slide.headline, plan.coverHook);
      if (!duplicateHeadline) {
        const headline = canvas.drawMeasured(slide.headline, "headline", pad, y, maxWidth, headScale, theme.foreground, 4, safeBottom - y);
        text.push(headline);
        y = headline.y + headline.height + bodyScale * 3;
      }

      const finalSlide = index === plan.slides.length - 1;
      const duplicateCta = finalSlide && (sameText(plan.cta, slide.body) || sameText(plan.cta, slide.headline));
      const ctaReserve = !duplicateCta && finalSlide ? bodyScale * 7 * 3 + bodyScale * 3 : 0;
      const bodyMaxHeight = Math.max(1, safeBottom - ctaReserve - y);
      text.push(canvas.drawMeasured(slide.body, "body", pad, y, maxWidth, bodyScale, theme.foreground, 12, bodyMaxHeight));

      if (finalSlide && !duplicateCta) {
        const ctaY = safeBottom - bodyScale * 7 * 3;
        text.push(canvas.drawMeasured(plan.cta, "cta", pad, ctaY, maxWidth, bodyScale, theme.accent, 3, safeBottom - ctaY));
      }

      const bytes = encodePng(canvas);
      const layoutMetrics = layout(theme, pad, text);
      return artifact(
        "carousel-slide",
        `carousel-${String(index + 1).padStart(2, "0")}.png`,
        bytes,
        slide.supportingClaimIds,
        index,
        layoutMetrics,
      );
    });

    return { format: "carousel", rendererVersion: this.version, sourceFingerprint, artifacts };
  }
}

class Canvas {
  readonly pixels: Uint8Array;

  constructor(readonly width: number, readonly height: number, background: Rgb) {
    this.pixels = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width, height, background);
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgb): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + width));
    const y1 = Math.min(this.height, Math.ceil(y + height));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.pixel(px, py, color);
    }
  }

  drawRaster(asset: ApprovedRasterAsset, x: number, y: number, width: number, height: number, opacity: number): void {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));
    const alphaMultiplier = Math.max(0, Math.min(1, opacity));
    for (let ty = 0; ty < targetHeight; ty++) {
      for (let tx = 0; tx < targetWidth; tx++) {
        const sx = Math.min(asset.width - 1, Math.floor((tx * asset.width) / targetWidth));
        const sy = Math.min(asset.height - 1, Math.floor((ty * asset.height) / targetHeight));
        const source = (sy * asset.width + sx) * asset.channels;
        const alpha = (asset.channels === 4 ? asset.pixels[source + 3]! / 255 : 1) * alphaMultiplier;
        this.blendPixel(Math.floor(x) + tx, Math.floor(y) + ty, [asset.pixels[source]!, asset.pixels[source + 1]!, asset.pixels[source + 2]!], alpha);
      }
    }
  }

  drawMeasured(
    input: string,
    role: CreativeTextLayoutMetric["role"],
    x: number,
    y: number,
    maxWidth: number,
    preferredScale: number,
    color: Rgb,
    maxLines: number,
    maxHeight: number,
  ): CreativeTextLayoutMetric {
    assertRenderableText(input);
    const fitted = fitText(input, maxWidth, preferredScale, maxLines, maxHeight);
    let cursorY = Math.floor(y);
    for (const line of fitted.lines) {
      this.drawLine(line, Math.floor(x), cursorY, fitted.scale, color);
      cursorY += 7 * fitted.scale;
    }
    const width = Math.min(maxWidth, Math.max(...fitted.lines.map((line) => line.length * 4 * fitted.scale), 0));
    return {
      role,
      alignment: "left",
      lineCount: fitted.lines.length,
      characterCount: input.length,
      x: Math.floor(x),
      y: Math.floor(y),
      width,
      height: cursorY - Math.floor(y),
    };
  }

  private drawLine(text: string, x: number, y: number, scale: number, color: Rgb): void {
    let cursor = x;
    for (const char of text.toUpperCase()) {
      const glyph = char === " " ? GLYPHS[" "]! : GLYPHS[char]!;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (glyph[row]![col] === "1") this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
        }
      }
      cursor += 4 * scale;
      if (cursor >= this.width) throw new Error("Creative text does not fit the rendered line");
    }
  }

  private pixel(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.pixels[offset] = color[0];
    this.pixels[offset + 1] = color[1];
    this.pixels[offset + 2] = color[2];
  }

  private blendPixel(x: number, y: number, color: Rgb, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const offset = (y * this.width + x) * 3;
    const inverse = 1 - alpha;
    this.pixels[offset] = Math.round(color[0] * alpha + this.pixels[offset]! * inverse);
    this.pixels[offset + 1] = Math.round(color[1] * alpha + this.pixels[offset + 1]! * inverse);
    this.pixels[offset + 2] = Math.round(color[2] * alpha + this.pixels[offset + 2]! * inverse);
  }
}

function fitText(input: string, maxWidth: number, preferredScale: number, maxLines: number, maxHeight: number): { lines: string[]; scale: number } {
  const start = Math.max(1, Math.floor(preferredScale));
  for (let scale = start; scale >= 1; scale--) {
    const maxChars = Math.max(1, Math.floor(maxWidth / (4 * scale)));
    const lines = wrap(input, maxChars, maxLines);
    if (lines && lines.length * 7 * scale <= maxHeight) return { lines, scale };
  }
  throw new Error("Creative text does not fit the configured render area");
}

function wrap(input: string, maxChars: number, maxLines: number): string[] | null {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const tokens = words.flatMap((word) => word.length > maxChars ? (word.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [word]) : [word]);
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const next = line ? `${line} ${token}` : token;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    if (lines.length >= maxLines) return null;
    line = token;
  }
  if (line) {
    if (lines.length >= maxLines) return null;
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function assertRenderableText(input: string): void {
  for (const char of input.toUpperCase()) {
    if (/\s/u.test(char)) continue;
    if (!GLYPHS[char]) throw new Error(`Creative text contains unsupported character: ${char}`);
  }
}

function sameText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === b.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function artifact(
  role: "carousel-slide",
  filename: string,
  bytes: Uint8Array,
  supportingClaimIds: string[],
  index: number,
  layoutMetrics: CreativeLayoutMetrics,
): RenderedCreativeArtifact {
  return { role, filename, contentType: "image/png", bytes, sha256: sha256(bytes), supportingClaimIds: [...supportingClaimIds], index, layoutMetrics };
}

function layout(theme: NormalizedCreativeRenderTheme, pad: number, text: CreativeTextLayoutMetric[]): CreativeLayoutMetrics {
  const occupied = text.reduce((sum, item) => sum + item.width * item.height, 0);
  const logo = theme.logoAssetId && theme.logoPlacement !== "none" ? logoBounds(theme, pad) : undefined;
  return {
    canvas: { width: theme.width, height: theme.height },
    safeArea: { x: pad, y: pad, width: theme.width - pad * 2, height: theme.height - pad * 2 },
    palette: { background: theme.background, foreground: theme.foreground, accent: theme.accent },
    text,
    textOccupiedRatio: Number((occupied / (theme.width * theme.height)).toFixed(6)),
    logoPlacement: theme.logoPlacement,
    ...(theme.logoAssetId ? { logoAssetId: theme.logoAssetId } : {}),
    ...(logo ? { logoBounds: logo } : {}),
    headingFontLabel: theme.headingFontLabel,
    bodyFontLabel: theme.bodyFontLabel,
  };
}

function logoBounds(theme: NormalizedCreativeRenderTheme, pad: number): { x: number; y: number; width: number; height: number } {
  const width = Math.max(24, Math.floor(theme.width * 0.12));
  const height = Math.max(16, Math.floor(width * 0.5));
  const right = theme.logoPlacement.endsWith("right");
  const bottom = theme.logoPlacement.startsWith("bottom");
  return { x: right ? theme.width - pad - width : pad, y: bottom ? theme.height - pad - height : pad, width, height };
}

function drawBrandAssets(canvas: Canvas, theme: NormalizedCreativeRenderTheme, pad: number): void {
  if (theme.imageryAsset) {
    const width = Math.max(1, Math.floor(theme.width * 0.34));
    canvas.drawRaster(theme.imageryAsset, theme.width - width, 0, width, theme.height, 0.28);
  }
  if (theme.logoAsset && theme.logoPlacement !== "none") {
    const box = logoBounds(theme, pad);
    canvas.drawRaster(theme.logoAsset, box.x, box.y, box.width, box.height, 1);
  }
}

function encodePng(canvas: Canvas): Uint8Array {
  const stride = canvas.width * 3;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const target = y * (stride + 1);
    raw[target] = 0;
    raw.set(canvas.pixels.subarray(y * stride, (y + 1) * stride), target + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  typeBytes.copy(out, 4);
  body.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])), 8 + body.length);
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const GLYPHS: Record<string, readonly string[]> = {
  " ":["000","000","000","000","000"],"?":["110","001","010","000","010"],".":["000","000","000","000","010"],",":["000","000","000","010","100"],"!":["010","010","010","000","010"],":":["000","010","000","010","000"],";":["000","010","000","010","100"],"-":["000","000","111","000","000"],"_":["000","000","000","000","111"],"@":["010","101","111","100","011"],"/":["001","001","010","100","100"],"&":["010","101","010","101","011"],"+":["000","010","111","010","000"],"%":["101","001","010","100","101"],"#":["101","111","101","111","101"],"'":["010","010","000","000","000"],"(":["010","100","100","100","010"],")":["010","001","001","001","010"],"=":["000","111","000","111","000"],
  "A":["010","101","111","101","101"],"B":["110","101","110","101","110"],"C":["011","100","100","100","011"],"D":["110","101","101","101","110"],"E":["111","100","110","100","111"],"F":["111","100","110","100","100"],"G":["011","100","101","101","011"],"H":["101","101","111","101","101"],"I":["111","010","010","010","111"],"J":["001","001","001","101","010"],"K":["101","101","110","101","101"],"L":["100","100","100","100","111"],"M":["101","111","111","101","101"],"N":["101","111","111","111","101"],"O":["010","101","101","101","010"],"P":["110","101","110","100","100"],"Q":["010","101","101","111","011"],"R":["110","101","110","101","101"],"S":["011","100","010","001","110"],"T":["111","010","010","010","010"],"U":["101","101","101","101","111"],"V":["101","101","101","101","010"],"W":["101","101","111","111","101"],"X":["101","101","010","101","101"],"Y":["101","101","010","010","010"],"Z":["111","001","010","100","111"],
  "0":["111","101","101","101","111"],"1":["010","110","010","010","111"],"2":["110","001","010","100","111"],"3":["110","001","010","001","110"],"4":["101","101","111","001","001"],"5":["111","100","110","001","110"],"6":["011","100","110","101","010"],"7":["111","001","010","010","010"],"8":["010","101","010","101","010"],"9":["010","101","011","001","110"]
};
