import { NextRequest, NextResponse } from "next/server";
import { beginInstagramConnection, safeV2ChannelsHref } from "../../../../lib/meta-channel-api";

export const dynamic = "force-dynamic";
const returnCookie = "kairo_v2_instagram_return_to";

export async function GET(request: NextRequest) {
  const brandId = request.nextUrl.searchParams.get("brand") ?? "";
  const returnTo = safeV2ChannelsHref(request.nextUrl.searchParams.get("returnTo"), brandId);
  if (!brandId) return redirectWithError(request, "/settings?tab=channels", "Choose a Brand before connecting Instagram.");
  try {
    const { authorizationUrl } = await beginInstagramConnection(brandId);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(returnCookie, returnTo, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: 600, path: "/channels/instagram" });
    return response;
  } catch (error) {
    return redirectWithError(request, returnTo, error instanceof Error ? error.message : "Unable to start Instagram connection");
  }
}

function redirectWithError(request: NextRequest, href: string, error: string) {
  const target = new URL(href, request.url);
  target.searchParams.set("error", error);
  return NextResponse.redirect(target);
}
