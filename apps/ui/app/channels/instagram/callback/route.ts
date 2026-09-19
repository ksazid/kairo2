import { NextRequest, NextResponse } from "next/server";
import { completeInstagramConnection, MetaConnectionError, safeV2ChannelsHref } from "../../../../lib/meta-channel-api";

export const dynamic = "force-dynamic";
const returnCookie = "kairo_v2_instagram_return_to";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const providerError = request.nextUrl.searchParams.get("error");
  const stored = request.cookies.get(returnCookie)?.value;
  if (providerError || !code || !state) return finish(request, stored ?? "/settings?tab=channels", providerError ? "Instagram connection was cancelled or denied" : "Instagram callback was incomplete", true);
  try {
    const result = await completeInstagramConnection(code, state);
    const returnTo = safeV2ChannelsHref(stored, result.brandId);
    if (result.status === "selection-required") return redirect(request, `/channels/instagram/select?brand=${encodeURIComponent(result.brandId)}&intent=${encodeURIComponent(result.intentId)}&returnTo=${encodeURIComponent(returnTo)}`);
    return finish(request, returnTo, result.status === "connected" ? "Instagram connected" : "No eligible Instagram Professional account was found", result.status !== "connected");
  } catch (error) {
    if (error instanceof MetaConnectionError && error.status === 401) {
      const target = new URL("/auth/login", request.url);
      target.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(target);
    }
    return finish(request, stored ?? "/settings?tab=channels", error instanceof Error ? error.message : "Unable to complete Instagram connection", true);
  }
}

function finish(request: NextRequest, href: string, message: string, isError = false) {
  const target = new URL(href, request.url);
  target.searchParams.set(isError ? "error" : "notice", message);
  const response = NextResponse.redirect(target);
  response.cookies.delete(returnCookie);
  return response;
}

function redirect(request: NextRequest, href: string) {
  const response = NextResponse.redirect(new URL(href, request.url));
  response.cookies.delete(returnCookie);
  return response;
}
