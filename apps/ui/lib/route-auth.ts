export function protectedReturnTo(pathname: string, search = ""): string {
  const path = pathname.startsWith("/") ? pathname : "/";
  const query = search.startsWith("?") ? search : search ? `?${search}` : "";
  return `${path}${query}`;
}

export function loginPath(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function isPublicRoute(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname === "/robots.txt" || pathname === "/sitemap.xml";
}
