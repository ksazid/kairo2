import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { KairoService } from "@kairo/domain";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryKairoRepository } from "./store";

class TestIdentityVerifier implements IdentityVerifier {
  async verify(header: string | undefined): Promise<ExternalIdentity | null> {
    if (!header?.startsWith("Bearer test:")) return null;
    const subject = header.slice("Bearer test:".length);
    return subject ? { provider: "https://issuer.test", subject, email: `${subject}@example.com` } : null;
  }
}

function setup() {
  const store = new MemoryKairoRepository();
  return { store, app: buildApp({ store, identityVerifier: new TestIdentityVerifier() }) };
}

async function createBrand(app: ReturnType<typeof buildApp>, subject = "alice") {
  const response = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: { authorization: `Bearer test:${subject}` }, payload: { workspaceName: `${subject} studio`, brandName: `${subject} brand` } });
  expect(response.statusCode).toBe(201);
  return response.json() as { workspace: { id: string }; brand: { id: string } };
}

describe("VS-02 Brand Brain and Knowledge API", () => {
  it("lets an owner confirm and correct Brand Brain fields with optimistic concurrency", async () => {
    const { app } = setup();
    const { brand } = await createBrand(app);
    const created = await app.inject({ method: "PUT", url: `/api/v1/brands/${brand.id}/brain/voice.tone`, headers: { authorization: "Bearer test:alice" }, payload: { section: "voice", value: "Clear and technical" } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ fieldKey: "voice.tone", state: "confirmed", version: 1, sourceIds: [] });

    const staleWrite = await app.inject({ method: "PUT", url: `/api/v1/brands/${brand.id}/brain/voice.tone`, headers: { authorization: "Bearer test:alice" }, payload: { section: "voice", value: "Different", expectedVersion: 2 } });
    expect(staleWrite.statusCode).toBe(409);
    expect(staleWrite.json().code).toBe("concurrency_conflict");
    await app.close();
  });

  it("keeps private sources inside their Brand boundary and does not disclose guessed source ids", async () => {
    const { app } = setup();
    const alice = await createBrand(app, "alice");
    await createBrand(app, "bob");
    const created = await app.inject({ method: "POST", url: `/api/v1/brands/${alice.brand.id}/sources`, headers: { authorization: "Bearer test:alice" }, payload: { type: "note", title: "Private note", content: "Never discuss unreleased pricing." } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "active", hasPrivateContent: true });
    expect(created.json()).not.toHaveProperty("rawContent");

    const guessed = await app.inject({ method: "DELETE", url: `/api/v1/brands/${alice.brand.id}/sources/${created.json().id}`, headers: { authorization: "Bearer test:bob" } });
    expect(guessed.statusCode).toBe(404);
    await app.close();
  });

  it("applies DEC-006 by staling unsupported inference while preserving confirmed facts", async () => {
    const { app, store } = setup();
    const { brand } = await createBrand(app);
    const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: { authorization: "Bearer test:alice" } });
    const accountId = session.json().account.id as string;
    const sourceResponse = await app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/sources`, headers: { authorization: "Bearer test:alice" }, payload: { type: "note", title: "Audience research", content: "Our primary readers are SaaS founders." } });
    const sourceId = sourceResponse.json().id as string;
    const service = new KairoService(store);
    await service.recordInferredBrandBrainField(accountId, brand.id, { section: "audience", fieldKey: "audience.primary", value: "SaaS founders", sourceIds: [sourceId] });
    await service.putBrandBrainField(accountId, brand.id, "voice.tone", { section: "voice", value: "Clear and technical" });

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/brands/${brand.id}/sources/${sourceId}`, headers: { authorization: "Bearer test:alice" } });
    expect(removed.json()).toMatchObject({ status: "removed", hasPrivateContent: false });
    expect(removed.json()).not.toHaveProperty("title");

    const brain = await app.inject({ method: "GET", url: `/api/v1/brands/${brand.id}/brain`, headers: { authorization: "Bearer test:alice" } });
    expect(brain.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "audience.primary", state: "stale", sourceIds: [] }),
      expect.objectContaining({ fieldKey: "voice.tone", state: "confirmed", value: "Clear and technical" }),
    ]));
    await app.close();
  });

  it("rejects unsafe URL literals and keeps document records quarantined", async () => {
    const { app } = setup();
    const { brand } = await createBrand(app);
    const unsafe = await app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/sources`, headers: { authorization: "Bearer test:alice" }, payload: { type: "url", url: "http://169.254.169.254/latest/meta-data" } });
    expect(unsafe.statusCode).toBe(400);

    const document = await app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/sources`, headers: { authorization: "Bearer test:alice" }, payload: { type: "document", title: "Positioning", contentType: "application/pdf", sizeBytes: 5000, contentHash: "c".repeat(64) } });
    expect(document.statusCode).toBe(201);
    expect(document.json().status).toBe("quarantined");
    const enable = await app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/sources/${document.json().id}/enable`, headers: { authorization: "Bearer test:alice" } });
    expect(enable.statusCode).toBe(400);
    await app.close();
  });
});
