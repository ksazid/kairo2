import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { registerBrandRoutes } from "./brand-routes";
import { MemoryKairoRepository } from "./store";

class TestIdentityVerifier implements IdentityVerifier {
  async verify(header: string | undefined): Promise<ExternalIdentity | null> {
    if (!header?.startsWith("Bearer test:")) return null;
    const subject = header.slice("Bearer test:".length);
    return subject ? { provider: "https://issuer.test", subject } : null;
  }
}

function testApp() {
  const store = new MemoryKairoRepository();
  const identityVerifier = new TestIdentityVerifier();
  const app = buildApp({ store, identityVerifier });
  registerBrandRoutes(app, {
    store,
    identityVerifier,
    creator: { createBrand: (accountId, workspaceId, input) => store.createBrandForAccount(accountId, workspaceId, input) },
  });
  return app;
}

describe("VS-73 multi-Brand API", () => {
  it("creates an additional Brand inside an existing Workspace and keeps Brand scopes distinct", async () => {
    const app = testApp();
    const alice = { authorization: "Bearer test:alice" };
    const initial = await app.inject({
      method: "POST", url: "/api/v1/workspaces", headers: alice,
      payload: { workspaceName: "Studio", brandName: "Brand A" },
    });
    const workspaceId = initial.json().workspace.id as string;
    const brandAId = initial.json().brand.id as string;

    const second = await app.inject({
      method: "POST", url: `/api/v1/workspaces/${workspaceId}/brands`, headers: alice,
      payload: { brandName: " Brand B " },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ workspaceId, name: "Brand B" });
    expect(second.json().id).not.toBe(brandAId);

    const listed = await app.inject({ method: "GET", url: `/api/v1/workspaces/${workspaceId}/brands`, headers: alice });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: brandAId, name: "Brand A" }),
      expect.objectContaining({ id: second.json().id, name: "Brand B" }),
    ]));
    expect(listed.json()).toHaveLength(2);
    await app.close();
  });

  it("preserves Website and Instagram references for an additional Brand", async () => {
    const app = testApp();
    const alice = { authorization: "Bearer test:alice" };
    const initial = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: alice, payload: { workspaceName: "Studio", brandName: "First" } });
    const workspaceId = initial.json().workspace.id as string;
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspaceId}/brands`,
      headers: alice,
      payload: { brandName: "Second", publicSourceUrl: "https://example.com/about", publicProfileUrl: "https://www.instagram.com/example/" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ publicSourceUrl: "https://example.com/about", publicProfileUrl: "https://www.instagram.com/example/" });
    await app.close();
  });

  it("returns safe not-found behavior when a foreign account tries to create or read a Brand in another Workspace", async () => {
    const app = testApp();
    const alice = { authorization: "Bearer test:alice" };
    const bob = { authorization: "Bearer test:bob" };
    const initial = await app.inject({
      method: "POST", url: "/api/v1/workspaces", headers: alice,
      payload: { workspaceName: "Private Studio", brandName: "Private A" },
    });
    const workspaceId = initial.json().workspace.id as string;

    const forbiddenCreate = await app.inject({
      method: "POST", url: `/api/v1/workspaces/${workspaceId}/brands`, headers: bob,
      payload: { brandName: "Intruder Brand" },
    });
    expect(forbiddenCreate.statusCode).toBe(404);
    expect(forbiddenCreate.json().code).toBe("resource_not_found");

    const aliceList = await app.inject({ method: "GET", url: `/api/v1/workspaces/${workspaceId}/brands`, headers: alice });
    expect(aliceList.json()).toHaveLength(1);
    expect(aliceList.json()[0].name).toBe("Private A");
    await app.close();
  });

  it("validates Brand names without creating partial state", async () => {
    const app = testApp();
    const alice = { authorization: "Bearer test:alice" };
    const initial = await app.inject({
      method: "POST", url: "/api/v1/workspaces", headers: alice,
      payload: { workspaceName: "Studio", brandName: "First" },
    });
    const workspaceId = initial.json().workspace.id as string;
    const invalid = await app.inject({
      method: "POST", url: `/api/v1/workspaces/${workspaceId}/brands`, headers: alice,
      payload: { brandName: "   " },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("validation_error");
    const listed = await app.inject({ method: "GET", url: `/api/v1/workspaces/${workspaceId}/brands`, headers: alice });
    expect(listed.json()).toHaveLength(1);
    await app.close();
  });

  it("rejects private-host Website references", async () => {
    const app = testApp();
    const alice = { authorization: "Bearer test:alice" };
    const initial = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: alice, payload: { workspaceName: "Studio", brandName: "First" } });
    const workspaceId = initial.json().workspace.id as string;
    const invalid = await app.inject({ method: "POST", url: `/api/v1/workspaces/${workspaceId}/brands`, headers: alice, payload: { brandName: "Second", publicSourceUrl: "http://127.0.0.1/private" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("validation_error");
    await app.close();
  });
});
