import * as client from "openid-client";

const OIDC_ENVIRONMENT_VARIABLES = [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_AUDIENCE",
] as const;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const oidcIssuer = () => required("OIDC_ISSUER").replace(/\/?$/, "/");
export const oidcClientId = () => required("OIDC_CLIENT_ID");
export const oidcClientSecret = () => required("OIDC_CLIENT_SECRET");
export const oidcAudience = () => required("OIDC_AUDIENCE");

export function oidcFailureDiagnostic(stage: "login" | "callback" | "logout") {
  const missingEnvironmentVariables = OIDC_ENVIRONMENT_VARIABLES.filter(
    (name) => !process.env[name]?.trim(),
  );
  return {
    event: "oidc_initialization_failed",
    stage,
    category: missingEnvironmentVariables.length ? "configuration" : "provider_discovery",
    missingEnvironmentVariables,
  };
}

let current: Promise<client.Configuration> | undefined;
export function oidcConfiguration() {
  if (!current) {
    current = client.discovery(new URL(oidcIssuer()), oidcClientId(), oidcClientSecret());
    void current.catch(() => { current = undefined; });
  }
  return current;
}

export const oidcClient = () => client;
