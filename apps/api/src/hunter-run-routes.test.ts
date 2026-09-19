import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type {
  CompleteHunterRunInput,
  FailHunterRunInput,
  HunterRunRecord,
  HunterRunRepository,
  StartHunterRunInput,
} from "@kairo/domain/hunter-run-record";
import type { HunterRunInput } from "@kairo/worker/hunter";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryKairoRepository } from "./store";
import { registerHunterRecommendationRoutes, type HunterRecommendationRunner } from "./hunter-recommendation-routes";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice("Bearer test:".length) } : null;
  }
}

class MemoryRuns implements HunterRunRepository {
  records: HunterRunRecord[] = [];
  starts: StartHunterRunInput[] = [];
  private sequence = 0;

  async start(_accountId: string, input: StartHunterRunInput): Promise<HunterRunRecord> {
    this.starts.push(structuredClone(input));
    const record: HunterRunRecord = {
      schemaVersion: "1", runId: `run-${++this.sequence}`, workspaceId: input.workspaceId, brandId: input.brandId,
      snapshotVersion: input.snapshotVersion, planVersion: input.planVersion, trigger: input.trigger, status: "running",
      startedAt: input.startedAt, evidenceCount: 0, candidateCount: 0, opportunityCount: 0, sourcesScanned: [], degradedSources: [],
    };
    this.records.unshift(record);
    return structuredClone(record);
  }

  async complete(_accountId: string, runId: string, input: CompleteHunterRunInput): Promise<HunterRunRecord> {
    const record = this.must(runId);
    Object.assign(record, input, { status: "succeeded" as const });
    return structuredClone(record);
  }

  async fail(_accountId: string, runId: string, input: FailHunterRunInput): Promise<HunterRunRecord> {
    const record = this.must(runId);
    Object.assign(record, input, { status: "failed" as const, evidenceCount: 0, candidateCount: 0, opportunityCount: 0 });
    return structuredClone(record);
  }

  async listRecent(_accountId: string, brandId: string, limit = 20): Promise<HunterRunRecord[]> {
    return this.records.filter((record) => record.brandId === brandId).slice(0, limit).map((record) => structuredClone(record));
  }

  async getLatest(accountId: string, brandId: string): Promise<HunterRunRecord | undefined> {
    return (await this.listRecent(accountId, brandId, 1))[0];
  }

  private must(runId: string): HunterRunRecord {
    const record = this.records.find((item) => item.runId === runId);
    if (!record) throw new Error("missing run");
    return record;
  }
}

async function readyBrand(store: MemoryKairoRepository) {
  const account = await store.resolveAccount({ provider: "test", subject: "alice" });
  const created = await store.createWorkspaceWithBrand(account.id, { workspaceName: "Studio", brandName: "Kairo" });
  const brandId = created.brand.id;
  const fields = [
    ["identity.description", "identity", "AI-assisted content intelligence for modern brands"],
    ["identity.products-services", "identity", "Brand intelligence and content discovery"],
    ["audience.primary", "audience", "Technical founders and marketing teams"],
    ["positioning.value-proposition", "positioning", "Turn trusted Brand context into relevant content opportunities"],
    ["content.pillars", "content-strategy", "AI agents, software architecture, content intelligence"],
    ["boundaries.excluded-topics", "boundaries", "Unverified claims"],
    ["goal", "goals", "Build authority"],
  ] as const;
  for (const [key, section, value] of fields) await store.putConfirmedBrandBrainField(account.id, brandId, key, { section, value });
  return { account, brand: created.brand };
}

const auth = { authorization: "Bearer test:alice" };

describe("Hunter run records", () => {
  it("persists exact Snapshot + Discovery Plan lineage and exposes the latest truthful run", async () => {
    const store = new MemoryKairoRepository();
    const { brand } = await readyBrand(store);
    const runs = new MemoryRuns();
    const captured: HunterRunInput[] = [];
    const runner: HunterRecommendationRunner = { async runForAuthorizedBrand(input) { captured.push(input); return { evidenceCount: 9, candidateCount: 4, opportunityCount: 2, degradedSources: ["youtube"] }; } };
    const app = buildApp({ store, identityVerifier: new Verifier() });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: new Verifier(), runner, hunterRunStore: runs });

    const response = await app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/recommendations`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(runs.records).toHaveLength(1);
    expect(runs.records[0]).toMatchObject({ status: "succeeded", trigger: "manual", evidenceCount: 9, candidateCount: 4, opportunityCount: 2, degradedSources: ["youtube"] });
    const [snapshotVersion, planVersion] = captured[0]!.brand.contextVersion.split("|");
    expect(runs.records[0]!.snapshotVersion).toBe(snapshotVersion);
    expect(runs.records[0]!.planVersion).toBe(planVersion);

    const latest = await app.inject({ method: "GET", url: `/api/v1/brands/${brand.id}/hunter-runs/latest`, headers: auth });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ runId: runs.records[0]!.runId, snapshotVersion, planVersion, status: "succeeded" });
    await app.close();
  });

  it("coalesces concurrent recommendation clicks into one physical run record", async () => {
    const store = new MemoryKairoRepository();
    const { brand } = await readyBrand(store);
    const runs = new MemoryRuns();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const runner: HunterRecommendationRunner = { async runForAuthorizedBrand() { calls += 1; await gate; return { evidenceCount: 1, candidateCount: 1, opportunityCount: 1 }; } };
    const app = buildApp({ store, identityVerifier: new Verifier() });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: new Verifier(), runner, hunterRunStore: runs });

    const first = app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/recommendations`, headers: auth });
    const second = app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/recommendations`, headers: auth });
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(runs.records).toHaveLength(1);
    expect(runs.records[0]!.status).toBe("succeeded");
    await app.close();
  });

  it("closes a failed Hunter execution as a terminal failure record", async () => {
    const store = new MemoryKairoRepository();
    const { brand } = await readyBrand(store);
    const runs = new MemoryRuns();
    const runner: HunterRecommendationRunner = { async runForAuthorizedBrand() { const error = new Error("provider orchestration failed") as Error & { code?: string }; error.code = "provider_failure"; throw error; } };
    const app = buildApp({ store, identityVerifier: new Verifier() });
    registerHunterRecommendationRoutes(app, { store, identityVerifier: new Verifier(), runner, hunterRunStore: runs });

    const response = await app.inject({ method: "POST", url: `/api/v1/brands/${brand.id}/recommendations`, headers: auth });
    expect(response.statusCode).toBe(500);
    expect(runs.records).toHaveLength(1);
    expect(runs.records[0]).toMatchObject({ status: "failed", failureCode: "provider_failure", failureMessage: "provider orchestration failed" });
    expect(runs.records[0]!.completedAt).toBeTruthy();
    expect(runs.records[0]!.durationMs).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});
