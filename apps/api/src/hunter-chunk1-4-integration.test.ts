import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  DiscoveryEvidence,
  NormalizedSourceDocument,
  ToolGatewayPort,
  ToolRequest,
} from "@kairo/agent-contracts";
import type { OpportunityCandidateInput } from "@kairo/domain/discovery-service";
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
import { registerHunterRecommendationRoutes } from "./hunter-recommendation-routes";
import { MemoryKairoRepository } from "./store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:")
      ? { provider: "test", subject: value.slice("Bearer test:".length) }
      : null;
  }
}

class MemoryHunterRunStore implements HunterRunRepository {
  private readonly rows: Array<{ accountId: string; record: HunterRunRecord }> = [];

  async start(accountId: string, input: StartHunterRunInput): Promise<HunterRunRecord> {
    const record: HunterRunRecord = {
      schemaVersion: "1",
      runId: `run-${this.rows.length + 1}`,
      workspaceId: input.workspaceId,
      brandId: input.brandId,
      snapshotVersion: input.snapshotVersion,
      planVersion: input.planVersion,
      trigger: input.trigger,
      status: "running",
      startedAt: input.startedAt,
      evidenceCount: 0,
      candidateCount: 0,
      opportunityCount: 0,
      sourcesScanned: [],
      degradedSources: [],
    };
    this.rows.push({ accountId, record });
    return structuredClone(record);
  }

  async complete(accountId: string, runId: string, input: CompleteHunterRunInput): Promise<HunterRunRecord> {
    const row = this.required(accountId, runId);
    row.record = {
      ...row.record,
      status: "succeeded",
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      evidenceCount: input.evidenceCount,
      candidateCount: input.candidateCount,
      opportunityCount: input.opportunityCount,
      sourcesScanned: [...input.sourcesScanned],
      degradedSources: [...input.degradedSources],
    };
    return structuredClone(row.record);
  }

  async fail(accountId: string, runId: string, input: FailHunterRunInput): Promise<HunterRunRecord> {
    const row = this.required(accountId, runId);
    row.record = {
      ...row.record,
      status: "failed",
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      sourcesScanned: [...input.sourcesScanned],
      degradedSources: [...input.degradedSources],
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
    };
    return structuredClone(row.record);
  }

  async listRecent(accountId: string, brandId: string, limit = 20): Promise<HunterRunRecord[]> {
    return this.rows
      .filter((row) => row.accountId === accountId && row.record.brandId === brandId)
      .slice(-limit)
      .reverse()
      .map((row) => structuredClone(row.record));
  }

  async getLatest(accountId: string, brandId: string): Promise<HunterRunRecord | undefined> {
    return (await this.listRecent(accountId, brandId, 1))[0];
  }

  all(): HunterRunRecord[] {
    return this.rows.map((row) => structuredClone(row.record));
  }

  private required(accountId: string, runId: string) {
    const row = this.rows.find((item) => item.accountId === accountId && item.record.runId === runId);
    if (!row) throw new Error("Hunter run not found");
    return row;
  }
}

function discoveryEvidence(title: string, sourceUrl: string): DiscoveryEvidence {
  return {
    title,
    summary: `${title} with enough public context to evaluate the opportunity against Brand relevance and evidence quality.`,
    sourceUrl,
    platform: "web",
    publisher: "POC Publisher",
    publishedAt: "2026-09-01T08:00:00.000Z",
    retrievedAt: "2026-09-01T10:00:00.000Z",
    provider: "poc-search",
    providerVersion: "1",
    contentHash: `sha256:${"a".repeat(64)}`,
  };
}

function normalizedDocument(sourceUrl: string, title: string): NormalizedSourceDocument {
  return {
    canonicalUrl: sourceUrl,
    platform: "web",
    sourceType: "article",
    title,
    description: `${title} evidence summary`,
    body: `${title}. This deterministic integration fixture contains substantial sanitized public evidence for the Hunter quality boundary and does not contain navigation or script content.`,
    publishedAt: "2026-09-01T08:00:00.000Z",
    retrievedAt: "2026-09-01T10:00:00.000Z",
    contentHash: "b".repeat(64),
    provider: "poc-fetch",
    providerVersion: "1",
    parserVersion: "1",
    provenance: [{ provider: "poc-fetch", providerVersion: "1", sourceUrl, retrievedAt: "2026-09-01T10:00:00.000Z" }],
    confidence: 0.95,
    extractionWarnings: [],
    trust: "untrusted-evidence",
  };
}

