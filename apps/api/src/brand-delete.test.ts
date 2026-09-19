import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { MemoryKairoRepository } from "./store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null;
  }
}

describe("Brand deletion", () => {
  it("requires authentication and removes the Brand plus Brand Brain and sources", async () => {
    const store = new MemoryKairoRepository();
    const app = buildApp({ store, identityVerifier: new Verifier() });
    const headers = { authorization: "Bearer test:alice" };
    const created = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers, payload: { workspaceName: "Studio", brandName: "Delete me" } });
    const brand = created.json().brand;
    await app.inject({ method: "PUT", url: `/api/v1/brands/${brand.id}/brain/audience.primary`, headers, payload: { section: "audience", value: "Founders" } });
    await app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/sources`, headers, payload: { type: "note", content: "Temporary source" } });
    expect((await app.inject({ method: "DELETE", url: `/api/v1/brands/${brand.id}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/brands/${brand.id}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/v1/brands/${brand.id}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/brands/${brand.id}/brain`, headers })).statusCode).toBe(404);
    await app.close();
  });

  it("cannot delete another user's Brand", async () => {
    const store = new MemoryKairoRepository();
    const app = buildApp({ store, identityVerifier: new Verifier() });
    const alice = { authorization: "Bearer test:alice" };
    const bob = { authorization: "Bearer test:bob" };
    const created = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: alice, payload: { workspaceName: "Studio", brandName: "Protected" } });
    const response = await app.inject({ method: "DELETE", url: `/api/v1/brands/${created.json().brand.id}`, headers: bob });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
