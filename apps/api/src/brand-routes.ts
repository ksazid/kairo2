import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountDto, CreateBrandRequest } from "@kairo/contracts";
import { DomainValidationError, KairoService, type KairoRepository } from "@kairo/domain";
import type { IdentityVerifier } from "./auth";
import type { BrandCreatorPort } from "./brand-creator";

export interface BrandRouteOptions {
  store: KairoRepository;
  creator: BrandCreatorPort;
  identityVerifier: IdentityVerifier;
}

export function registerBrandRoutes(app: FastifyInstance, options: BrandRouteOptions): void {
  const service = new KairoService(options.store);

  app.post<{ Params: { workspaceId: string }; Body: Partial<CreateBrandRequest> }>(
    "/api/v1/workspaces/:workspaceId/brands",
    async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      const brandName = requiredBrandName(request.body?.brandName);
      const publicSourceUrl = optionalPublicUrl(request.body?.publicSourceUrl, "publicSourceUrl");
      const publicProfileUrl = optionalPublicUrl(request.body?.publicProfileUrl, "publicProfileUrl");
      const brand = await options.creator.createBrand(account.id, request.params.workspaceId, {
        brandName,
        ...(publicSourceUrl ? { publicSourceUrl } : {}),
        ...(publicProfileUrl ? { publicProfileUrl } : {}),
      });
      return reply.status(201).send(brand);
    },
  );
}

function optionalPublicUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new DomainValidationError(`${field} must be a URL`);
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsafe");
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || unsafeIpLiteral(host)) throw new Error("unsafe");
    return url.toString();
  } catch {
    throw new DomainValidationError(`${field} must be a valid public HTTP(S) URL`);
  }
}

function unsafeIpLiteral(host: string): boolean {
  if (host.includes(":")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a = 0, b = 0] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  service: KairoService,
  verifier: IdentityVerifier,
): Promise<AccountDto | null> {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send({
      type: "https://kairo.local/problems/unauthorized",
      title: "Unauthorized",
      status: 401,
      detail: "A valid bearer token is required.",
      code: "unauthorized",
      correlationId: request.id,
    });
    return null;
  }
  return service.establishSession(identity);
}

function requiredBrandName(value: unknown): string {
  if (typeof value !== "string") throw new DomainValidationError("brandName is required");
  const brandName = value.trim();
  if (!brandName) throw new DomainValidationError("brandName is required");
  if (brandName.length > 120) throw new DomainValidationError("brandName is too long");
  return brandName;
}
