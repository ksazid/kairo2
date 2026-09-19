import { NextRequest, NextResponse } from "next/server";
import { beginMetaConnection, safeV2ChannelsHref, type MetaConnectionMode } from "../../../../../lib/meta-channel-api";

export const dynamic = "force-dynamic";

const modes = new Set<MetaConnectionMode>(["instagram", "facebook-instagram", "facebook"]);
const returnCookie = "kairo_v2_meta_return_to";

export async function GET(request: NextRequest, { params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  const brandId = request.nextUrl.searchParams.get("brand") ?? "";
  const returnTo = safeV2ChannelsHref(request.nextUrl.searchParams.get("returnTo"), brandId);
  if (!brandId || !modes.has(mode as MetaConnectionMode)) return redirectWithError(request, returnTo, "Connection type is not supported");
  try {
    const { authorizationUrl } = await beginMetaConnection(brandId, mode as MetaConnectionMode);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(returnCookie, returnTo, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: 600, path: "/channels/meta" });
    return response;
  } catch (error) {
    return redirectWithError(request, returnTo, error instanceof Error ? error.message : "Unable to start channel connection");
  }
}

function redirectWithError(request: NextRequest, href: string, error: string) {
  const target = new URL(href, request.url);
  target.searchParams.set("error", error);
  return NextResponse.redirect(target);
}
