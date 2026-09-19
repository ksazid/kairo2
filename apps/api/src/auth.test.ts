import { describe, expect, it } from "vitest";
import { normalizeOidcIssuer } from "./auth";

describe("OIDC issuer normalization", () => {
  it("preserves the canonical trailing slash required by issuer validation", () => {
    expect(normalizeOidcIssuer("https://dev-example.us.auth0.com/")).toBe("https://dev-example.us.auth0.com/");
    expect(normalizeOidcIssuer("https://dev-example.us.auth0.com")).toBe("https://dev-example.us.auth0.com/");
  });

  it("trims deployment whitespace without changing the issuer host", () => {
    expect(normalizeOidcIssuer("  https://dev-example.us.auth0.com  ")).toBe("https://dev-example.us.auth0.com/");
  });
});
