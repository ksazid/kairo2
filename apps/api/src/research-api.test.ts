import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryResearchRepository } from "./research-store";
import { MemoryKairoRepository } from "./store";

class TestIdentityVerifier implements IdentityVerifier {
  async verify(header: string | undefined): Promise<ExternalIdentity | null> {
    if (!header?.startsWith("Bearer test:")) return null;
    const subject = header.slice("Bearer test:".length);
    return subject ? { provider: "https://issuer.test", subject } : null;
  }
}

async function setup(options: { developmentEnabled?: boolean } = {}) {
  const store = new MemoryKairoRepository();
  const researchStore = new MemoryResearchRepository(store);
  let developCalls = 0;
  const ideaDeveloper = options.developmentEnabled === false ? undefined : {
    develop: async (input: { idea: { id: string } }) => {
      developCalls += 1;
      await researchStore.seedReadyBundle(input.idea.id);
    },
  };
  const app = buildApp({
    store,
    researchStore,
    ...(ideaDeveloper ? { ideaDeveloper } : {}),
    identityVerifier: new TestIdentityVerifier(),
  });
  const auth = { authorization: "Bearer test:alice" };
  const created = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: auth, payload: { workspaceName: "Studio", brandName: "Kairo" } });
  return { app, auth, brandId: created.json().brand.id as string, researchStore, developCalls: () => developCalls };
}

