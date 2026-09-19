import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { MemoryKairoRepository } from "./store";
import { MemoryResearchRepository } from "./research-store";
import { MemoryCampaignRepository } from "./campaign-store";
import { MemoryReviewRepository } from "./review-store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null;
  }
}

describe("VS-06 Review API", () => {
  it("reviews and binds human approval to the current version", async () => {
    const store = new MemoryKairoRepository();
    const research = new MemoryResearchRepository(store);
    const campaigns = new MemoryCampaignRepository(store);
    const reviews = new MemoryReviewRepository(store);
    const app = buildApp({
      store,
      researchStore: research,
      campaignStore: campaigns,
      reviewStore: reviews,
      criticEvaluator: { async evaluate() { return { passed: true, score: 90, findings: [] }; } },
      identityVerifier: new Verifier(),
    });
    const headers = { authorization: "Bearer test:alice" };
    const setup = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers, payload: { workspaceName: "Studio", brandName: "Kairo" } });
    const brand = setup.json().brand.id;
    const idea = await app.inject({ method: "POST", url: `/api/v1/brands/${brand}/ideas`, headers, payload: { title: "Evidence", premise: "Explain" } });
    await research.seedReadyBundle(idea.json().id);
    await app.inject({ method: "POST", url: `/api/v1/brands/${brand}/ideas/${idea.json().id}/angles/angle-1/select`, headers, payload: { expectedVersion: 1 } });
    const campaign = await app.inject({ method: "POST", url: `/api/v1/brands/${brand}/campaigns`, headers, payload: { ideaId: idea.json().id, name: "Campaign", objective: "Educate" } });
    const made = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand}/campaigns/${campaign.json().id}/assets`,
      headers,
      payload: { channel: "linkedin", format: "text", audience: "Founders", topic: "Evidence", hookType: "data", cta: "Read", content: "Supported" },
    });
    const asset = made.json().assets[0].asset;
    const reviewed = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand}/campaigns/${campaign.json().id}/assets/${asset.id}/review`,
      headers,
      payload: { expectedVersion: 1, brandContextVersion: `${brand}@1`, revisionCycle: 0 },
    });
    expect(reviewed.statusCode).toBe(201);
    expect(reviewed.json().status).toBe("passed");
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand}/campaigns/${campaign.json().id}/assets/${asset.id}/approve`,
      headers,
      payload: { expectedVersion: 1, destination: { channel: "linkedin", accountRef: "company-page" } },
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toMatchObject({ version: 1, destination: { channel: "linkedin" } });
    const approvedStatus = await app.inject({ method: "GET", url: `/api/v1/brands/${brand}/assets/${asset.id}/review-status`, headers });
    expect(approvedStatus.json()).toMatchObject({ approval: { version: 1 }, approvals: [{ version: 1 }] });

    const edited = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand}/campaigns/${campaign.json().id}/assets/${asset.id}/versions`,
      headers,
      payload: { expectedVersion: 1, content: "Supported revision" },
    });
    expect(edited.statusCode).toBe(201);
    const reviewedV2 = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand}/campaigns/${campaign.json().id}/assets/${asset.id}/review`,
      headers,
      payload: { expectedVersion: 2, brandContextVersion: `${brand}@1`, revisionCycle: 0 },
    });
    expect(reviewedV2.statusCode).toBe(201);
    const currentStatus = await app.inject({ method: "GET", url: `/api/v1/brands/${brand}/assets/${asset.id}/review-status`, headers });
    expect(currentStatus.json()).toMatchObject({ review: { version: 2 }, approval: null, approvals: [] });
    await app.close();
  });
});
