import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { DiscoveryService } from "@kairo/domain/discovery-service";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryDiscoveryRepository } from "./discovery-store";
import { MemoryKairoRepository } from "./store";

class TestIdentityVerifier implements IdentityVerifier {
  async verify(header: string | undefined): Promise<ExternalIdentity | null> {
    if (!header?.startsWith("Bearer test:")) return null;
    const subject = header.slice("Bearer test:".length);
    return subject ? { provider: "https://issuer.test", subject, email: `${subject}@example.com` } : null;
  }
}

async function setup() {
  const store = new MemoryKairoRepository();
  const discoveryStore = new MemoryDiscoveryRepository(store);
  const app = buildApp({ store, discoveryStore, identityVerifier: new TestIdentityVerifier() });
  const auth = { authorization: "Bearer test:alice" };
  const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: auth });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    headers: auth,
    payload: { workspaceName: "Studio", brandName: "Kairo" },
  });
  return {
    app,
    auth,
    accountId: session.json().account.id as string,
    brandId: created.json().brand.id as string,
    discovery: new DiscoveryService(discoveryStore),
  };
}

const strongCandidate = {
  signal: {
    title: "Persistent agents change SaaS architecture",
    sourceUrl: "https://example.com/agents",
    platform: "web",
    retrievedAt: "2026-08-13T00:00:00.000Z",
    provider: "fixture",
  },
  title: "Persistent AI agents",
  rationale: "The architecture consequences matter to Kairo's technical founder audience.",
  whyNow: "Agent runtimes are becoming persistent rather than request-bound.",
  developmentDirection: "Architecture tradeoffs for multi-tenant SaaS founders",
  brandContextVersion: "brand@1",
  scores: { relevance: 0.9, evidence: 0.8, novelty: 0.8, timeliness: 0.8, brandAuthority: 0.7, audienceFit: 0.9 },
};

describe("VS-03 Opportunity API", () => {
  it("lists ranked Opportunities and applies Save/Develop actions", async () => {
    const context = await setup();
    const created = await context.discovery.recordCandidate(context.accountId, context.brandId, strongCandidate);
    expect(created.opportunity).not.toBeNull();

    const listed = await context.app.inject({
      method: "GET",
      url: `/api/v1/brands/${context.brandId}/opportunities`,
      headers: context.auth,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ title: "Persistent AI agents", status: "new" });

    const id = created.opportunity!.id;
    const saved = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/opportunities/${id}/save`, headers: context.auth });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().status).toBe("saved");

    const developing = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/opportunities/${id}/develop`, headers: context.auth });
    expect(developing.statusCode).toBe(200);
    expect(developing.json().status).toBe("developing");
    await context.app.close();
  });

  it("returns an empty list when Hunter found only weak candidates", async () => {
    const context = await setup();
    await context.discovery.recordCandidate(context.accountId, context.brandId, {
      ...strongCandidate,
      scores: { ...strongCandidate.scores, relevance: 0.2 },
    });

    const listed = await context.app.inject({ method: "GET", url: `/api/v1/brands/${context.brandId}/opportunities`, headers: context.auth });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);
    await context.app.close();
  });

  it("hides a foreign Brand's Opportunities behind safe not-found behavior", async () => {
    const context = await setup();
    await context.discovery.recordCandidate(context.accountId, context.brandId, strongCandidate);
    const response = await context.app.inject({
      method: "GET",
      url: `/api/v1/brands/${context.brandId}/opportunities`,
      headers: { authorization: "Bearer test:bob" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("resource_not_found");
    await context.app.close();
  });
});
