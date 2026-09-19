import { describe, expect, it } from "vitest";
import { decodeOidcTransaction, encodeOidcTransaction, jwtSecondsRemaining, safeReturnTo } from "./auth-session";

describe("Kairo UI v2 OIDC session", () => {
  it("keeps return paths local", () => {
    expect(safeReturnTo("/brands/one?format=reel")).toBe("/brands/one?format=reel");
    expect(safeReturnTo("https://evil.example/path")).toBe("/");
    expect(safeReturnTo("//evil.example/path")).toBe("/");
  });

  it("round-trips a fresh signed transaction", () => {
    const now = Date.now();
    const value = encodeOidcTransaction({ state: "state", codeVerifier: "verifier", returnTo: "/?format=reel", createdAt: now }, "secret");
    expect(decodeOidcTransaction(value, "secret", now)).toMatchObject({ state: "state", returnTo: "/?format=reel" });
    expect(decodeOidcTransaction(value, "wrong", now)).toBeNull();
  });

  it("uses the access-token expiry for the cookie lifetime", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 2_000 })).toString("base64url");
    expect(jwtSecondsRemaining(`a.${payload}.c`, 1_000_000)).toBe(1_000);
  });
});
