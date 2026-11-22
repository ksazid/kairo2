import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ExternalIdentity } from "@kairo/contracts";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { MemoryKairoRepository } from "./store";
import { registerExternalInstagramPostRoutes } from "./external-instagram-post-routes";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null;
  }
}

describe("manually linked Instagram Reel", () => {
  it("requires authentication and a canonical Reel URL before any database write", async () => {
    const query = vi.fn();
    const coreStore = new MemoryKairoRepository();
    const app = buildApp({ store: coreStore, identityVerifier: new Verifier() });
    registerExternalInstagramPostRoutes(app, { coreStore, identityVerifier: new Verifier(), pool: { connect: vi.fn(), query } as unknown as Pool });
    const url = "/api/v1/brands/brand/campaigns/campaign/assets/asset/external-instagram-post";
    expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
    const invalid = await app.inject({ method: "POST", url, headers: { authorization: "Bearer test:alice" }, payload: { publishedUrl: "https://evil.test/reel/Df9ddr2EYGp/", channelAccountId: "account", expectedVersion: 4 } });
    expect(invalid.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it("records a Meta-published URL without creating a Kairo publishing command", async () => {
    const coreStore = new MemoryKairoRepository();
    const verifier = new Verifier();
    const setupApp = buildApp({ store: coreStore, identityVerifier: verifier });
    const setup = await setupApp.inject({ method: "POST", url: "/api/v1/workspaces", headers: { authorization: "Bearer test:alice" }, payload: { workspaceName: "Studio", brandName: "Duke" } });
    const brandId = setup.json().brand.id;
    await setupApp.close();
    const app = buildApp({ store: coreStore, identityVerifier: verifier });
    const canonical = "https://www.instagram.com/reel/Df9ddr2EYGp/";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select a.workspace_id")) return { rows: [{ workspace_id: "ws", current_version: 4, version_id: "version-4" }] };
      if (sql.includes("select published_url,shortcode")) return { rows: [{ published_url: canonical, shortcode: "Df9ddr2EYGp", version_id: "version-4", linked_at: new Date().toISOString() }] };
      return { rows: [] };
    });
    registerExternalInstagramPostRoutes(app, { coreStore, identityVerifier: verifier, pool: { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool });
    const response = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/campaigns/campaign/assets/asset/external-instagram-post`, headers: { authorization: "Bearer test:alice" }, payload: { publishedUrl: "https://www.instagram.com/_dukeman390/reel/Df9ddr2EYGp/", channelAccountId: "account", expectedVersion: 4 } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ link: { published_url: canonical }, metricsStatus: "unavailable", source: "manually-linked" });
    expect(query.mock.calls.some(([sql]) => sql.includes("insert into publish_commands"))).toBe(false);
    await app.close();
  });
});