describe("VS-04/VS-71/VS-73 Research and Angle API", () => {
  it("creates and lists a user-originated Idea with truthful lineage", async () => {
    const context = await setup();
    const created = await context.app.inject({
      method: "POST", url: `/api/v1/brands/${context.brandId}/ideas`, headers: context.auth,
      payload: { title: "A customer question", premise: "Explain why it matters" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ brandId: context.brandId, source: { type: "user" }, status: "new" });

    const listed = await context.app.inject({ method: "GET", url: `/api/v1/brands/${context.brandId}/ideas`, headers: context.auth });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([expect.objectContaining({ id: created.json().id, title: "A customer question" })]);
    await context.app.close();
  });

  it("hides a foreign Brand's Ideas behind safe not-found behavior", async () => {
    const context = await setup();
    const response = await context.app.inject({ method: "GET", url: `/api/v1/brands/${context.brandId}/ideas`, headers: { authorization: "Bearer test:bob" } });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("resource_not_found");

    const created = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas`, headers: context.auth, payload: { title: "Private Idea", premise: "Keep Brand scope" } });
    const develop = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas/${created.json().id}/research`, headers: { authorization: "Bearer test:bob" } });
    expect(develop.statusCode).toBe(404);
    expect(develop.json().code).toBe("resource_not_found");
    await context.app.close();
  });

  it("starts Research and candidate Angles through the authenticated product operation and is repeat-safe", async () => {
    const context = await setup();
    const created = await context.app.inject({
      method: "POST", url: `/api/v1/brands/${context.brandId}/ideas`, headers: context.auth,
      payload: { title: "External mods to improve performance", premise: "Research evidence for motorcycle performance modifications" },
    });
    const ideaId = created.json().id as string;

    const developed = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}/research`, headers: context.auth });
    expect(developed.statusCode).toBe(200);
    expect(developed.json().research.claims[0]).toMatchObject({ verificationState: "supported" });
    expect(developed.json().angles).toHaveLength(2);
    expect(context.developCalls()).toBe(1);

    const repeated = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}/research`, headers: context.auth });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().research.id).toBe(developed.json().research.id);
    expect(repeated.json().angles).toHaveLength(2);
    expect(context.developCalls()).toBe(1);
    await context.app.close();
  });

  it("resumes from persisted Research when Angle generation previously failed", async () => {
    const store = new MemoryKairoRepository();
    const researchStore = new MemoryResearchRepository(store);
    const auth = { authorization: "Bearer test:alice" };
    let developCalls = 0;
    let persistedResearchId: string | undefined;
    const app = buildApp({
      store,
      researchStore,
      identityVerifier: new TestIdentityVerifier(),
      ideaDeveloper: {
        develop: async (input) => {
          developCalls += 1;
          const before = await researchStore.getIdeaBundle(input.accountId, input.brandId, input.idea.id);
          if (developCalls === 1) {
            const dossier = await researchStore.seedResearchOnly(input.idea.id);
            persistedResearchId = dossier.id;
            throw new Error("Strategist transient failure");
          }
          expect(before?.research?.id).toBe(persistedResearchId);
          expect(before?.angles).toHaveLength(0);
          await researchStore.seedAngles(input.idea.id);
        },
      },
    });
    const workspace = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: auth, payload: { workspaceName: "Studio", brandName: "Kairo" } });
    const brandId = workspace.json().brand.id as string;
    const created = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas`, headers: auth, payload: { title: "Recover me", premise: "Research persists before strategy" } });
    const ideaId = created.json().id as string;

    const failed = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas/${ideaId}/research`, headers: auth });
    expect(failed.statusCode).toBe(500);
    const afterFailure = await researchStore.getIdeaBundle(workspace.json().account?.id ?? "", brandId, ideaId).catch(() => null);
    const visibleAfterFailure = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/ideas/${ideaId}`, headers: auth });
    expect(visibleAfterFailure.statusCode).toBe(200);
    expect(visibleAfterFailure.json().research.id).toBe(persistedResearchId);
    expect(visibleAfterFailure.json().angles).toHaveLength(0);
    expect(afterFailure).toBeNull();

    const recovered = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas/${ideaId}/research`, headers: auth });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().research.id).toBe(persistedResearchId);
    expect(recovered.json().angles).toHaveLength(2);
    expect(developCalls).toBe(2);
    await app.close();
  });

  it("fails clearly when Research generation runtime is unavailable", async () => {
    const context = await setup({ developmentEnabled: false });
    const created = await context.app.inject({
      method: "POST", url: `/api/v1/brands/${context.brandId}/ideas`, headers: context.auth,
      payload: { title: "Research me", premise: "Need public evidence" },
    });
    const response = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas/${created.json().id}/research`, headers: context.auth });
    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toBe("Research generation is not configured");
    await context.app.close();
  });

  it("returns a concurrently persisted ready bundle when the competing developer reports an error", async () => {
    const store = new MemoryKairoRepository();
    const researchStore = new MemoryResearchRepository(store);
    const auth = { authorization: "Bearer test:alice" };
    const app = buildApp({
      store,
      researchStore,
      identityVerifier: new TestIdentityVerifier(),
      ideaDeveloper: {
        develop: async (input) => {
          await researchStore.seedReadyBundle(input.idea.id);
          throw new Error("Competing request completed first");
        },
      },
    });
    const workspace = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: auth, payload: { workspaceName: "Studio", brandName: "Kairo" } });
    const brandId = workspace.json().brand.id as string;
    const created = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas`, headers: auth, payload: { title: "Concurrent", premise: "Reuse the winning result" } });
    const response = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas/${created.json().id}/research`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().research).toBeTruthy();
    expect(response.json().angles).toHaveLength(2);
    await app.close();
  });

  it("returns Research/Angles and enforces optimistic Angle selection", async () => {
    const context = await setup();
    const created = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas`, headers: context.auth, payload: { title: "Evidence", premise: "Use supported facts" } });
    const ideaId = created.json().id as string;
    const developed = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}/research`, headers: context.auth });
    expect(developed.statusCode).toBe(200);

    const detail = await context.app.inject({ method: "GET", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}`, headers: context.auth });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().research.claims[0]).toMatchObject({ verificationState: "supported" });
    expect(detail.json().angles).toHaveLength(2);

    const edited = await context.app.inject({ method: "PATCH", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}/angles/angle-1`, headers: context.auth, payload: { framing: "Explain the verified finding first", expectedVersion: 1 } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ id: "angle-1", framing: "Explain the verified finding first", version: 2 });
    const staleEdit = await context.app.inject({ method: "PATCH", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}/angles/angle-1`, headers: context.auth, payload: { framing: "Stale overwrite", expectedVersion: 1 } });
    expect(staleEdit.statusCode).toBe(409);

    const selected = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}/angles/angle-2/select`, headers: context.auth, payload: { expectedVersion: 1 } });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().filter((angle: { status: string }) => angle.status === "selected")).toEqual([expect.objectContaining({ id: "angle-2" })]);
    const stale = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/ideas/${ideaId}/angles/angle-1/select`, headers: context.auth, payload: { expectedVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    await context.app.close();
  });
});
