import { describe, expect, it } from "vitest";
import type { BrandPresenterDto } from "@kairo/contracts/presenter";
import type { AvatarProvider } from "./avatar-provider";
import {
  SimpleCreationService,
  type SimpleCreationRequest,
  type SimpleCreationStore,
} from "./simple-creation";

const availableProvider: AvatarProvider = {
  async getCapabilities() {
    return { providerConfigured: true, avatarRendering: true, testClip: true };
  },
};

describe("simple creation", () => {
  it.each([["post", "image"], ["carousel", "carousel"], ["reel", "reel"], ["video", "video"]])("accepts the %s creation path and preserves Brand-scoped media", async (label, rawPreference) => {
    const contentPreference = rawPreference as "image" | "carousel" | "reel" | "video";
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, {} as never, {} as never, { develop: async () => {} });
    const created = await service.start("a", "w", "b", {
      goal: `Create a ${label}`,
      contentPreference,
      mediaAssetIds: ["media-a", "media-b", "media-a"],
    });
    expect(created.contentPreference).toBe(contentPreference);
    expect(created.mediaAssetIds).toEqual(["media-a", "media-b"]);
    expect(store.mediaCalls.at(-1)).toEqual({ accountId: "a", brandId: "b", ids: ["media-a", "media-b"] });
  });

  it("rejects unsupported formats before creating an Idea or reserving media", async () => {
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, {} as never, {} as never, { develop: async () => {} });
    await expect(service.start("a", "w", "b", { goal: "Create it", contentPreference: "podcast" as never })).rejects.toThrow();
    expect(store.rows).toHaveLength(0);
    expect(store.mediaCalls).toHaveLength(0);
  });

  it("validates a compact creation brief without requiring a presenter", async () => {
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, {} as never, {} as never, { develop: async () => {} });
    await expect(
      service.start("a", "w", "b", {
        goal: "  Grow awareness ",
        source: "https://example.com",
        contentPreference: "carousel",
      }),
    ).resolves.toMatchObject({
      goal: "Grow awareness",
      source: "https://example.com",
      contentPreference: "carousel",
      status: "queued",
    });
    await expect(
      service.start("a", "w", "b", { goal: "", contentPreference: "auto" }),
    ).rejects.toThrow("goal is required");
  });

  it("accepts the approved Video format and preserves validated media ids", async () => {
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, {} as never, {} as never, { develop: async () => {} });
    const created = await service.start("a", "w", "b", {
      goal: "Create the product walkthrough",
      contentPreference: "video",
      mediaAssetIds: ["media-1", "media-1", "media-2"],
    });
    expect(created).toMatchObject({
      contentPreference: "video",
      mediaAssetIds: ["media-1", "media-2"],
    });
    expect(store.mediaCalls).toEqual([{ accountId: "a", brandId: "b", ids: ["media-1", "media-2"] }]);
  });

  it("does not allow a Presenter on Post or Carousel", async () => {
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, {} as never, {} as never, { develop: async () => {} });
    await expect(service.start("a", "w", "b", {
      goal: "Launch",
      contentPreference: "image",
      presenterId: "p1",
    })).rejects.toThrow("Presenter is available only for Reel or Video creation");
    expect(store.rows).toHaveLength(0);
  });

  it("persists an eligible presenter and exposes only its public identity", async () => {
    const store = new MemoryStore();
    store.presenter = presenter({ status: "ready" });
    const service = new SimpleCreationService(
      store,
      {} as never,
      {} as never,
      { develop: async () => {} },
      () => new Date(),
      availableProvider,
    );
    const created = await service.start("a", "w", "b", { goal: "Launch", presenterId: "p1" });
    expect(created.presenterId).toBe("p1");
    await expect(service.get("a", "b", created.id)).resolves.toMatchObject({
      presenter: { id: "p1", displayName: "Guide", mode: "hybrid-explainer" },
    });
  });

  it("fails before persistence when provider capability is unavailable", async () => {
    const store = new MemoryStore();
    store.presenter = presenter({ status: "ready" });
    const service = new SimpleCreationService(store, {} as never, {} as never, { develop: async () => {} });
    await expect(
      service.start("a", "w", "b", { goal: "Launch", presenterId: "p1" }),
    ).rejects.toThrow("Presenter rendering is not available for this Brand");
    expect(store.rows).toHaveLength(0);
  });

  it("fails before persistence for a non-ready or cross-Brand presenter", async () => {
    const store = new MemoryStore();
    store.presenter = presenter({ status: "draft" });
    const service = new SimpleCreationService(
      store,
      {} as never,
      {} as never,
      { develop: async () => {} },
      () => new Date(),
      availableProvider,
    );
    await expect(
      service.start("a", "w", "b", { goal: "Launch", presenterId: "p1" }),
    ).rejects.toThrow("Presenter is not available for this Brand");
    expect(store.rows).toHaveLength(0);

    store.presenter = presenter({ status: "ready", brandId: "other" });
    await expect(
      service.start("a", "w", "b", { goal: "Launch", presenterId: "p1" }),
    ).rejects.toThrow("Presenter is not available for this Brand");
    expect(store.rows).toHaveLength(0);
  });

  it("exposes friendly progress without leaking internal pipeline ids", async () => {
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, {} as never, {} as never, { develop: async () => {} });
    const created = await service.start("a", "w", "b", { goal: "Launch" });
    const view = await service.get("a", "b", created.id);
    expect(view).toMatchObject({
      status: "queued",
      progress: { stage: "queued", message: "Getting your creation ready" },
    });
    expect(view).not.toHaveProperty("ideaId");
  });
});

class MemoryStore implements SimpleCreationStore {
  rows: SimpleCreationRequest[] = [];
  presenter: BrandPresenterDto | null = null;
  mediaCalls: Array<{ accountId: string; brandId: string; ids: string[] }> = [];
  homeMedia: NonNullable<SimpleCreationStore["homeMedia"]> = {
    requireAssets: async (accountId, brandId, ids) => {
      this.mediaCalls.push({ accountId, brandId, ids: [...ids] });
      return [];
    },
  };

  async create(value: SimpleCreationRequest) {
    this.rows.push(value);
    return value;
  }
  async get(accountId: string, brandId: string, id: string) {
    return this.rows.find((item) => item.accountId === accountId && item.brandId === brandId && item.id === id) ?? null;
  }
  async claim() {
    return null;
  }
  async advance() {}
  async getPresenter(workspaceId: string, brandId: string) {
    return this.presenter?.workspaceId === workspaceId && this.presenter.brandId === brandId ? this.presenter : null;
  }
  async putPresenter(value: BrandPresenterDto) {
    this.presenter = value;
    return value;
  }
}

function presenter(value: Partial<BrandPresenterDto> = {}): BrandPresenterDto {
  return {
    id: "p1",
    workspaceId: "w",
    brandId: "b",
    displayName: "Guide",
    status: "ready",
    mode: "hybrid-explainer",
    version: 1,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...value,
  };
}
