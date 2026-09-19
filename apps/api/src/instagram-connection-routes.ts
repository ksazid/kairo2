import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DomainValidationError, KairoService, type KairoRepository } from "@kairo/domain";
import type { IdentityVerifier } from "./auth";
import type { InstagramConnectionService } from "./instagram-connection";

export function registerInstagramConnectionRoutes(app: FastifyInstance, deps: {
  coreStore: KairoRepository;
  identityVerifier: IdentityVerifier;
  service: InstagramConnectionService;
}) {
  const core = new KairoService(deps.coreStore);

  app.post<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/channels/instagram/connect", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    return deps.service.begin(account.id, request.params.brandId);
  });

  app.post<{ Body: { code?: string; state?: string } }>("/api/v1/channels/instagram/callback", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    if (!request.body?.code || !request.body?.state) throw new DomainValidationError("Meta callback code and state are required");
    return deps.service.complete(account.id, request.body.code, request.body.state);
  });

  app.get<{ Params: { brandId: string; intentId: string } }>("/api/v1/brands/:brandId/channels/instagram/intents/:intentId/candidates", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    return deps.service.candidates(account.id, request.params.brandId, request.params.intentId);
  });

  app.post<{ Params: { brandId: string; intentId: string }; Body: { candidateId?: string } }>("/api/v1/brands/:brandId/channels/instagram/intents/:intentId/select", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    if (!request.body?.candidateId) throw new DomainValidationError("candidateId is required");
    const selected = await deps.service.select(account.id, request.params.brandId, request.params.intentId, request.body.candidateId);
    const { credentialRef: _, ...safe } = selected;
    return safe;
  });

  app.post<{ Params: { brandId: string; channelAccountId: string } }>("/api/v1/brands/:brandId/channels/instagram/:channelAccountId/disconnect", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    await deps.service.disconnect(account.id, request.params.brandId, request.params.channelAccountId);
    return reply.status(204).send();
  });

  app.post<{ Params: { brandId: string; channelAccountId: string } }>("/api/v1/brands/:brandId/channels/instagram/:channelAccountId/refresh-source", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier); if (!account) return;
    await deps.service.refreshSource(account.id, request.params.brandId, request.params.channelAccountId);
    return reply.status(204).send();
  });
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, core: KairoService, verifier: IdentityVerifier) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) { await reply.status(401).send({ type:"https://kairo.local/problems/unauthorized", title:"Unauthorized", status:401, detail:"A valid bearer token is required.", code:"unauthorized", correlationId:request.id }); return null; }
  return core.establishSession(identity);
}
