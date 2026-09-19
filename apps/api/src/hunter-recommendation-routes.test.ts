import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { HunterRunInput, HunterRunResult } from "@kairo/worker/hunter";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import {
  registerHunterRecommendationRoutes,
  type HunterRecommendationRunner,
} from "./hunter-recommendation-routes";
import { MemoryKairoRepository } from "./store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:")
      ? { provider: "test", subject: value.slice("Bearer test:".length) }
      : null;
  }
}

const emptyResult: HunterRunResult = {
  evidenceCount: 0,
  candidateCount: 0,
  opportunityCount: 0,
};

async function setupBrand(store: MemoryKairoRepository, subject = "alice") {
  const account = await store.resolveAccount({ provider: "test", subject });
  const created = await store.createWorkspaceWithBrand(account.id, {
    workspaceName: `${subject} workspace`,
    brandName: `${subject} brand`,
  });
  return { account, ...created };
}

async function addReadyBrain(
  store: MemoryKairoRepository,
  accountId: string,
  brandId: string,
  input: { category?: string; topics?: string } = {},
) {
  const fields = [
    ["identity.description", "identity", "AI-powered content intelligence for brands"],
    ["identity.products-services", "identity", "Content discovery and creation"],
    ["identity.category", "identity", input.category ?? "AI"],
    ["audience.primary", "audience", "Software teams"],
    ["positioning.value-proposition", "positioning", "Turn Brand intelligence into useful content decisions"],
    ["content.pillars", "content-strategy", input.topics ?? "AI agents, software architecture"],
    ["boundaries.excluded-topics", "boundaries", "Unsupported claims"],
  ] as const;
  for (const [fieldKey, section, value] of fields) {
    await store.putConfirmedBrandBrainField(accountId, brandId, fieldKey, { section, value });
  }
}

describe("VS-97 Hunter recommendations API", () => {
  it("requires authentication", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: verifier, runner: { async runForAuthorizedBrand() { return emptyResult; } } });

    const response = await app.inject({ method: "POST", url: "/api/v1/brands/unknown/recommendations" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "unauthorized" });
    await app.close();
  });

  it("refuses to run Hunter until canonical Brand Brain activation is ready", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const { account, brand } = await setupBrand(store);
    await store.putConfirmedBrandBrainField(account.id, brand.id, "identity.description", {
      section: "identity",
      value: "Partial Brand context",
    });
    let runs = 0;
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, {
      store,
      identityVerifier: verifier,
      runner: { async runForAuthorizedBrand() { runs += 1; return emptyResult; } },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/recommendations`,
      headers: { authorization: "Bearer test:alice" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "hunter_not_ready",
      readiness: "needs-enrichment",
    });
    expect(response.json().gaps).toEqual(expect.arrayContaining(["offerings", "audience", "positioning", "topics", "boundaries"]));
    expect(runs).toBe(0);
    await app.close();
  });

  it("uses canonical Snapshot + Discovery Plan lineage and returns truthful zero-result Hunter runs", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const { account, brand } = await setupBrand(store);
    await addReadyBrain(store, account.id, brand.id);
    let captured: HunterRunInput | undefined;
    const runner: HunterRecommendationRunner = {
      async runForAuthorizedBrand(input) {
        captured = input;
        return emptyResult;
      },
    };
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: verifier, runner });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/recommendations`,
      headers: { authorization: "Bearer test:alice" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(emptyResult);
    expect(captured).toMatchObject({
      accountId: account.id,
      maxEvidence: 20,
      brand: {
        workspaceId: brand.workspaceId,
        brandId: brand.id,
        brandName: brand.name,
      },
      intelligenceProfile: {
        sector: "AI",
        audiences: expect.arrayContaining(["Software teams"]),
        topics: ["AI agents", "software architecture"],
        excludedTopics: expect.arrayContaining(["Unsupported claims"]),
      },
    });
    expect(captured?.brand.contextVersion).toContain(`${brand.id}@`);
    expect(captured?.brand.contextVersion).toContain(":discovery:1");
    expect(captured?.query).toBeUndefined();
    await app.close();
  });

  it("uses the generic intelligence pack when no bespoke sector pack matches the Brand", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const { account, brand } = await setupBrand(store);
    await addReadyBrain(store, account.id, brand.id, { category: "Restaurant", topics: "seasonal menus" });
    let captured: HunterRunInput | undefined;
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, {
      store,
      identityVerifier: verifier,
      runner: {
        async runForAuthorizedBrand(input) {
          captured = input;
          return emptyResult;
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/recommendations`,
      headers: { authorization: "Bearer test:alice" },
    });

    expect(response.statusCode).toBe(200);
    expect(captured?.intelligenceProfile).toMatchObject({ sector: "Restaurant", topics: ["seasonal menus"] });
    expect(captured?.query).toBeUndefined();
    await app.close();
  });

  it("fails closed when the Hunter runtime is unavailable", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const { account, brand } = await setupBrand(store);
    await addReadyBrain(store, account.id, brand.id);
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: verifier });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/recommendations`,
      headers: { authorization: "Bearer test:alice" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "hunter_unavailable" });
    await app.close();
  });

  it("does not expose another account's Brand", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const { account, brand } = await setupBrand(store, "alice");
    await addReadyBrain(store, account.id, brand.id);
    await setupBrand(store, "bob");
    let runs = 0;
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, {
      store,
      identityVerifier: verifier,
      runner: { async runForAuthorizedBrand() { runs += 1; return emptyResult; } },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/recommendations`,
      headers: { authorization: "Bearer test:bob" },
    });

    expect(response.statusCode).toBe(404);
    expect(runs).toBe(0);
    await app.close();
  });

  it("coalesces concurrent Hunter clicks for the same Brand", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const { account, brand } = await setupBrand(store);
    await addReadyBrain(store, account.id, brand.id);
    let runs = 0;
    let release!: (result: HunterRunResult) => void;
    const pending = new Promise<HunterRunResult>((resolve) => { release = resolve; });
    const runner: HunterRecommendationRunner = {
      async runForAuthorizedBrand() {
        runs += 1;
        return pending;
      },
    };
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: verifier, runner });

    const request = () => app.inject({
      method: "POST" as const,
      url: `/api/v1/brands/${brand.id}/recommendations`,
      headers: { authorization: "Bearer test:alice" },
    });
    const first = request();
    const second = request();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(1);
    release({ evidenceCount: 3, candidateCount: 2, opportunityCount: 1 });

    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses.map((response) => response.json().opportunityCount)).toEqual([1, 1]);
    expect(runs).toBe(1);
    await app.close();
  });
});