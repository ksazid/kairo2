import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryKairoRepository } from "./store";

class TestIdentityVerifier implements IdentityVerifier {
  async verify(header: string | undefined): Promise<ExternalIdentity | null> {
    if (!header?.startsWith("Bearer test:")) return null;
    const subject = header.slice("Bearer test:".length);
    if (!subject) return null;
    return { provider: "https://issuer.test", subject, email: `${subject}@example.com` };
  }
}

function testApp() {
  return buildApp({ store: new MemoryKairoRepository(), identityVerifier: new TestIdentityVerifier() });
}

describe("VS-01 API", () => {
  it("exposes a public health endpoint", async () => {
    const app = testApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("rejects unauthenticated account requests", async () => {
    const app = testApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/session" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("unauthorized");
    await app.close();
  });

  it("reuses the same account for the same external identity", async () => {
    const app = testApp();
    const first = await app.inject({ method: "GET", url: "/api/v1/session", headers: { authorization: "Bearer test:alice" } });
    const second = await app.inject({ method: "GET", url: "/api/v1/session", headers: { authorization: "Bearer test:alice" } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().account.id).toBe(second.json().account.id);
    await app.close();
  });

  it("creates the initial workspace, owner membership and brand", async () => {
    const app = testApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: "Bearer test:alice" },
      payload: { workspaceName: "Studio", brandName: "Kairo" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().workspace.role).toBe("owner");

    const workspaces = await app.inject({ method: "GET", url: "/api/v1/workspaces", headers: { authorization: "Bearer test:alice" } });
    expect(workspaces.json()).toHaveLength(1);
    expect(workspaces.json()[0].name).toBe("Studio");
    await app.close();
  });

  it("does not let a foreign account enumerate a workspace or brand", async () => {
    const app = testApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: "Bearer test:alice" },
      payload: { workspaceName: "Studio", brandName: "Private Brand" },
    });
    const body = created.json();

    const brands = await app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${body.workspace.id}/brands`,
      headers: { authorization: "Bearer test:bob" },
    });
    expect(brands.statusCode).toBe(404);

    const brand = await app.inject({
      method: "GET",
      url: `/api/v1/brands/${body.brand.id}`,
      headers: { authorization: "Bearer test:bob" },
    });
    expect(brand.statusCode).toBe(404);
    await app.close();
  });

  it("returns customer-safe validation errors", async () => {
    const app = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: "Bearer test:alice" },
      payload: { workspaceName: "", brandName: "Kairo" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation_error", status: 400 });
    expect(response.headers["x-correlation-id"]).toBeTruthy();
    await app.close();
  });
});
