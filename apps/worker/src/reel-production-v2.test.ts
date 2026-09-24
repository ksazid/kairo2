import { describe, expect, it } from "vitest";
import type { VideoProject } from "@kairo/domain/video-project";
import {
  SceneProductionError,
  SceneProductionService,
  VideoProviderRegistry,
  type GeneratedVideoClip,
  type NarrationEstimate,
  type NarrationProvider,
  type NarrationResult,
  type SceneProductionRevision,
  type SceneProductionStorePort,
  type VideoGenerationEstimate,
  type VideoGenerationProvider,
  type VideoGenerationRequest,
} from "./reel-production-v2";

const MP4 = new Uint8Array([0,0,0,24,0x66,0x74,0x79,0x70,0,0,0,0,0,0,0,0]);
const PNG = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);

function project(): VideoProject {
  return {
    schemaVersion: 1,
    format: "reel",
    id: "video-1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    campaignId: "campaign-1",
    assetId: "asset-1",
    sourceVersionId: "version-7",
    sourceVersion: 7,
    hook: "Hook",
    targetDurationSeconds: 12,
    scenes: [
      { id: "scene-01", startSecond: 0, endSecond: 5, visual: "Camera push toward product", onScreenText: "One", voiceover: "First narration", supportingClaimIds: ["claim-1"] },
      { id: "scene-02", startSecond: 5, endSecond: 12, visual: "Product in use", onScreenText: "Two", voiceover: "Second narration", supportingClaimIds: ["claim-2"] },
    ],
    caption: "Caption",
    cta: "CTA",
    supportingClaimIds: ["claim-1", "claim-2"],
  };
}

class FakeVideoProvider implements VideoGenerationProvider {
  readonly id = "motion";
  readonly model = "motion-1";
  readonly capabilities = { minDurationSeconds: 2, maxDurationSeconds: 15, aspectRatios: ["9:16"], maxReferenceAssets: 2 };
  generateCalls = 0;
  available = true;
  isAvailable() { return this.available; }
  async estimate(request: VideoGenerationRequest): Promise<VideoGenerationEstimate> {
    return { providerId: this.id, model: this.model, generatedSeconds: request.durationSeconds, billable: true, amount: 0.25, currency: "USD", pricingNote: "fixture" };
  }
  async generate(_request: VideoGenerationRequest): Promise<GeneratedVideoClip> {
    this.generateCalls += 1;
    return { contentType: "video/mp4", bytes: MP4, providerId: this.id, model: this.model, externalTaskId: `task-${this.generateCalls}`, generatedAt: "2026-09-25T00:00:00.000Z", actualCost: { billable: true, amount: 0.2, currency: "USD" } };
  }
}

class FakeNarration implements NarrationProvider {
  readonly id = "voice";
  readonly model = "voice-1";
  available = true;
  calls = 0;
  isAvailable() { return this.available; }
  async estimate(text: string): Promise<NarrationEstimate> {
    return { providerId: this.id, model: this.model, characters: text.length, billable: true, amount: 0.05, currency: "USD", pricingNote: "fixture" };
  }
  async synthesize(): Promise<NarrationResult> {
    this.calls += 1;
    return { contentType: "audio/mpeg", bytes: new Uint8Array([1,2,3,4]), providerId: this.id, model: this.model, generatedAt: "2026-09-25T00:00:00.000Z", actualCost: { billable: true, amount: 0.04, currency: "USD" } };
  }
}

class MemoryStore implements SceneProductionStorePort {
  revisions: SceneProductionRevision[] = [];
  assets: Array<{ assetId: string; role: string; hash: string }> = [];
  async latestRevision(input: { projectId: string; sceneId: string }) {
    return this.revisions.filter((item) => item.projectId === input.projectId && item.sceneId === input.sceneId).sort((a,b) => b.revision - a.revision)[0] ?? null;
  }
  async putAsset(input: { projectId: string; sceneId: string; revision: number; role: "visual" | "narration"; contentType: "video/mp4" | "image/png" | "audio/mpeg" | "audio/wav"; bytes: Uint8Array; contentHash: string }) {
    const assetId = `asset-${this.assets.length + 1}`;
    this.assets.push({ assetId, role: input.role, hash: input.contentHash });
    return { assetId };
  }
  async saveRevision(revision: SceneProductionRevision) { this.revisions.push(revision); }
}

