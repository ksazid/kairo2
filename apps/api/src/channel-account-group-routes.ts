import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KairoService, type KairoRepository } from "@kairo/domain";
import { ChannelAccountGroupService, type ChannelAccountGroupRepository, type ChannelAccountLookup } from "@kairo/domain/channel-account-group-service";
import type { IdentityVerifier } from "./auth";

export function registerChannelAccountGroupRoutes(app: FastifyInstance, options: {
  coreStore: KairoRepository;
  groupStore: ChannelAccountGroupRepository;
  channelStore: ChannelAccountLookup;
  identityVerifier: IdentityVerifier;
}) {
  const core = new KairoService(options.coreStore);
  const groups = new ChannelAccountGroupService(options.coreStore, options.groupStore, options.channelStore);

  app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/channel-account-groups", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return groups.list(account.id, request.params.brandId);
  });

  app.post<{ Params: { brandId: string }; Body: { name: string; memberAccountIds: string[] } }>("/api/v1/brands/:brandId/channel-account-groups", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return reply.status(201).send(await groups.create(account.id, request.params.brandId, request.body ?? ({} as { name: string; memberAccountIds: string[] })));
  });

  app.put<{ Params: { brandId: string; groupId: string }; Body: { name: string; memberAccountIds: string[] } }>("/api/v1/brands/:brandId/channel-account-groups/:groupId", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    return groups.update(account.id, request.params.brandId, request.params.groupId, request.body ?? ({} as { name: string; memberAccountIds: string[] }));
  });

  app.delete<{ Params: { brandId: string; groupId: string } }>("/api/v1/brands/:brandId/channel-account-groups/:groupId", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    await groups.remove(account.id, request.params.brandId, request.params.groupId);
    return reply.status(204).send();
  });
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, service: KairoService, verifier: IdentityVerifier) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Authentication is required", code: "unauthorized", correlationId: request.id });
    return null;
  }
  return service.establishSession(identity);
}
