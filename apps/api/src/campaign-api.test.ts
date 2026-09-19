import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryKairoRepository } from "./store";
import { MemoryResearchRepository } from "./research-store";
import { MemoryCampaignRepository } from "./campaign-store";
import { appendContentVersion } from "@kairo/domain/campaign";
import type { ContentGenerationPort } from "@kairo/domain/campaign-service";

class Verifier implements IdentityVerifier { async verify(value: string | undefined): Promise<ExternalIdentity | null> { return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null; } }

describe("VS-05 Campaign API", () => {
  it("creates a Campaign from a selected Angle and appends immutable manual versions", async () => {
    const store = new MemoryKairoRepository(); const research = new MemoryResearchRepository(store); const campaigns = new MemoryCampaignRepository(store);
    const generator:ContentGenerationPort={async generate(input){return appendContentVersion({id:"generated-1",asset:input.asset,parent:input.parent,expectedVersion:input.asset.currentVersion,content:"Simpler generated version",supportingClaimIds:["claim-1"],actor:"ai",action:input.action,createdAt:"2026-08-13T10:10:00Z",provenance:{runtime:"fixture",model:"draft-1",latencyMs:1}})}};
    const app = buildApp({ store, researchStore: research, campaignStore: campaigns, contentGenerator:generator, identityVerifier: new Verifier() }); const headers = { authorization: "Bearer test:alice" };
    const setup = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers, payload: { workspaceName: "Studio", brandName: "Kairo" } }); const brandId = setup.json().brand.id as string;
    const idea = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas`, headers, payload: { title: "Evidence", premise: "Explain it" } }); await research.seedReadyBundle(idea.json().id);
    await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/ideas/${idea.json().id}/angles/angle-1/select`, headers, payload: { expectedVersion: 1 } });
    const campaign = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/campaigns`, headers, payload: { ideaId: idea.json().id, name: "Evidence campaign", objective: "Educate" } }); expect(campaign.statusCode).toBe(201);
    const created = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets`, headers, payload: { channel: "linkedin", format: "text", audience: "Founders", topic: "Evidence", hookType: "data-led", cta: "Read more", content: "First version" } }); expect(created.statusCode).toBe(201); const asset = created.json().assets[0].asset;
    const edited = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/versions`, headers, payload: { expectedVersion: 1, content: "Second version" } }); expect(edited.statusCode).toBe(201); expect(edited.json().assets[0].versions).toHaveLength(2);
    const generated=await app.inject({method:"POST",url:`/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/generate`,headers,payload:{expectedVersion:2,action:"simplify",brandContextVersion:`${brandId}@1`}});expect(generated.statusCode).toBe(201);expect(generated.json().assets[0].versions[2]).toMatchObject({content:"Simpler generated version",actor:"ai",action:"simplify",provenance:{model:"draft-1"}});
    const stale = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/campaigns/${campaign.json().id}/assets/${asset.id}/versions`, headers, payload: { expectedVersion: 1, content: "Stale" } }); expect(stale.statusCode).toBe(409);
    await app.close();
  });
});
