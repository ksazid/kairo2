import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KairoService, type KairoRepository } from "@kairo/domain";
import { ContentAssetLibraryService, type ContentAssetKind, type ContentAssetLibraryRepository, type ContentAssetProvider } from "@kairo/domain/content-asset-library";
import type { IdentityVerifier } from "./auth";

export function registerContentAssetLibraryRoutes(app: FastifyInstance, options: {
  coreStore: KairoRepository;
  libraryStore: ContentAssetLibraryRepository;
  identityVerifier: IdentityVerifier;
}) {
  const core = new KairoService(options.coreStore);
  const service = new ContentAssetLibraryService(options.coreStore, options.libraryStore);

  app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/content-asset-libraries", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return service.listLibraries(account.id, request.params.brandId);
  });

  app.post<{ Params: { brandId: string }; Body: { name: string; provider?: ContentAssetProvider } }>("/api/v1/brands/:brandId/content-asset-libraries", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return reply.status(201).send(await service.createLibrary(account.id, request.params.brandId, request.body ?? ({} as { name: string; provider?: ContentAssetProvider })));
  });

  app.get<{ Params: { brandId: string }; Querystring: { libraryId?: string; kind?: ContentAssetKind; q?: string } }>("/api/v1/brands/:brandId/content-assets", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return service.listAssets(account.id, request.params.brandId, {
      ...(request.query.libraryId ? { libraryId: request.query.libraryId } : {}),
      ...(request.query.kind ? { kind: request.query.kind } : {}),
      ...(request.query.q ? { query: request.query.q } : {}),
    });
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
