import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { connectChannelAccount } from "@kairo/domain/publishing";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { MemoryKairoRepository } from "./store";
import { MemoryResearchRepository } from "./research-store";
import { MemoryCampaignRepository } from "./campaign-store";
import { MemoryReviewRepository } from "./review-store";
import { MemoryPublishingRepository } from "./publishing-store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null;
  }
}

const futureSchedule = "2099-01-01T11:00:00Z";

describe("VS-30 multi-channel distribution API", () => {
  it("fans one authenticated campaign action into safe idempotent Instagram and LinkedIn schedules", async () => {
    const store = new MemoryKairoRepository();
    const research = new MemoryResearchRepository(store);
    const campaigns = new MemoryCampaignRepository(store);
    const reviews = new MemoryReviewRepository(store);
    const publishing = new MemoryPublishingRepository(store);
    const app = buildApp({
      store,
      researchStore: research,
      campaignStore: campaigns,
      reviewStore: reviews,
      publishingStore: publishing,
      criticEvaluator: { async evaluate() { return { passed: true, score: 94, findings: [] }; } },
      identityVerifier: new Verifier(),
    });

    const identity = { provider: "test", subject: "alice" } as const;
    const user = await store.resolveAccount(identity);
    const headers = { authorization: "Bearer test:alice" };
    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers,
      payload: { workspaceName: "Studio", brandName: "Kairo" },
    });
    expect(setup.statusCode).toBe(201);
    const brand = setup.json().brand;

    const idea = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/ideas`,
      headers,
      payload: { title: "Motorcycle checklist", premise: "Help riders buy carefully" },
    });
    await research.seedReadyBundle(idea.json().id);
    await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/ideas/${idea.json().id}/angles/angle-1/select`,
      headers,
      payload: { expectedVersion: 1 },
    });
    const campaignResponse = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/campaigns`,
      headers,
      payload: { ideaId: idea.json().id, name: "Buying checklist", objective: "Educate" },
    });
    const campaignId = campaignResponse.json().id;

    const instagramAssetResponse = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/campaigns/${campaignId}/assets`,
      headers,
      payload: { channel: "instagram", format: "image", audience: "Riders", topic: "Checklist", hookType: "question", cta: "Save", content: "Instagram version" },
    });
    const instagramAsset = instagramAssetResponse.json().assets.at(-1).asset;
    const linkedinAssetResponse = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/campaigns/${campaignId}/assets`,
      headers,
      payload: { channel: "linkedin", format: "text", audience: "Buyers", topic: "Checklist", hookType: "fact", cta: "Read", content: "LinkedIn version" },
    });
    const linkedinAsset = linkedinAssetResponse.json().assets.at(-1).asset;

    for (const asset of [instagramAsset, linkedinAsset]) {
      const reviewed = await app.inject({
        method: "POST",
        url: `/api/v1/brands/${brand.id}/campaigns/${campaignId}/assets/${asset.id}/review`,
        headers,
        payload: { expectedVersion: 1, brandContextVersion: `${brand.id}@1`, revisionCycle: 0 },
      });
      expect(reviewed.statusCode).toBe(201);
      expect(reviewed.json().status).toBe("passed");
    }

    await publishing.saveChannelAccount(user.id, connectChannelAccount({
      id: "ig-account",
      workspaceId: brand.workspaceId,
      brandId: brand.id,
      channel: "instagram",
      accountRef: "178414000001",
      displayName: "Kairo Instagram",
      credentialRef: "vault://instagram-private",
      capabilities: ["publish-image", "publish-carousel", "publish-reel"],
      connectedAt: "2026-08-17T08:30:00Z",
    }));
    await publishing.saveChannelAccount(user.id, connectChannelAccount({
      id: "li-account",
      workspaceId: brand.workspaceId,
      brandId: brand.id,
      channel: "linkedin",
      accountRef: "urn:li:organization:1",
      displayName: "Kairo LinkedIn",
      credentialRef: "vault://linkedin-private",
      capabilities: ["publish-text"],
      connectedAt: "2026-08-17T08:30:00Z",
    }));

    const payload = {
      scheduledFor: futureSchedule,
      destinations: [
        {
          assetId: instagramAsset.id,
          expectedVersion: 1,
          channelAccountId: "ig-account",
          contentType: "image",
          mediaItems: [{ kind: "image", url: "https://media.example/kairo.png" }],
        },
        {
          assetId: linkedinAsset.id,
          expectedVersion: 1,
          channelAccountId: "li-account",
          contentType: "text",
        },
      ],
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/campaigns/${campaignId}/distributions`,
      headers,
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().destinations).toMatchObject([
      { channelAccountId: "ig-account", channel: "instagram", status: "scheduled" },
      { channelAccountId: "li-account", channel: "linkedin", status: "scheduled" },
    ]);
    expect(first.body).not.toContain("credentialRef");
    expect(first.body).not.toContain("vault://");

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/campaigns/${campaignId}/distributions`,
      headers,
      payload,
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().destinations.map((item: { commandId: string }) => item.commandId)).toEqual(
      first.json().destinations.map((item: { commandId: string }) => item.commandId),
    );

    const malformed = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brand.id}/campaigns/${campaignId}/distributions`,
      headers,
      payload: { scheduledFor: futureSchedule, destinations: [null] },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().detail).toMatch(/destinations\[0\] must be an object/i);

    const calendar = await app.inject({ method: "GET", url: `/api/v1/brands/${brand.id}/calendar`, headers });
    expect(calendar.statusCode).toBe(200);
    expect(calendar.json()).toHaveLength(2);
    await app.close();
  });
});
