import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { registerBrandDnaReadinessRoutes } from "./brand-dna-readiness-routes";
import { MemoryKairoRepository } from "./store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice("Bearer test:".length) } : null;
  }
}

describe("Brand DNA readiness route", () => {
  it("is authenticated, Brand-scoped and evaluates the current Brain", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const app = buildApp({ store, identityVerifier: verifier });
    registerBrandDnaReadinessRoutes(app, { store, identityVerifier: verifier });
    expect((await app.inject({ method: "GET", url: "/api/v1/brands/unknown/brain/readiness" })).statusCode).toBe(401);
    const setup = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: { authorization: "Bearer test:alice" }, payload: { workspaceName: "Studio", brandName: "Brand" } });
    const brandId = setup.json().brand.id as string;
    const response = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/brain/readiness`, headers: { authorization: "Bearer test:alice" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "needs-enrichment", gaps: expect.arrayContaining(["business", "offerings", "audience"]) });
    await app.close();
  });

  it("returns the Flow 1B activation snapshot and reflects inline owner confirmation", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const app = buildApp({ store, identityVerifier: verifier });
    registerBrandDnaReadinessRoutes(app, { store, identityVerifier: verifier });

    expect((await app.inject({ method: "GET", url: "/api/v1/brands/unknown/brain/activation" })).statusCode).toBe(401);
    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: "Bearer test:alice" },
      payload: { workspaceName: "Studio", brandName: "Brand" },
    });
    const brandId = setup.json().brand.id as string;

    const empty = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/brain/activation`, headers: { authorization: "Bearer test:alice" } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      status: "needs-enrichment",
      hunterReady: false,
      brain: [],
      sources: [],
      completeness: { score: 0, knownGroups: 0, totalGroups: 6 },
    });

    const confirmed = await app.inject({
      method: "PUT",
      url: `/api/v1/brands/${brandId}/brain/audience.primary`,
      headers: { authorization: "Bearer test:alice" },
      payload: { section: "audience", value: "Independent Malta travellers" },
    });
    expect(confirmed.statusCode).toBe(200);

    const activated = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/brain/activation`, headers: { authorization: "Bearer test:alice" } });
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({
      hunterReady: false,
      fields: expect.arrayContaining([
        expect.objectContaining({ fieldKey: "audience.primary", origin: "user-confirmed", confidence: { score: 1, level: "high" } }),
      ]),
    });

    await app.close();
  });
});
