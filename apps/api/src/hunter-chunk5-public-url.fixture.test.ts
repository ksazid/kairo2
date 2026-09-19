import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  DiscoveryEvidence,
  NormalizedSourceDocument,
  ToolGatewayPort,
  ToolRequest,
} from "@kairo/agent-contracts";
import type { ExternalIdentity } from "@kairo/contracts";
import { DiscoveryService } from "@kairo/domain/discovery-service";
import { SanitizingPublicBrandReferenceReader } from "@kairo/domain/brand-brain-sanitizing-reader";
import type { PublicBrandReference } from "@kairo/domain/brand-brain-bootstrap";
import type {
  CompleteHunterRunInput,
  FailHunterRunInput,
  HunterRunRecord,
  HunterRunRepository,
  StartHunterRunInput,
} from "@kairo/domain/hunter-run-record";
import { HunterOrchestrator, type HunterRunInput } from "@kairo/worker/hunter";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { registerBrandDnaReadinessRoutes } from "./brand-dna-readiness-routes";
import { registerGuidedBrandBrainRoutes } from "./guided-brand-brain-routes";
import { registerHunterRecommendationRoutes } from "./hunter-recommendation-routes";
import { PublicBrandReferenceHttpReader } from "./public-brand-reference";
import { createSourceIntelligenceRouter, SourceIntelligenceBrandReferenceReader } from "./source-intelligence";
import { MemoryDiscoveryRepository } from "./discovery-store";
import { MemoryKairoRepository } from "./store";

const FIXTURE_CERTIFICATION = process.env.KAIRO_CHUNK5_FIXTURE_CERTIFICATION === "1";
const PUBLIC_URL = process.env.KAIRO_CHUNK5_PUBLIC_URL?.trim() || "https://smartmobilitymalta.com/";
const AUTH = { authorization: "Bearer test:chunk5-certification" };

const CAPTURED_SMART_MOBILITY_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Smart Mobility Malta</title>
    <meta name="description" content="Reliable car and motor rental from Malta International Airport in Gudja, with online reservations and competitive pricing.">
    <script>window.tracking = { noisy: true };</script>
    <style>.hidden { display: none }</style>
  </head>
  <body>
    <nav>Home About Contact Privacy Terms</nav>
    <main>
      <h1>Search for your Rental</h1>
      <p>Choose pickup date, dropoff date, time and driver age, then search for an available rental.</p>
      <h2>Vehicles</h2>
      <p>Small Cars from €9.44. Medium Cars from €11.21. Large Cars from €12.98. SUV from €21.24. People Carriers from €55.00. Bikes from €12.51. Estate Cars, Premium, Convertable and Automatic vehicles are also available.</p>
      <h2>Why Choose Us?</h2>
      <h3>Premium Service</h3>
      <p>Smart Car Rentals Malta provides high-quality service to everyone looking for reliable car and motor rental.</p>
      <h3>Easy Access</h3>
      <p>Our office is situated at Malta International Airport so customers can collect their car with ease.</p>
      <h3>Qualified Team</h3>
      <p>Customers can rely on a professional team that is ready to help. We can better competitor pricing, guaranteed.</p>
      <h2>How We Work</h2>
      <p>Enter reservation criteria, choose a preference from the search results, select a suitable package and collect the chosen car or motorbike from the Gudja office. Return the rental to the same office when the rental ends.</p>
      <h2>Frequently Asked Questions</h2>
      <p>Drivers need a valid driving licence, a credit card, passport or EU identity card and the booking confirmation. A car or motorbike renter must be at least 21 years old. Malta drives on the left side of the road. Fuel stations, speed limits and parking availability are explained for visitors.</p>
      <h2>About Us</h2>
      <p>Smart Mobility Malta is located at Maple, Triq Resqun, Gudja, GDJ 1443. Customer care: customercare@smartmobilitymalta.com.</p>
    </main>
    <footer>Quick links Privacy Policy Terms © Smart Mobility</footer>
  </body>