function buildTools(): ToolGatewayPort {
  return {
    async invoke<TOutput>(request: ToolRequest) {
      if (request.capability === "public-content-search") {
        const query = String(request.input.query ?? "").toLowerCase();
        const source = String(request.input.source ?? "agent-reach").toLowerCase();
        if (query.includes("umrah")) return { output: [] as TOutput, provenance: [] };
        if (query.includes("seasonal menus") && source === "youtube") throw new Error("youtube degraded");
        if (query.includes("seasonal menus")) {
          const item = discoveryEvidence("Seasonal menus are changing how Malta restaurants attract repeat diners", "https://example.com/restaurant-seasonal-menu");
          return { output: [item] as TOutput, provenance: [] };
        }
        if (query.includes("ai agents") || query.includes("software architecture")) {
          const item = discoveryEvidence("AI agents move toward production-grade software architecture", "https://example.com/ai-agent-architecture");
          return { output: [item] as TOutput, provenance: [] };
        }
        return { output: [] as TOutput, provenance: [] };
      }

      if (request.capability === "public-content-fetch") {
        const sourceUrl = String(request.input.url ?? "");
        const title = sourceUrl.includes("restaurant")
          ? "Seasonal menus are changing how Malta restaurants attract repeat diners"
          : "AI agents move toward production-grade software architecture";
        return { output: { document: normalizedDocument(sourceUrl, title) } as TOutput, provenance: [] };
      }

      throw new Error(`Unexpected capability ${request.capability}`);
    },
  };
}

function buildRuntime(modelCalls: { value: number }): AgentRuntimePort {
  return {
    async invoke<TOutput>(request: AgentInvocationRequest) {
      modelCalls.value += 1;
      const evidence = request.task.context.evidence as Array<Record<string, unknown>>;
      const first = evidence[0];
      const sourceUrl = String(first?.sourceUrl ?? "");
      const title = String(first?.title ?? "");
      const restaurant = title.toLowerCase().includes("seasonal menus");
      return {
        output: {
          candidates: [{
            sourceUrl,
            title: restaurant
              ? "Seasonal menu opportunities for Malta restaurants"
              : "Production architecture lessons from the latest AI-agent shift",
            rationale: "The evidence directly matches the Brand topic and gives the audience a useful, evidence-backed angle.",
            whyNow: "The underlying source is fresh and relevant to the Brand's current Discovery Plan.",
            developmentDirection: restaurant
              ? "Explain how seasonal menus can drive repeat visits for restaurant audiences."
              : "Explain the architecture decisions required to move AI agents from demos into production.",
            topic: restaurant ? "seasonal menus" : "AI agents",
            proposedAngle: restaurant ? "Seasonal menu playbook" : "Production AI-agent architecture",
            targetAudience: restaurant ? "Restaurant operators" : "Software teams",
            recommendedFormat: "carousel",
            recommendedChannel: "instagram",
            confidence: 0.9,
            scores: {
              relevance: 0.94,
              evidence: 0.90,
              novelty: 0.82,
              timeliness: 0.90,
              brandAuthority: 0.84,
              audienceFit: 0.92,
            },
          }],
        } as TOutput,
        metadata: { runtime: "poc-runtime", runtimeVersion: "1", latencyMs: 1 },
      };
    },
  };
}

async function addReadyBrand(
  store: MemoryKairoRepository,
  accountId: string,
  input: { name: string; category: string; audience: string; topics: string; boundaries: string },
) {
  const created = await store.createWorkspaceWithBrand(accountId, { workspaceName: `${input.name} Studio`, brandName: input.name });
  const fields = [
    ["identity.description", "identity", `${input.name} provides useful expertise for its audience`],
    ["identity.products-services", "identity", `${input.name} products and services`],
    ["identity.category", "identity", input.category],
    ["audience.primary", "audience", input.audience],
    ["positioning.value-proposition", "positioning", `Useful, evidence-backed guidance for ${input.audience}`],
    ["content.pillars", "content-strategy", input.topics],
    ["boundaries.excluded-topics", "boundaries", input.boundaries],
  ] as const;
  for (const [fieldKey, section, value] of fields) {
    await store.putConfirmedBrandBrainField(accountId, created.brand.id, fieldKey, { section, value });
  }
  return created.brand;
}

const auth = { authorization: "Bearer test:alice" };

