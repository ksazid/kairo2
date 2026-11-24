import { describe, expect, it } from "vitest";
import type { AgentRuntimePort, DiscoveryEvidence, NormalizedSourceDocument, ToolGatewayPort, ToolRequest } from "@kairo/agent-contracts";
import type { ExternalIdentity } from "@kairo/contracts";
import { DiscoveryService } from "@kairo/domain/discovery-service";
import type { BrandBrainProposalGenerator } from "@kairo/domain/brand-brain-bootstrap";
import { HunterOrchestrator, type HunterRunInput } from "@kairo/worker/hunter";
import { buildApp } from "./app";
import { MemoryKairoRepository } from "./store";
import { MemoryDiscoveryRepository } from "./discovery-store";
import { registerGuidedBrandBrainRoutes } from "./guided-brand-brain-routes";
import { registerBrandDnaReadinessRoutes } from "./brand-dna-readiness-routes";
import { registerHunterRecommendationRoutes } from "./hunter-recommendation-routes";

const auth = { authorization: "Bearer sector-owner" };
const verifier = { async verify(value?: string): Promise<ExternalIdentity | null> { return value?.startsWith("Bearer ") ? { provider: "test", subject: value.slice(7) } : null; } };
const retrievedAt = "2026-11-24T00:00:00.000Z";
const documents = [
  ["https://evidence.example/mtb", "Shimano MTB rotors and Met mountain bike helmets", "Mountain bike components and downhill bicycle helmets."],
  ["https://evidence.example/ebike", "A new e-bike helmet", "An electric bike helmet designed for cycling safety."],
  ["https://evidence.example/motorcycle", "Duke 390 motorcycle maintenance guide", "Duke 390 motorcycle maintenance and responsible riding. Motorcycle riders should follow their service manual and use approved motorcycle equipment."],
] as const;