</html>`;

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:")
      ? { provider: "test", subject: value.slice("Bearer test:".length) }
      : null;
  }
}

class MemoryHunterRunStore implements HunterRunRepository {
  readonly records: HunterRunRecord[] = [];

  async start(_accountId: string, input: StartHunterRunInput): Promise<HunterRunRecord> {
    const record: HunterRunRecord = {
      schemaVersion: "1",
      runId: `chunk5-run-${this.records.length + 1}`,
      ...input,
      status: "running",
      evidenceCount: 0,
      candidateCount: 0,
      opportunityCount: 0,
      sourcesScanned: [],
      degradedSources: [],
    };
    this.records.push(record);
    return structuredClone(record);
  }

  async complete(_accountId: string, runId: string, input: CompleteHunterRunInput): Promise<HunterRunRecord> {
    const index = this.records.findIndex((record) => record.runId === runId);
    const current = this.records[index];
    if (!current) throw new Error("Hunter run not found");
    const completed: HunterRunRecord = { ...current, ...input, status: "succeeded" };
    this.records[index] = completed;
    return structuredClone(completed);
  }

  async fail(_accountId: string, runId: string, input: FailHunterRunInput): Promise<HunterRunRecord> {
    const index = this.records.findIndex((record) => record.runId === runId);
    const current = this.records[index];
    if (!current) throw new Error("Hunter run not found");
    const failed: HunterRunRecord = { ...current, ...input, status: "failed" };
    this.records[index] = failed;
    return structuredClone(failed);
  }

  async listRecent(_accountId: string, brandId: string, limit = 20): Promise<HunterRunRecord[]> {
    return this.records.filter((record) => record.brandId === brandId).slice(-limit).reverse().map((record) => structuredClone(record));
  }

  async getLatest(accountId: string, brandId: string): Promise<HunterRunRecord | undefined> {
    return (await this.listRecent(accountId, brandId, 1))[0];
  }
}

function toolsFor(reference: PublicBrandReference): ToolGatewayPort {
  const hash = createHash("sha256").update(reference.excerpt).digest("hex");
  const evidence: DiscoveryEvidence = {
    title: reference.title || new URL(reference.url).hostname,
    ...(reference.summary ? { summary: reference.summary } : { summary: reference.excerpt.slice(0, 1_000) }),
    sourceUrl: reference.url,
    platform: "web",
    publisher: reference.title || new URL(reference.url).hostname,
    retrievedAt: reference.retrievedAt,
    provider: "chunk5-live-public-url",
    providerVersion: "1",
    contentHash: `sha256:${hash}`,
  };
  const document: NormalizedSourceDocument = {
    canonicalUrl: reference.url,
    platform: "web",
    sourceType: "website",
    ...(reference.title ? { title: reference.title } : {}),
    ...(reference.summary ? { description: reference.summary } : {}),
    body: reference.excerpt,
    retrievedAt: reference.retrievedAt,
    contentHash: hash,
    provider: "chunk5-live-public-url",
    providerVersion: "1",
    parserVersion: "flow-1a",
    provenance: [{ provider: "chunk5-live-public-url", providerVersion: "1", sourceUrl: reference.url, retrievedAt: reference.retrievedAt }],
    confidence: 1,
    extractionWarnings: [],
    trust: "untrusted-evidence",
  };
  return {
    async invoke<TOutput>(request: ToolRequest) {
      if (request.capability === "public-content-search") return { output: [evidence] as TOutput, provenance: [] };
      if (request.capability === "public-content-fetch") return { output: { document } as TOutput, provenance: [] };
      throw new Error(`Unexpected capability ${request.capability}`);
    },
  };
}

function deterministicRuntime(): AgentRuntimePort {
  return {
    async invoke<TOutput>(request: AgentInvocationRequest) {
      const context = request.task.context;
      const evidence = (context.evidence as Array<Record<string, unknown>>)[0] ?? {};
      const profile = context.intelligenceProfile as { topics?: string[]; audiences?: string[] } | undefined;
      const topic = profile?.topics?.[0] || "Brand customer value";
      const audience = profile?.audiences?.[0] || "Brand audience";
      const sourceTitle = String(evidence.title || "Public Brand evidence");
      return {
        output: {
          candidates: [{
            sourceUrl: String(evidence.sourceUrl),
            title: `${topic}: a useful angle from ${sourceTitle}`,
            rationale: `The public evidence directly supports ${topic} for ${audience}.`,
            whyNow: "The Brand has just completed onboarding and this source-backed angle can seed its first manual discovery run.",
            developmentDirection: `Turn the extracted evidence into a practical explanation of ${topic} for ${audience}.`,
            topic,
            proposedAngle: `What ${audience} should understand about ${topic}`,
            targetAudience: audience,
            recommendedFormat: "carousel",
            recommendedChannel: "instagram",
            confidence: 0.92,
            scores: { relevance: 0.96, evidence: 0.94, novelty: 0.82, timeliness: 0.78, brandAuthority: 0.88, audienceFit: 0.94 },
          }],
        } as TOutput,
        metadata: { runtime: "chunk5-deterministic-fixture", runtimeVersion: "1", latencyMs: 1 },
      };
    },
  };
}

describe.skipIf(!FIXTURE_CERTIFICATION)("Hunter Chunk 5 captured-page fixture coverage", () => {
  it("runs onboarding through a manual Hunter execution while production cron remains frozen", async () => {
    const capturedReader = new PublicBrandReferenceHttpReader({
      resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
      transport: async () => ({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: CAPTURED_SMART_MOBILITY_HTML,
      }),
    });
    const referenceReader = new SanitizingPublicBrandReferenceReader(
      new SourceIntelligenceBrandReferenceReader(createSourceIntelligenceRouter({ reader: capturedReader })),
    );
    const reference = await referenceReader.read(PUBLIC_URL);
    expect(reference.excerpt).not.toMatch(/Home About Contact Privacy Terms/i);
    expect(reference.excerpt).not.toMatch(/Quick links Privacy Policy Terms/i);
    expect(reference.excerpt).not.toMatch(/window\.tracking|display:\s*none/i);
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const account = await store.resolveAccount({ provider: "test", subject: "chunk5-certification" });
    const created = await store.createWorkspaceWithBrand(account.id, {
      workspaceName: "Chunk 5 Certification",
      brandName: reference.title || new URL(reference.url).hostname,
      publicSourceUrl: PUBLIC_URL,
    });

    const discoveryStore = new MemoryDiscoveryRepository(store);
    const discovery = new DiscoveryService(discoveryStore);
    const orchestrator = new HunterOrchestrator(toolsFor(reference), deterministicRuntime(), discovery);
    const capturedInputs: HunterRunInput[] = [];
    const runs = new MemoryHunterRunStore();
    const app = buildApp({ store, identityVerifier: verifier, discoveryStore });
    registerGuidedBrandBrainRoutes(app, { store, identityVerifier: verifier, referenceReader });
    registerHunterRecommendationRoutes(app, {
      store,
      identityVerifier: verifier,
      discovery,
      hunterRunStore: runs,
      runner: { async runForAuthorizedBrand(input) { capturedInputs.push(input); return orchestrator.runForAuthorizedBrand(input); } },
    });
    registerBrandDnaReadinessRoutes(app, { store, identityVerifier: verifier, hunterRunStore: runs });

    const bootstrap = await app.inject({ method: "POST", url: `/api/v1/brands/${created.brand.id}/brain/bootstrap`, headers: AUTH, payload: {} });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ generatorStatus: "generated", proposedCount: expect.any(Number) });

    const beforeRun = await app.inject({ method: "GET", url: `/api/v1/brands/${created.brand.id}/brain/activation`, headers: AUTH });
    expect(beforeRun.statusCode).toBe(200);
    expect(beforeRun.json()).toMatchObject({ hunterReady: true, schedule: null, discoveryRun: null });

    const manualRun = await app.inject({ method: "POST", url: `/api/v1/brands/${created.brand.id}/recommendations`, headers: AUTH });
    expect(manualRun.statusCode, manualRun.body).toBe(200);
    expect(manualRun.json()).toMatchObject({ evidenceCount: 1, candidateCount: 1, opportunityCount: 1 });
    expect(runs.records).toHaveLength(1);
    expect(runs.records[0]).toMatchObject({ trigger: "manual", status: "succeeded", opportunityCount: 1 });
    expect(runs.records.some((run) => run.trigger === "scheduled")).toBe(false);
    expect(capturedInputs[0]?.brand.contextVersion).toBe(`${runs.records[0]?.snapshotVersion}|${runs.records[0]?.planVersion}`);

    const listedOpportunities = await app.inject({ method: "GET", url: `/api/v1/brands/${created.brand.id}/opportunities`, headers: AUTH });
    expect(listedOpportunities.statusCode).toBe(200);
    expect(listedOpportunities.json()).toEqual([
      expect.objectContaining({
        brandId: created.brand.id,
        status: "new",
        title: "What the Brand offers: a useful angle from Smart Mobility Malta",
        details: expect.objectContaining({ recommendedFormat: "carousel", recommendedChannel: "instagram", confidence: 0.92 }),
      }),
    ]);

    const afterRun = await app.inject({ method: "GET", url: `/api/v1/brands/${created.brand.id}/brain/activation`, headers: AUTH });
    expect(afterRun.statusCode).toBe(200);
    expect(afterRun.json()).toMatchObject({ schedule: null, discoveryRun: { trigger: "manual", status: "succeeded" } });

    const activation = afterRun.json();
    const fields = new Map(bootstrap.json().brain.map((field: { fieldKey: string; value: string }) => [field.fieldKey, field.value]));
    const result = {
      publicUrl: PUBLIC_URL,
      canonicalUrl: reference.url,
      retrievedAt: reference.retrievedAt,
      extractedReference: {
        title: reference.title ?? null,
        summary: reference.summary ?? null,
        excerpt: reference.excerpt.slice(0, 1_500),
      },
      brandDna: Object.fromEntries(fields),
      brandIntelligence: {
        score: activation.readiness.brandIntelligenceScore,
        readinessScore: activation.readiness.score,
        evidenceCoverage: activation.readiness.evidenceCoverage,
        confidence: activation.readiness.confidence,
        hunterReady: activation.hunterReady,
        snapshotVersion: activation.intelligenceSnapshot.snapshotVersion,
        planVersion: activation.discoveryPlan.planVersion,
        discoveryTopics: activation.discoveryPlan.topics.map((topic: { name: string }) => topic.name),
      },
      chunk5: {
        executionMode: "manual",
        schedule: activation.schedule,
        cronActivated: false,
        run: activation.discoveryRun,
        extraction: manualRun.json(),
        opportunities: listedOpportunities.json(),
      },
    };
    console.log(`KAIRO_CHUNK5_PUBLIC_URL_RESULT=${JSON.stringify(result)}`);
    await app.close();
  }, 600_000);
});
