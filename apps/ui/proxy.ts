import { NextRequest, NextResponse } from "next/server";
import { isPublicRoute, loginPath, protectedReturnTo } from "./lib/route-auth";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicRoute(pathname) || pathname.startsWith("/api/")) return NextResponse.next();
  if (request.cookies.has("kairo_access_token")) return NextResponse.next();

  const destination = request.nextUrl.clone();
  destination.pathname = "/auth/login";
  destination.search = "";
  destination.searchParams.set("returnTo", protectedReturnTo(pathname, search));
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
