import { NextRequest, NextResponse } from "next/server";
import { oidcClientId, oidcConfiguration, oidcFailureDiagnostic } from "../../../lib/auth";
import { KAIRO_ACCESS_TOKEN_COOKIE, OIDC_TRANSACTION_COOKIE } from "../../../lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const postLogout = new URL("/", request.url);
  let destination = postLogout;
  try {
    const endpoint = (await oidcConfiguration()).serverMetadata().end_session_endpoint;
    if (endpoint) {
      destination = new URL(endpoint);
      destination.searchParams.set("client_id", oidcClientId());
      destination.searchParams.set("post_logout_redirect_uri", postLogout.href);
    }
  } catch {
    console.error("OIDC authentication failure", oidcFailureDiagnostic("logout"));
    destination = postLogout;
  }
  const response = NextResponse.redirect(destination);
  response.cookies.delete(KAIRO_ACCESS_TOKEN_COOKIE);
  response.cookies.set(OIDC_TRANSACTION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/auth", maxAge: 0 });
  return response;
}
