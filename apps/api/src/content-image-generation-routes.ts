import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ConcurrencyConflictError, DomainValidationError, KairoService, ResourceNotFoundError, type KairoRepository } from "@kairo/domain";
import { ContentAssetSelectionService, type CampaignRepository } from "@kairo/domain/campaign-service";
import type { ContentAssetLibraryRepository } from "@kairo/domain/content-asset-library";
import type { IdentityVerifier } from "./auth";
import type { HomeMediaService } from "./home-media";
import { imagePrompt, type ImageGenerationPort } from "./image-generator";

export function registerContentImageGenerationRoutes(app: FastifyInstance, deps: {
  coreStore: KairoRepository;
  campaignStore: CampaignRepository;
  libraryStore: ContentAssetLibraryRepository;
  identityVerifier: IdentityVerifier;
  homeMedia?: HomeMediaService;
  imageGenerator?: ImageGenerationPort;
}) {
  const core = new KairoService(deps.coreStore);
  const selection = new ContentAssetSelectionService(deps.campaignStore, deps.libraryStore);
  app.post<{ Params: { brandId: string; campaignId: string; assetId: string }; Body: { expectedVersion: number } }>(
    "/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/generate-image",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, deps.identityVerifier);
      if (!account) return;
      if (!deps.homeMedia || !deps.imageGenerator) {
        return reply.status(503).send({ type: "about:blank", title: "Image generation unavailable", status: 503, detail: "AI image generation needs provider credentials and private Brand media storage.", code: "image_generation_unavailable", correlationId: request.id });
      }
      const expectedVersion = request.body?.expectedVersion;
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new DomainValidationError("expectedVersion must be a positive integer");
      const brand = await core.getBrand(account.id, request.params.brandId);
      const detail = await deps.campaignStore.getCampaign(account.id, brand.id, request.params.campaignId);
      if (!detail) throw new ResourceNotFoundError("Campaign not found");
      const entry = detail.assets.find((item) => item.asset.id === request.params.assetId);
      if (!entry) throw new ResourceNotFoundError("Content Asset not found");
      if (entry.asset.currentVersion !== expectedVersion) throw new ConcurrencyConflictError("Content Version is stale");
      if (entry.asset.format.toLowerCase() !== "image") throw new DomainValidationError("AI image generation is currently available for single-image Posts");
      if (!["instagram", "facebook"].includes(entry.asset.channel)) throw new DomainValidationError("AI image generation is available for Instagram and Facebook Posts");
      const parent = entry.versions.at(-1);
      if (!parent || parent.version !== expectedVersion) throw new ResourceNotFoundError("Content Version not found");
      if ((parent.libraryAssetRefs ?? []).some((item) => item.kind === "image" || item.kind === "video")) throw new DomainValidationError("This Post already has production media. Remove or replace it before generating another image.");
      let generated;
      try {
        generated = await deps.imageGenerator.generate(imagePrompt({
          brand: brand.name,
          topic: entry.asset.topic,
          audience: entry.asset.audience,
          objective: detail.campaign.objective,
          caption: captionFrom(parent.content),
        }));
      } catch {
        return reply.status(502).send({ type: "about:blank", title: "Image generation failed", status: 502, detail: "Kairo could not generate the image. Try again.", code: "image_generation_failed", correlationId: request.id });
      }
      const media = await deps.homeMedia.saveGeneratedImage(account.id, detail.campaign.workspaceId, brand.id, {
        name: generatedName(entry.asset.topic), mimeType: generated.mimeType, bytes: generated.bytes,
      });
      const currentIds = (parent.libraryAssetRefs ?? []).map((reference) => reference.libraryAssetId);
      await selection.select(account.id, brand.id, request.params.campaignId, entry.asset.id, {
        expectedVersion, libraryAssetIds: [...currentIds, media.id],
      });
      return reply.status(201).send({ mediaAssetId: media.id, source: media.source, mimeType: media.mimeType, contentVersion: expectedVersion + 1 });
    },
  );
}

function captionFrom(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    for (const key of ["caption", "copy", "text", "body", "description"]) if (typeof parsed[key] === "string") return (parsed[key] as string).slice(0, 900);
  } catch {}
  return content.slice(0, 900);
}

function generatedName(topic: string) {
  const clean = topic.replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Social post";
  return `AI generated — ${clean}.png`;
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, service: KairoService, verifier: IdentityVerifier) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Authentication is required", code: "unauthorized", correlationId: request.id });
    return null;
  }
  return service.establishSession(identity);
}
