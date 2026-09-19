import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { registerGuidedBrandBrainRoutes } from "./guided-brand-brain-routes";
import { MemoryKairoRepository } from "./store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:")
      ? { provider: "test", subject: value.slice("Bearer test:".length) }
      : null;
  }
}

describe("VS-26 guided Brand Brain API", () => {
  it("requires authentication and saves owner intent even when source-backed inference is unavailable", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const app = buildApp({ store, identityVerifier: verifier });
    registerGuidedBrandBrainRoutes(app, { store, identityVerifier: verifier });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v1/brands/unknown/brain/bootstrap",
      payload: { primaryObjective: "grow-audience" },
    });
    expect(unauthorized.statusCode).toBe(401);

    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: "Bearer test:alice" },
      payload: { workspaceName: "Dukeman Studio", brandName: "The Duke 390" },
    });
    expect(setup.statusCode).toBe(201);
    const brandId = setup.json().brand.id as string;

    const bootstrap = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/brain/bootstrap`,
      headers: { authorization: "Bearer test:alice" },
      payload: {
        primaryObjective: "grow-audience",
        ownerBoundary: "Do not glorify dangerous street riding.",
      },
    });

    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      generatorStatus: "unavailable",
      proposedCount: 0,
      sourceIds: [],
    });
    expect(bootstrap.json().brain).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "goals.objectives", value: "Grow audience", state: "confirmed" }),
      expect.objectContaining({ fieldKey: "boundaries.owner-directive", state: "confirmed" }),
    ]));

    await app.close();
  });

  it("allows onboarding to bootstrap without asking the owner to select a goal", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const app = buildApp({ store, identityVerifier: verifier });
    registerGuidedBrandBrainRoutes(app, { store, identityVerifier: verifier });

    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: "Bearer test:alice" },
      payload: { workspaceName: "Dukeman", brandName: "Dukeman" },
    });
    const brandId = setup.json().brand.id as string;

    const bootstrap = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/brain/bootstrap`,
      headers: { authorization: "Bearer test:alice" },
      payload: {},
    });

    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ generatorStatus: "unavailable", proposedCount: 0, sourceIds: [] });
    expect(bootstrap.json().brain).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "goals.objectives", state: "confirmed" }),
    ]));

    await app.close();
  });
});
