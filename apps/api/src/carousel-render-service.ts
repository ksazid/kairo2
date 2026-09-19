import { createHash } from "node:crypto";
import { DomainValidationError } from "@kairo/domain";
import { compileCarouselProject } from "@kairo/domain/carousel-project";
import { AdaptiveBitmapCarouselRenderer } from "@kairo/worker/adaptive-carousel-renderer";
import {
  CreativeAssetProductionService,
  type CreativeObjectStorePort,
  type CreativeRenderTheme,
  type NormalizedCreativeRenderTheme,
} from "@kairo/worker/creative-renderer";
import { evaluateRenderedCarouselArtifactsQuality } from "@kairo/worker/carousel-quality-adapter";
import type { PgCarouselStudioStore } from "./carousel-studio-postgres";

export class CarouselRenderService {
  constructor(
    private readonly projects: PgCarouselStudioStore,
    private readonly objects: CreativeObjectStorePort,
    private readonly provider: string,
  ) {}

  async render(accountId: string, brandId: string, projectId: string, expectedRevision: number) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new DomainValidationError("expectedAssetVersion must be a positive integer");
    }

    const source = await this.projects.getRenderSource(accountId, brandId, projectId);
    if (source.revision !== expectedRevision) throw new DomainValidationError("Carousel asset version conflict");

    const theme = themeFromStyle(source.style);
    const renderer = new AdaptiveBitmapCarouselRenderer();
    const production = new CreativeAssetProductionService(this.objects, { carouselRenderer: renderer });
    const plan = compileCarouselProject(source.project);
    const measured = renderer.render(plan, normalizedTheme(theme));
    const quality = evaluateRenderedCarouselArtifactsQuality(source.project, measured.artifacts, {
      fontFamilies: [theme.headingFontLabel ?? "Kairo Bitmap", theme.bodyFontLabel ?? "Kairo Bitmap"],
      colors: [theme.background ?? [247, 247, 244], theme.foreground ?? [24, 24, 24], theme.accent ?? [72, 92, 75]],
      logoRequired: Boolean(theme.logoAssetId),
    });
    const blockingErrorCount = quality.findings.filter((item) => item.severity === "blocking").length;
    if (blockingErrorCount) throw new DomainValidationError(`Carousel render has ${blockingErrorCount} blocking quality finding(s)`);

    const rendered = await production.produce({ workspaceId: source.workspaceId, brandId }, plan, theme);
    const slideAssets = rendered.assets.filter((item) => item.role === "carousel-slide").sort((a, b) => a.index - b.index);
    const thumbnail = rendered.assets.find((item) => item.role === "carousel-thumbnail");
    if (
      !thumbnail ||
      slideAssets.length !== source.project.slides.length ||
      slideAssets.some((asset, index) => asset.contentHash !== measured.artifacts[index]?.sha256)
    ) {
      throw new Error("Carousel renderer did not produce complete deterministic media");
    }

    const manifestBytes = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      format: "carousel",
      rendererVersion: rendered.rendererVersion,
      sourceFingerprint: rendered.sourceFingerprint,
      projectId,
      projectRevision: source.revision,
      slides: slideAssets.map((asset, index) => ({
        slideId: source.project.slides[index]!.id,
        position: index,
        objectKey: asset.objectKey,
        sha256: asset.contentHash,
        mimeType: asset.contentType,
        sizeBytes: asset.sizeBytes,
      })),
      thumbnail: {
        objectKey: thumbnail.objectKey,
        sha256: thumbnail.contentHash,
        mimeType: thumbnail.contentType,
        sizeBytes: thumbnail.sizeBytes,
      },
    }));
    const manifestSha256 = sha256(manifestBytes);
    const manifestObjectKey = `generated/${scopeKey(source.workspaceId, brandId)}/carousel/${rendered.sourceFingerprint}/manifest.json`;
    await this.objects.putPrivateObject({
      workspaceId: source.workspaceId,
      brandId,
      objectKey: manifestObjectKey,
      contentType: "application/json",
      contentHash: manifestSha256,
      bytes: manifestBytes,
    });

    const thumbSize = pngSizeFromAsset(thumbnail);
    return this.projects.saveRenderedVersion(accountId, brandId, projectId, {
      version: source.version,
      projectRevision: source.revision,
      storageProvider: this.provider,
      manifestObjectKey,
      manifestSha256,
      thumbnail: {
        objectKey: thumbnail.objectKey,
        sha256: thumbnail.contentHash,
        mimeType: "image/png",
        width: thumbSize.width,
        height: thumbSize.height,
        sizeBytes: thumbnail.sizeBytes,
      },
      qualityReport: { findings: quality.findings, blockingErrorCount },
      status: "ready",
      slides: slideAssets.map((asset, index) => ({
        slideId: source.project.slides[index]!.id,
        position: index,
        objectKey: asset.objectKey,
        sha256: asset.contentHash,
        mimeType: "image/png",
        width: 1080,
        height: 1350,
        sizeBytes: asset.sizeBytes,
      })),
    });
  }
}

function themeFromStyle(style: Record<string, unknown>): CreativeRenderTheme {
  const color = (name: string): readonly [number, number, number] | undefined => {
    const value = style[name];
    return Array.isArray(value) && value.length === 3 && value.every((part) => Number.isInteger(part) && Number(part) >= 0 && Number(part) <= 255)
      ? [Number(value[0]), Number(value[1]), Number(value[2])]
      : undefined;
  };
  const text = (name: string) => typeof style[name] === "string" && String(style[name]).trim() ? String(style[name]).trim() : undefined;
  return {
    width: 1080,
    height: 1350,
    ...(color("background") ? { background: color("background") } : {}),
    ...(color("foreground") ? { foreground: color("foreground") } : {}),
    ...(color("accent") ? { accent: color("accent") } : {}),
    ...(text("headingFontLabel") ? { headingFontLabel: text("headingFontLabel") } : {}),
    ...(text("bodyFontLabel") ? { bodyFontLabel: text("bodyFontLabel") } : {}),
    logoPlacement: "none",
  };
}

function normalizedTheme(theme: CreativeRenderTheme): NormalizedCreativeRenderTheme {
  return {
    width: theme.width ?? 1080,
    height: theme.height ?? 1350,
    background: theme.background ?? [247, 247, 244],
    foreground: theme.foreground ?? [24, 24, 24],
    accent: theme.accent ?? [72, 92, 75],
    headingFontLabel: theme.headingFontLabel ?? "Kairo Bitmap",
    bodyFontLabel: theme.bodyFontLabel ?? "Kairo Bitmap",
    headingFontAssetId: theme.headingFontAssetId ?? "kairo-bitmap-regular",
    bodyFontAssetId: theme.bodyFontAssetId ?? "kairo-bitmap-regular",
    logoPlacement: theme.logoPlacement ?? "none",
    ...(theme.logoAssetId ? { logoAssetId: theme.logoAssetId } : {}),
    ...(theme.logoAsset ? { logoAsset: theme.logoAsset } : {}),
    ...(theme.imageryAsset ? { imageryAsset: theme.imageryAsset } : {}),
  };
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function scopeKey(workspaceId: string, brandId: string) {
  return createHash("sha256").update(`${workspaceId}\u0000${brandId}`).digest("hex").slice(0, 24);
}

function pngSizeFromAsset(_asset: { sizeBytes: number }) {
  return { width: 270, height: 338 };
}