describe("Hunter Chunks 1-4 integrated certification", () => {
  it("certifies multi-Brand readiness → Snapshot/Plan → Hunter quality → persisted run lineage", async () => {
    const store = new MemoryKairoRepository();
    const verifier = new Verifier();
    const account = await store.resolveAccount({ provider: "test", subject: "alice" });
    const kairo = await addReadyBrand(store, account.id, {
      name: "Kairo",
      category: "AI developer technology",
      audience: "Software teams",
      topics: "AI agents, software architecture",
      boundaries: "Celebrity gossip, unsupported claims",
    });
    const restaurant = await addReadyBrand(store, account.id, {
      name: "Harbour Kitchen",
      category: "Restaurant hospitality",
      audience: "Restaurant operators",
      topics: "seasonal menus",
      boundaries: "Unsafe food claims",
    });
    const noorpath = await addReadyBrand(store, account.id, {
      name: "Noorpath",
      category: "Umrah religious travel",
      audience: "First-time Umrah travellers",
      topics: "Umrah guidance",
      boundaries: "Unverified visa promises",
    });

    const modelCalls = { value: 0 };
    const persisted: Array<{ brandId: string; input: OpportunityCandidateInput }> = [];
    const orchestrator = new HunterOrchestrator(buildTools(), buildRuntime(modelCalls), {
      async recordCandidate(_accountId, brandId, input) {
        persisted.push({ brandId, input });
        return { signal: {} as never, opportunity: { id: `opportunity-${persisted.length}` } as never };
      },
    });
    const captured: HunterRunInput[] = [];
    const runner = {
      async runForAuthorizedBrand(input: HunterRunInput) {
        captured.push(input);
        return orchestrator.runForAuthorizedBrand(input);
      },
    };
    const runStore = new MemoryHunterRunStore();
    const app = buildApp({ store, identityVerifier: verifier });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: verifier, runner, hunterRunStore: runStore });
    registerBrandDnaReadinessRoutes(app, { store, identityVerifier: verifier, hunterRunStore: runStore });

    const kairoResponse = await app.inject({ method: "POST", url: `/api/v1/brands/${kairo.id}/recommendations`, headers: auth });
    const restaurantResponse = await app.inject({ method: "POST", url: `/api/v1/brands/${restaurant.id}/recommendations`, headers: auth });
    const noorpathResponse = await app.inject({ method: "POST", url: `/api/v1/brands/${noorpath.id}/recommendations`, headers: auth });

    expect(kairoResponse.statusCode).toBe(200);
    expect(kairoResponse.json()).toMatchObject({ evidenceCount: 1, candidateCount: 1, opportunityCount: 1 });
    expect(restaurantResponse.statusCode).toBe(200);
    expect(restaurantResponse.json()).toMatchObject({ evidenceCount: 1, candidateCount: 1, opportunityCount: 1 });
    expect(restaurantResponse.json().degradedSources).toContain("youtube");
    expect(noorpathResponse.statusCode).toBe(200);
    expect(noorpathResponse.json()).toMatchObject({ evidenceCount: 0, candidateCount: 0, opportunityCount: 0 });
    expect(modelCalls.value).toBe(2);

    expect(persisted).toHaveLength(2);
    expect(persisted.find((item) => item.brandId === kairo.id)?.input.title).toContain("Production architecture");
    expect(persisted.find((item) => item.brandId === restaurant.id)?.input.title).toContain("Seasonal menu");
    expect(persisted.some((item) => item.brandId === noorpath.id)).toBe(false);

    const runs = runStore.all();
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.status === "succeeded" && Boolean(run.completedAt))).toBe(true);
    expect(runs.find((run) => run.brandId === kairo.id)).toMatchObject({ evidenceCount: 1, candidateCount: 1, opportunityCount: 1, degradedSources: [] });
    expect(runs.find((run) => run.brandId === restaurant.id)?.degradedSources).toContain("youtube");
    expect(runs.find((run) => run.brandId === noorpath.id)).toMatchObject({ evidenceCount: 0, candidateCount: 0, opportunityCount: 0 });

    for (const run of runs) {
      const input = captured.find((item) => item.brand.brandId === run.brandId);
      expect(input?.brand.contextVersion).toBe(`${run.snapshotVersion}|${run.planVersion}`);
      expect(run.snapshotVersion).toContain(`${run.brandId}@`);
      expect(run.planVersion).toContain(":discovery:1");
    }

    const latest = await app.inject({ method: "GET", url: `/api/v1/brands/${restaurant.id}/hunter-runs/latest`, headers: auth });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ brandId: restaurant.id, status: "succeeded", snapshotVersion: expect.any(String), planVersion: expect.any(String) });

    const activation = await app.inject({ method: "GET", url: `/api/v1/brands/${restaurant.id}/brain/activation`, headers: auth });
    expect(activation.statusCode).toBe(200);
    expect(activation.json().discoveryRun).toMatchObject({ brandId: restaurant.id, status: "succeeded", opportunityCount: 1 });
    expect(activation.json().schedule).toBeNull();

    const forbidden = await app.inject({ method: "GET", url: `/api/v1/brands/${restaurant.id}/hunter-runs/latest`, headers: { authorization: "Bearer test:bob" } });
    expect(forbidden.statusCode).toBe(404);

    await app.close();
  });
});