async function setup() {
  const store = new MemoryKairoRepository();
  const discoveryStore = new MemoryDiscoveryRepository(store);
  const discovery = new DiscoveryService(discoveryStore);
  const searches: ToolRequest[] = [];
  let evidenceIndexes = [0, 1, 2];
  const captured: HunterRunInput[] = [];
  let modelCalls = 0;
  const evidence = (): DiscoveryEvidence[] => evidenceIndexes.map((index) => ({
    sourceUrl: documents[index]![0], title: documents[index]![1], summary: documents[index]![2],
    platform: "rss", publisher: "Deterministic regression evidence", publishedAt: retrievedAt, retrievedAt,
    provider: "rss", providerVersion: "fixture-v1",
  }));
  const tools: ToolGatewayPort = {
    async invoke<TOutput>(request: ToolRequest) {
      if (request.capability === "public-content-search") { searches.push(request); return { output: evidence() as TOutput, provenance: [] }; }
      const item = documents.find(([url]) => url === request.input.url)!;
      const document: NormalizedSourceDocument = {
        canonicalUrl: item[0], platform: "web", sourceType: "article", title: item[1], body: item[2].repeat(4), retrievedAt,
        contentHash: String(documents.indexOf(item) + 1).repeat(64), provider: "website", providerVersion: "fixture-v1", parserVersion: "fixture-v1",
        confidence: 1, extractionWarnings: [], trust: "untrusted-evidence", provenance: [{ provider: "website", sourceUrl: item[0], retrievedAt }],
      };
      return { output: { document } as TOutput, provenance: [] };
    },
  };
  const runtime: AgentRuntimePort = {
    async invoke<TOutput>() {
      modelCalls += 1;
      // Deliberately overconfident model proposes every source as motorcycle advice.
      return { output: { candidates: evidence().map((item, index) => ({
        sourceUrl: item.sourceUrl, title: index === 2 ? "Duke 390 motorcycle maintenance checklist" : `Duke 390 gear upgrade ${index}`,
        rationale: "Practical Duke 390 maintenance guidance for motorcycle riders", whyNow: "Recent evidence supports a responsible riding checklist",
        developmentDirection: "Explain Duke 390 motorcycle maintenance with equipment compatibility checks",
        topic: "Duke 390 motorcycle maintenance", targetAudience: "Duke 390 motorcycle riders", recommendedFormat: "text",
        scores: { relevance: 0.96, evidence: 0.94, novelty: 0.9, timeliness: 0.9, brandAuthority: 0.94, audienceFit: 0.96 },
      })) } as TOutput, metadata: { runtime: "deterministic-regression", latencyMs: 1 } };
    },
  };
  const hunter = new HunterOrchestrator(tools, runtime, discovery);
  const app = buildApp({ store, discoveryStore, identityVerifier: verifier });
  const generator: BrandBrainProposalGenerator = {
    async propose(input) {
      const sourceIds = [input.references[0]!.sourceId];
      return [
        { section: "identity", fieldKey: "identity.category", value: "Business or organization website", sourceIds },
        { section: "identity", fieldKey: "identity.description", value: "Independent Duke 390 motorcycle ownership guidance", sourceIds },
        { section: "identity", fieldKey: "identity.products-services", value: "Bike and bike products", sourceIds },
        { section: "audience", fieldKey: "audience.primary", value: "Duke 390 motorcycle riders", sourceIds },
        { section: "positioning", fieldKey: "positioning.value-proposition", value: "Practical and responsible ownership guidance", sourceIds },
        { section: "content-strategy", fieldKey: "content.pillars", value: "Duke 390 motorcycle maintenance and responsible riding", sourceIds },
        { section: "boundaries", fieldKey: "boundaries.excluded-topics", value: "Dangerous riding, unsupported performance claims", sourceIds },
      ];
    },
  };
  registerGuidedBrandBrainRoutes(app, { store, identityVerifier: verifier, generator, referenceReader: { async read(url) { return { url, title: "TheDukeMan", excerpt: "Duke 390 motorcycle maintenance and responsible riding.", retrievedAt }; } } });
  registerBrandDnaReadinessRoutes(app, { store, identityVerifier: verifier });
  registerHunterRecommendationRoutes(app, { store, identityVerifier: verifier, discovery, runner: { async runForAuthorizedBrand(input) { captured.push(input); return hunter.runForAuthorizedBrand(input); } } });
  const created = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: auth, payload: { workspaceName: "Sector regression", brandName: "TheDukeMan", publicSourceUrl: "https://brand.example/dukeman" } });
  expect(created.statusCode).toBe(201);
  const brandId = created.json().brand.id as string;
  const bootstrap = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/brain/bootstrap`, headers: auth, payload: {} });
  expect(bootstrap.statusCode).toBe(200);
  return { app, store, brandId, searches, captured, bootstrap, get modelCalls() { return modelCalls; }, onlyCycling() { evidenceIndexes = [0, 1]; } };
}

describe("onboarding → canonical sector → Hunter → preview regression", () => {
  it("persists the sourced motorcycle sector and keeps cycling-only evidence out of the persisted preview", async () => {
    const context = await setup();
    const { app, brandId, bootstrap } = context;
    try {
      expect(bootstrap.json().brain).toEqual(expect.arrayContaining([expect.objectContaining({ fieldKey: "identity.sector-pack-id", value: "motorcycles", state: "inferred", sourceIds: [expect.any(String)] })]));
      const activation = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/brain/activation`, headers: auth });
      expect(activation.json()).toMatchObject({ hunterReady: true, sectorClassification: { status: "ready", sectorPackId: "motorcycles" } });
      const run = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/recommendations`, headers: auth });
      expect(run.statusCode).toBe(200);
      expect(run.json()).toMatchObject({ evidenceCount: 3, candidateCount: 3, opportunityCount: 1 });
      expect(context.captured[0]?.intelligenceProfile).toMatchObject({ sector: "Business or organization website", sectorPackId: "motorcycles" });
      expect(context.searches.some((request) => request.input.source === "hacker-news" || request.input.source === "github")).toBe(false);
      const result = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/opportunities`, headers: auth });
      expect(result.json()).toHaveLength(1);
      const [preview] = result.json();
      expect(preview.title).toBe("Duke 390 motorcycle maintenance checklist");
      expect(preview.details.supportingSourceIds).toEqual(preview.signalIds);
      expect(preview.conceptMockup).toMatchObject({ format: "text", hook: "Duke 390 motorcycle maintenance checklist" });
      expect(JSON.stringify(preview)).not.toMatch(/Shimano|Met mountain|e-bike/);
    } finally { await app.close(); }
  });

  it("returns a truthful empty result when every supplied source is cycling-only", async () => {
    const context = await setup();
    try {
      context.onlyCycling();
      const run = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/recommendations`, headers: auth });
      expect(run.statusCode).toBe(200);
      expect(run.json()).toMatchObject({ evidenceCount: 2, opportunityCount: 0 });
      const result = await context.app.inject({ method: "GET", url: `/api/v1/brands/${context.brandId}/opportunities`, headers: auth });
      expect(result.json()).toEqual([]);
    } finally { await context.app.close(); }
  });

  it("blocks conflicting sectors before any model call and preserves tenant/version checks", async () => {
    const context = await setup();
    const { app, brandId } = context;
    try {
      const sector = context.bootstrap.json().brain.find((field: { fieldKey: string }) => field.fieldKey === "identity.sector-pack-id");
      const put = (value: string, section = "identity", authorization = auth.authorization, expectedVersion = sector.version) => app.inject({ method: "PUT", url: `/api/v1/brands/${brandId}/brain/identity.sector-pack-id`, headers: { authorization }, payload: { section, value, expectedVersion } });
      expect((await put("unsupported")).statusCode).toBe(400);
      expect((await put("motorcycles", "audience")).statusCode).toBe(400);
      expect((await put("motorcycles", "identity", "Bearer other-owner")).statusCode).toBe(404);
      expect((await put("motorcycles")).statusCode).toBe(200);
      expect((await put("hospitality")).statusCode).toBe(409);
      const conflict = await put("generic", "identity", auth.authorization, sector.version + 1);
      expect(conflict.statusCode).toBe(200);
      const blocked = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/recommendations`, headers: auth });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({ code: "hunter_not_ready", gaps: expect.arrayContaining(["sector"]), sectorClassification: { status: "conflicting" } });
      expect(context.modelCalls).toBe(0);
    } finally { await app.close(); }
  });

  it("requires confirmation after the source backing an inferred sector is paused", async () => {
    const context = await setup();
    try {
      const sourceId = context.bootstrap.json().sourceIds[0];
      const paused = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/sources/${sourceId}/disable`, headers: auth });
      expect(paused.statusCode).toBe(200);
      const blocked = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brandId}/recommendations`, headers: auth });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().gaps).toContain("sector");
      expect(context.modelCalls).toBe(0);
    } finally { await context.app.close(); }
  });
});
