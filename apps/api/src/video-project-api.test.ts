import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { createVideoProject, serializeVideoProject } from "@kairo/domain/video-project";
import type { ContentGenerationPort } from "@kairo/domain/campaign-service";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryKairoRepository } from "./store";
import { MemoryResearchRepository } from "./research-store";
import { MemoryCampaignRepository } from "./campaign-store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null;
  }
}

describe("VS-54 Video Project API integrity", () => {
  it("keeps structured Reel projects scoped and blocks generic downgrade or AI transformation", async () => {
    let generatorCalls = 0;
    const generator: ContentGenerationPort = {
      async generate() {
        generatorCalls += 1;
        throw new Error("Structured Video Project should have been blocked before generation");
      },
    };
    const store = new MemoryKairoRepository();
    const research = new MemoryResearchRepository(store);
    const campaigns = new MemoryCampaignRepository(store);
    const app = buildApp({ store, researchStore: research, campaignStore: campaigns, contentGenerator: generator, identityVerifier: new Verifier() });
    const headers = { authorization: "Bearer test:alice" };

    const setup = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers, payload: { workspaceName: "Studio", brandName: "Kairo" } });
    const brandId = setup.json().brand.id as string;
    const idea = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas`, headers, payload: { title: "Evidence", premise: "Explain it" } });
    await research.seedReadyBundle(idea.json().id);
    await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas/${idea.json().id}/angles/angle-1/select`, headers, payload: { expectedVersion: 1 } });
    const campaign = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/campaigns`, headers, payload: { ideaId: idea.json().id, name: "Video campaign", objective: "Explain" } });
    expect(campaign.statusCode).toBe(201);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets`,
      headers,
      payload: { channel: "instagram", format: "reel", audience: "Founders", topic: "Evidence", hookType: "evidence-led", cta: "Save this", content: "Legacy Reel direction" },
    });
    expect(created.statusCode).toBe(201);
    const entry = created.json().assets[0];
    const asset = entry.asset;
    const version1 = entry.versions[0];

    const project = createVideoProject({
      id: `video-project-${asset.id}-${version1.id}`,
      workspaceId: campaign.json().workspaceId,
      brandId,
      campaignId: campaign.json().id,
      assetId: asset.id,
      sourceVersionId: version1.id,
      sourceVersion: 1,
      plan: {
        format: "reel",
        hook: "The evidence changes the workflow.",
        targetDurationSeconds: 10,
        scenes: [
          { startSecond: 0, endSecond: 4, visual: "Evidence card", onScreenText: "Start with evidence", voiceover: "Start with what the evidence supports.", supportingClaimIds: ["claim-1"] },
          { startSecond: 4, endSecond: 10, visual: "Workflow close", onScreenText: "Keep the lineage", voiceover: "Keep the supporting claim attached through production.", supportingClaimIds: ["claim-1"] },
        ],
        caption: "A short evidence-led workflow.",
        cta: "Save this for your next review.",
        supportingClaimIds: ["claim-1"],
      },
    });

    const initialized = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/versions`,
      headers,
      payload: { expectedVersion: 1, content: serializeVideoProject(project) },
    });
    expect(initialized.statusCode).toBe(201);
    expect(initialized.json().assets[0].versions).toHaveLength(2);

    const downgraded = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/versions`,
      headers,
      payload: { expectedVersion: 2, content: "Replace the structured project with plain text" },
    });
    expect(downgraded.statusCode).toBe(400);

    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/generate`,
      headers,
      payload: { expectedVersion: 2, action: "simplify", brandContextVersion: `${brandId}@1` },
    });
    expect(generated.statusCode).toBe(400);
    expect(generatorCalls).toBe(0);

    const editedProject = { ...project, hook: "The evidence keeps the workflow grounded." };
    const edited = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/versions`,
      headers,
      payload: { expectedVersion: 2, content: serializeVideoProject(editedProject) },
    });
    expect(edited.statusCode).toBe(201);
    expect(edited.json().assets[0].versions).toHaveLength(3);

    const wrongScopeProject = { ...editedProject, brandId: "brand-outside-scope" };
    const wrongScope = await app.inject({
      method: "POST",
      url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/versions`,
      headers,
      payload: { expectedVersion: 3, content: JSON.stringify(wrongScopeProject) },
    });
    expect(wrongScope.statusCode).toBe(400);

    await app.close();
  });
});
