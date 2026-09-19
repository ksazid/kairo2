import { NextRequest, NextResponse } from "next/server";
import { oidcAudience, oidcClient, oidcClientSecret, oidcConfiguration, oidcFailureDiagnostic } from "../../../lib/auth";
import { encodeOidcTransaction, OIDC_TRANSACTION_COOKIE, OIDC_TRANSACTION_MAX_AGE_SECONDS, safeReturnTo } from "../../../lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const oidc = oidcClient();
    const configuration = await oidcConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const parameters = {
      redirect_uri: new URL("/auth/callback", request.url).href,
      scope: "openid profile email",
      audience: oidcAudience(),
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
    };
    const response = NextResponse.redirect(oidc.buildAuthorizationUrl(configuration, parameters));
    response.cookies.set(OIDC_TRANSACTION_COOKIE, encodeOidcTransaction({ state, codeVerifier, returnTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")), createdAt: Date.now() }, oidcClientSecret()), {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/auth",
      maxAge: OIDC_TRANSACTION_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    console.error("OIDC authentication failure", oidcFailureDiagnostic("login"));
    return authFailure(request, "Authentication service is temporarily unavailable. Please try again.");
  }
}

function authFailure(request: NextRequest, message: string) {
  const target = new URL("/", request.url);
  target.searchParams.set("authError", message);
  const response = NextResponse.redirect(target);
  response.cookies.set(OIDC_TRANSACTION_COOKIE, "", { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/auth", maxAge: 0 });
  return response;
}
