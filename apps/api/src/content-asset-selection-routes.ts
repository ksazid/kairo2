import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KairoService, type KairoRepository } from "@kairo/domain";
import { ContentAssetSelectionService, type CampaignRepository } from "@kairo/domain/campaign-service";
import type { ContentAssetLibraryRepository } from "@kairo/domain/content-asset-library";
import type { IdentityVerifier } from "./auth";

export function registerContentAssetSelectionRoutes(app: FastifyInstance, options: {
  coreStore: KairoRepository;
  campaignStore: CampaignRepository;
  libraryStore: ContentAssetLibraryRepository;
  identityVerifier: IdentityVerifier;
}) {
  const core = new KairoService(options.coreStore);
  const service = new ContentAssetSelectionService(options.campaignStore, options.libraryStore);

  app.post<{
    Params: { brandId: string; campaignId: string; assetId: string };
    Body: { expectedVersion: number; libraryAssetIds: string[] };
  }>("/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/library-assets", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return service.select(account.id, request.params.brandId, request.params.campaignId, request.params.assetId, request.body ?? ({} as { expectedVersion: number; libraryAssetIds: string[] }));
  });
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, service: KairoService, verifier: IdentityVerifier) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send({ type:"about:blank",title:"Unauthorized",status:401,detail:"Authentication is required",code:"unauthorized",correlationId:request.id });
    return null;
  }
  return service.establishSession(identity);
}