describe("Reel Production V2 scene production", () => {
  it("selects only available providers that support the scene request", async () => {
    const provider = new FakeVideoProvider();
    const registry = new VideoProviderRegistry([provider]);
    const request: VideoGenerationRequest = { projectId: "p", sceneId: "s", prompt: "prompt", durationSeconds: 5, aspectRatio: "9:16", resolution: "1080x1920", referenceAssetIds: [] };
    expect(registry.select(request).id).toBe("motion");
    provider.available = false;
    expect(() => registry.select(request)).toThrow(SceneProductionError);
  });

  it("requires explicit confirmation before billable generation", async () => {
    const provider = new FakeVideoProvider();
    const service = new SceneProductionService(new VideoProviderRegistry([provider]), new FakeNarration(), new MemoryStore());
    await expect(service.regenerate(project(), "scene-01")).rejects.toMatchObject({ code: "paid-generation-confirmation-required" });
    expect(provider.generateCalls).toBe(0);
  });

  it("generates only the selected scene with narration, lineage and auditable provider cost", async () => {
    const provider = new FakeVideoProvider();
    const narration = new FakeNarration();
    const store = new MemoryStore();
    const service = new SceneProductionService(new VideoProviderRegistry([provider]), narration, store, () => new Date("2026-09-25T00:01:00.000Z"));

    const revision = await service.regenerate(project(), "scene-02", { confirmPaid: true });

    expect(provider.generateCalls).toBe(1);
    expect(narration.calls).toBe(1);
    expect(revision).toMatchObject({
      sceneId: "scene-02",
      revision: 1,
      status: "ready",
      supportingClaimIds: ["claim-2"],
      visual: { providerId: "motion", origin: "generated", rightsConfirmed: true },
      narration: { status: "current", providerId: "voice" },
      estimate: { billable: true, estimatedAmount: 0.3, currency: "USD" },
    });
    expect(store.assets).toHaveLength(2);
    expect(store.revisions).toHaveLength(1);
  });

  it("increments only the repaired scene revision", async () => {
    const provider = new FakeVideoProvider();
    const store = new MemoryStore();
    const service = new SceneProductionService(new VideoProviderRegistry([provider]), new FakeNarration(), store);

    const first = await service.regenerate(project(), "scene-01", { confirmPaid: true });
    const second = await service.regenerate(project(), "scene-01", { confirmPaid: true });
    const other = await service.regenerate(project(), "scene-02", { confirmPaid: true });

    expect([first.revision, second.revision, other.revision]).toEqual([1, 2, 1]);
    expect(store.revisions.map((item) => item.sceneId)).toEqual(["scene-01", "scene-01", "scene-02"]);
  });

  it("requires explicit rights evidence for uploaded replacement media", async () => {
    const service = new SceneProductionService(new VideoProviderRegistry([new FakeVideoProvider()]), new FakeNarration(), new MemoryStore());
    await expect(service.replaceVisualAsset(project(), "scene-01", { contentType: "image/png", bytes: PNG, rightsConfirmed: false, rightsBasis: "owned" })).rejects.toMatchObject({ code: "media-rights-confirmation-required" });
    const replacement = await service.replaceVisualAsset(project(), "scene-01", { contentType: "image/png", bytes: PNG, rightsConfirmed: true, rightsBasis: "Brand-owned source asset" });
    expect(replacement.visual).toMatchObject({ origin: "uploaded", rightsConfirmed: true, rightsBasis: "Brand-owned source asset" });
    expect(replacement.status).toBe("needs-narration");
  });

  it("fails readiness when a scene changed after its last production revision", async () => {
    const provider = new FakeVideoProvider();
    const store = new MemoryStore();
    const service = new SceneProductionService(new VideoProviderRegistry([provider]), new FakeNarration(), store);
    const p = project();
    await service.regenerate(p, "scene-01", { confirmPaid: true });
    await service.regenerate(p, "scene-02", { confirmPaid: true });
    expect(() => service.assertReady(p, store.revisions)).not.toThrow();

    const changed: VideoProject = { ...p, scenes: p.scenes.map((scene) => scene.id === "scene-02" ? { ...scene, visual: "A different visual direction" } : scene) };
    expect(() => service.assertReady(changed, store.revisions)).toThrowError(/stale/);
  });
});
