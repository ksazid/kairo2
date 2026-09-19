import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountDto, CommandSearchResponse } from "@kairo/contracts";
import { DomainValidationError, KairoService, type KairoRepository } from "@kairo/domain";
import type { IdentityVerifier } from "./auth";
import type { CommandSearchRepository } from "./command-search";

export function registerCommandSearchRoutes(app: FastifyInstance, deps: { coreStore: KairoRepository; identityVerifier: IdentityVerifier; search: CommandSearchRepository }) {
  const core = new KairoService(deps.coreStore);
  app.get<{ Querystring: { q?: string; brandId?: string; limit?: string } }>("/api/v1/command-search", async (request, reply) => {
    const account = await authenticate(request, reply, core, deps.identityVerifier);
    if (!account) return;
    const query = requiredQuery(request.query.q);
    const brandId = optionalBrandId(request.query.brandId);
    const limit = boundedLimit(request.query.limit);
    const results = await deps.search.search(account.id, { query, ...(brandId ? { brandId } : {}), limit });
    const response: CommandSearchResponse = { query, scope: { ...(brandId ? { brandId } : {}) }, results };
    return response;
  });
}

function requiredQuery(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 2) throw new DomainValidationError("q must contain at least 2 characters");
  const query = value.trim();
  if (query.length > 120) throw new DomainValidationError("q must contain at most 120 characters");
  return query;
}
function optionalBrandId(value: unknown) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 160) throw new DomainValidationError("brandId is invalid");
  return value.trim();
}
function boundedLimit(value: unknown) {
  if (value == null || value === "") return 12;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new DomainValidationError("limit must be between 1 and 30");
  return limit;
}
async function authenticate(request: FastifyRequest, reply: FastifyReply, core: KairoService, verifier: IdentityVerifier): Promise<AccountDto | null> {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) { await reply.status(401).send({type:"about:blank",title:"Unauthorized",status:401,detail:"Authentication is required",code:"unauthorized",correlationId:request.id}); return null; }
  return core.establishSession(identity);
}
