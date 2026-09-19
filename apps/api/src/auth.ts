import { createRemoteJWKSet, jwtVerify } from "jose";
import type { ExternalIdentity } from "@kairo/contracts";

export interface IdentityVerifier {
  verify(authorizationHeader: string | undefined): Promise<ExternalIdentity | null>;
}

export interface OidcJwtVerifierOptions {
  issuer: string;
  audience: string;
  jwksUri: string;
}

export function normalizeOidcIssuer(value: string): string {
  const issuer = value.trim();
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export class OidcJwtVerifier implements IdentityVerifier {
  private readonly jwks;
  private readonly options: OidcJwtVerifierOptions;

  constructor(options: OidcJwtVerifierOptions) {
    this.options = { ...options, issuer: normalizeOidcIssuer(options.issuer) };
    this.jwks = createRemoteJWKSet(new URL(options.jwksUri));
  }

  async verify(authorizationHeader: string | undefined): Promise<ExternalIdentity | null> {
    const token = bearerToken(authorizationHeader);
    if (!token) return null;

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
      });
      if (!payload.sub) return null;
      return {
        provider: this.options.issuer,
        subject: payload.sub,
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
        ...(typeof payload.name === "string" ? { displayName: payload.name } : {}),
      };
    } catch (error) {
      if (process.env.KAIRO_AUTH_DIAGNOSTICS === "true") {
        const reason = error instanceof Error ? error.name : "unknown";
        console.warn(JSON.stringify({ event: "KAIRO_OIDC_TOKEN_REJECTED", reason, issuer: this.options.issuer, audience: this.options.audience }));
      }
      return null;
    }
  }
}
