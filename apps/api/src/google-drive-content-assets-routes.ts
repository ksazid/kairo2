import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DomainValidationError, KairoService, type KairoRepository } from "@kairo/domain";
import type { IdentityVerifier } from "./auth";
import type { GoogleDriveContentAssetService } from "./google-drive-content-assets";

export function registerGoogleDriveContentAssetRoutes(app: FastifyInstance, deps: {
  coreStore: KairoRepository;
  identityVerifier: IdentityVerifier;
  service?: GoogleDriveContentAssetService;
}) {
  const core = new KairoService(deps.coreStore);

  app.get("/api/v1/content-assets/google-drive/capability", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    return { enabled: !!deps.service };
  });

  app.post<{ Params: { brandId: string; libraryId: string } }>("/api/v1/brands/:brandId/content-asset-libraries/:libraryId/google-drive/connect", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    const service = requireService(reply, deps.service); if (!service) return;
    return service.begin(account.id, request.params.brandId, request.params.libraryId);
  });

  app.post<{ Body: { code?: string; state?: string } }>("/api/v1/content-assets/google-drive/callback", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    const service = requireService(reply, deps.service); if (!service) return;
    if (!request.body?.code || !request.body?.state) throw new DomainValidationError("Google Drive callback code and state are required");
    return service.complete(account.id, request.body.code, request.body.state);
  });

  app.get<{ Params: { brandId: string; libraryId: string } }>("/api/v1/brands/:brandId/content-asset-libraries/:libraryId/google-drive/picker", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    const service = requireService(reply, deps.service); if (!service) return;
    return service.pickerConfig(account.id, request.params.brandId, request.params.libraryId);
  });

  app.post<{ Params: { brandId: string; libraryId: string }; Body: { fileId?: string } }>("/api/v1/brands/:brandId/content-asset-libraries/:libraryId/google-drive/root", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    const service = requireService(reply, deps.service); if (!service) return;
    if (!request.body?.fileId) throw new DomainValidationError("Google Drive folder id is required");
    return service.selectRoot(account.id, request.params.brandId, request.params.libraryId, request.body.fileId);
  });

  app.post<{ Params: { brandId: string; libraryId: string } }>("/api/v1/brands/:brandId/content-asset-libraries/:libraryId/google-drive/index", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    const service = requireService(reply, deps.service); if (!service) return;
    return service.index(account.id, request.params.brandId, request.params.libraryId);
  });

  app.post<{ Params: { brandId: string; libraryId: string } }>("/api/v1/brands/:brandId/content-asset-libraries/:libraryId/google-drive/disconnect", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    const service = requireService(reply, deps.service); if (!service) return;
    await service.disconnect(account.id, request.params.brandId, request.params.libraryId);
    return reply.status(204).send();
  });
}

function requireService(reply: FastifyReply, service?: GoogleDriveContentAssetService) {
  if (service) return service;
  void reply.status(503).send({ type:"https://kairo.local/problems/provider-unavailable", title:"Provider unavailable", status:503, detail:"Google Drive connection is not configured for this Kairo environment.", code:"provider_unavailable" });
  return null;
}
async function authenticate(request: FastifyRequest, reply: FastifyReply, core: KairoService, verifier: IdentityVerifier) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) { await reply.status(401).send({ type:"https://kairo.local/problems/unauthorized", title:"Unauthorized", status:401, detail:"A valid bearer token is required.", code:"unauthorized", correlationId:request.id }); return null; }
  return core.establishSession(identity);
}
