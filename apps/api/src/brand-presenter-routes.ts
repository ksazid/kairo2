import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KairoService, type KairoRepository } from "@kairo/domain";
import type { PutBrandPresenterRequest } from "@kairo/contracts/presenter";
import type { IdentityVerifier } from "./auth";
import { BrandPresenterService } from "./brand-presenter";

export function registerBrandPresenterRoutes(
  app: FastifyInstance,
  options: {
    coreStore: KairoRepository;
    identityVerifier: IdentityVerifier;
    service: BrandPresenterService;
  },
) {
  const core = new KairoService(options.coreStore);

  app.get<{ Params: { brandId: string } }>(
    "/api/v1/brands/:brandId/presenter",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      const brand = await core.getBrand(account.id, request.params.brandId);
      return options.service.get(brand.workspaceId, brand.id);
    },
  );

  app.put<{ Params: { brandId: string }; Body: PutBrandPresenterRequest }>(
    "/api/v1/brands/:brandId/presenter",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      const brand = await core.getBrand(account.id, request.params.brandId);
      return options.service.save(
        brand.workspaceId,
        brand.id,
        request.body ?? ({} as PutBrandPresenterRequest),
      );
    },
  );
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  service: KairoService,
  verifier: IdentityVerifier,
) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "Authentication is required",
      code: "unauthorized",
      correlationId: request.id,
    });
    return null;
  }
  return service.establishSession(identity);
}
