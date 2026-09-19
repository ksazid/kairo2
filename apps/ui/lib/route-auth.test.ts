import { describe, expect, it } from "vitest";
import { isPublicRoute, loginPath, protectedReturnTo } from "./route-auth";

describe("V2 route authentication", () => {
  it("preserves an internal page and query as the post-login destination", () => {
    expect(protectedReturnTo("/discover", "?brand=brand-1")).toBe("/discover?brand=brand-1");
    expect(loginPath("/discover?brand=brand-1")).toBe("/auth/login?returnTo=%2Fdiscover%3Fbrand%3Dbrand-1");
  });

  it("leaves only authentication and framework assets public", () => {
    expect(isPublicRoute("/auth/login")).toBe(true);
    expect(isPublicRoute("/_next/static/chunk.js")).toBe(true);
    expect(isPublicRoute("/discover")).toBe(false);
    expect(isPublicRoute("/")).toBe(false);
  });
});
