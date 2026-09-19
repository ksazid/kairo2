import { NextRequest, NextResponse } from "next/server";
import { oidcClient, oidcClientSecret, oidcConfiguration, oidcFailureDiagnostic } from "../../../lib/auth";
import { decodeOidcTransaction, jwtSecondsRemaining, KAIRO_ACCESS_TOKEN_COOKIE, OIDC_TRANSACTION_COOKIE } from "../../../lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const transaction = decodeOidcTransaction(request.cookies.get(OIDC_TRANSACTION_COOKIE)?.value, oidcClientSecret());
    if (!transaction) return failure(request, "Authentication session expired. Please sign in again.");
    const oidc = oidcClient();
    const tokens = await oidc.authorizationCodeGrant(await oidcConfiguration(), new URL(request.url), { pkceCodeVerifier: transaction.codeVerifier, expectedState: transaction.state });
    if (!tokens.access_token) return failure(request, "Identity provider did not return an access token.");
    const jwtLifetime = jwtSecondsRemaining(tokens.access_token);
    const reportedLifetime = typeof tokens.expires_in === "number" ? Math.floor(tokens.expires_in) : 0;
    const maxAge = Math.max(1, jwtLifetime > 0 && reportedLifetime > 0 ? Math.min(jwtLifetime, reportedLifetime) : jwtLifetime || reportedLifetime || 900);
    const response = NextResponse.redirect(new URL(transaction.returnTo, request.url));
    response.cookies.set(KAIRO_ACCESS_TOKEN_COOKIE, tokens.access_token, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge });
    clearTransaction(response);
    return response;
  } catch {
    console.error("OIDC authentication failure", oidcFailureDiagnostic("callback"));
    return failure(request, "Authentication failed. Please try again.");
  }
}

function clearTransaction(response: NextResponse) {
  response.cookies.set(OIDC_TRANSACTION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/auth", maxAge: 0 });
}

function failure(request: NextRequest, message: string) {
  const target = new URL("/", request.url);
  target.searchParams.set("authError", message);
  const response = NextResponse.redirect(target);
  clearTransaction(response);
  response.cookies.delete(KAIRO_ACCESS_TOKEN_COOKIE);
  return response;
}
