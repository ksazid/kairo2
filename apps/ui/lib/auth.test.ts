import { afterEach, describe, expect, it, vi } from "vitest";
import { oidcFailureDiagnostic } from "./auth";

const names = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_AUDIENCE"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("oidcFailureDiagnostic", () => {
  it("reports missing variable names without exposing configured values", () => {
    vi.stubEnv("OIDC_ISSUER", "https://issuer.example/");
    vi.stubEnv("OIDC_CLIENT_ID", "");
    vi.stubEnv("OIDC_CLIENT_SECRET", "not-for-output");
    vi.stubEnv("OIDC_AUDIENCE", "");

    const diagnostic = oidcFailureDiagnostic("login");

    expect(diagnostic).toEqual({
      event: "oidc_initialization_failed",
      stage: "login",
      category: "configuration",
      missingEnvironmentVariables: ["OIDC_CLIENT_ID", "OIDC_AUDIENCE"],
    });
    expect(JSON.stringify(diagnostic)).not.toContain("not-for-output");
  });

  it("classifies failures as provider discovery when configuration is present", () => {
    for (const name of names) vi.stubEnv(name, `configured-${name}`);

    expect(oidcFailureDiagnostic("callback")).toEqual({
      event: "oidc_initialization_failed",
      stage: "callback",
      category: "provider_discovery",
      missingEnvironmentVariables: [],
    });
  });
});
