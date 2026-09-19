import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KairoService, type KairoRepository } from "@kairo/domain";
import type { IdentityVerifier } from "./auth";
import { ConceptMockupAssetService, ConceptMockupAssetsUnavailableError } from "./concept-mockup-assets";

export function registerConceptMockupAssetRoutes(app: FastifyInstance, options: { store: KairoRepository; identityVerifier: IdentityVerifier; service: ConceptMockupAssetService }) {
  const core = new KairoService(options.store);
  app.get<{ Params: { brandId: string; opportunityId: string } }>("/api/v1/brands/:brandId/opportunities/:opportunityId/concept-assets", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return options.service.list(account.id, request.params.brandId, request.params.opportunityId);
  });
  app.post<{ Params: { brandId: string; opportunityId: string } }>("/api/v1/brands/:brandId/opportunities/:opportunityId/concept-assets", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    try {
      return reply.status(201).send(await options.service.generate(account.id, request.params.brandId, request.params.opportunityId));
    } catch (error) {
      if (error instanceof ConceptMockupAssetsUnavailableError) {
        return reply.status(503).send({ type: "about:blank", title: "Concept visual generation unavailable", status: 503, detail: error.message, code: "concept_assets_unavailable", correlationId: request.id });
      }
      throw error;
    }
  });
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, service: KairoService, verifier: IdentityVerifier) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) { reply.status(401).send({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Missing bearer token" }); return undefined; }
  const identity = await verifier.verify(header);
  if (!identity) { reply.status(401).send({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Authentication is required" }); return undefined; }
  return service.establishSession(identity);
}
