import { createHmac, timingSafeEqual } from "node:crypto";

export const OIDC_TRANSACTION_COOKIE = "kairo_oidc_tx";
export const KAIRO_ACCESS_TOKEN_COOKIE = "kairo_access_token";
export const OIDC_TRANSACTION_MAX_AGE_SECONDS = 600;

type OidcTransaction = { state: string; codeVerifier: string; returnTo: string; createdAt: number };
const SIGNATURE_CONTEXT = "kairo-oidc-tx-v1";

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const base = new URL("https://kairo.invalid");
    const parsed = new URL(value, base);
    return parsed.origin === base.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch {
    return "/";
  }
}

export function encodeOidcTransaction(transaction: OidcTransaction, secret: string): string {
  const payload = Buffer.from(JSON.stringify(transaction), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function decodeOidcTransaction(value: string | undefined, secret: string, now = Date.now()): OidcTransaction | null {
  if (!value || !secret) return null;
  const [payload, supplied, extra] = value.split(".");
  if (!payload || !supplied || extra) return null;
  try {
    const expected = Buffer.from(signature(payload, secret), "base64url");
    const actual = Buffer.from(supplied, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OidcTransaction>;
    if (typeof parsed.state !== "string" || !parsed.state || typeof parsed.codeVerifier !== "string" || !parsed.codeVerifier || typeof parsed.returnTo !== "string" || typeof parsed.createdAt !== "number" || !Number.isFinite(parsed.createdAt)) return null;
    const age = now - parsed.createdAt;
    if (age < -30_000 || age > OIDC_TRANSACTION_MAX_AGE_SECONDS * 1000) return null;
    return { state: parsed.state, codeVerifier: parsed.codeVerifier, returnTo: safeReturnTo(parsed.returnTo), createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

export function jwtSecondsRemaining(token: string | undefined, now = Date.now()): number {
  if (!token) return 0;
  const parts = token.split(".");
  if (parts.length !== 3) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? Math.max(0, Math.floor(payload.exp - now / 1000)) : 0;
  } catch {
    return 0;
  }
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`${SIGNATURE_CONTEXT}.${payload}`, "utf8").digest("base64url");
}
