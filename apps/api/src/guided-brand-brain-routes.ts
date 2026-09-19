import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BuildBrandBrainRequest } from "@kairo/contracts";
import { KairoService, type KairoRepository } from "@kairo/domain";
import {
  BrandBrainBootstrapService,
  type BrandBrainProposalGenerator,
  type PublicBrandReferenceReader,
} from "@kairo/domain/brand-brain-bootstrap";
import { SanitizingPublicBrandReferenceReader } from "@kairo/domain/brand-brain-sanitizing-reader";
import type { IdentityVerifier } from "./auth";
import { SourceIntelligenceBrandReferenceReader } from "./source-intelligence";

export function registerGuidedBrandBrainRoutes(app: FastifyInstance, options: {
  store: KairoRepository;
  identityVerifier: IdentityVerifier;
  generator?: BrandBrainProposalGenerator;
  referenceReader?: PublicBrandReferenceReader;
}) {
  const core = new KairoService(options.store);
  const service = new BrandBrainBootstrapService(
    options.store,
    options.generator,
    new SanitizingPublicBrandReferenceReader(options.referenceReader ?? new SourceIntelligenceBrandReferenceReader()),
  );

  app.post<{ Params: { brandId: string }; Body: BuildBrandBrainRequest }>(
    "/api/v1/brands/:brandId/brain/bootstrap",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      return service.build(account.id, request.params.brandId, request.body ?? ({} as BuildBrandBrainRequest));
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
