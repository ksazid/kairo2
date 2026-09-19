import { describe, expect, it } from "vitest";
import type { BrandPresenterDto } from "@kairo/contracts/presenter";
import type { AvatarProvider } from "./avatar-provider";
import { BrandPresenterService, type BrandPresenterStore } from "./brand-presenter";

class MemoryPresenterStore implements BrandPresenterStore {
  value: BrandPresenterDto | null = null;
  async getPresenter(workspaceId: string, brandId: string) {
    return this.value?.workspaceId === workspaceId && this.value.brandId === brandId ? this.value : null;
  }
  async putPresenter(value: BrandPresenterDto, expectedVersion?: number) {
    if (this.value && expectedVersion !== this.value.version) throw new Error("stale");
    if (!this.value && expectedVersion !== undefined) throw new Error("stale");
    this.value = value;
    return value;
  }
}

const availableProvider: AvatarProvider = {
  async getCapabilities() {
    return { providerConfigured: true, avatarRendering: true, testClip: true };
  },
};

describe("BrandPresenterService", () => {
  it("does not persist a fake presenter on read", async () => {
    const service = new BrandPresenterService(new MemoryPresenterStore());
    const response = await service.get("w1", "b1");
    expect(response.presenter).toBeNull();
    expect(response.eligibility).toBeNull();
    expect(response.capabilities).toMatchObject({
      providerConfigured: false,
      avatarRendering: false,
      testClip: false,
    });
  });

  it("stores profile readiness separately from provider eligibility", async () => {
    const service = new BrandPresenterService(
      new MemoryPresenterStore(),
      () => new Date("2026-08-24T17:00:00Z"),
    );
    const response = await service.save("w1", "b1", {
      displayName: "  Kairo Guide  ",
      status: "ready",
      mode: "hybrid-explainer",
      visualStyle: "  clean technical presenter  ",
      voiceStyle: " calm and concise ",
    });
    expect(response.presenter).toMatchObject({
      workspaceId: "w1",
      brandId: "b1",
      displayName: "Kairo Guide",
      status: "ready",
      mode: "hybrid-explainer",
      visualStyle: "clean technical presenter",
      voiceStyle: "calm and concise",
      version: 1,
    });
    expect(response.eligibility).toMatchObject({ status: "provider-unavailable" });
    expect(response.capabilities).toMatchObject({
      providerConfigured: false,
      avatarRendering: false,
      testClip: false,
    });
  });

  it("requires exact version for updates", async () => {
    const store = new MemoryPresenterStore();
    const service = new BrandPresenterService(store);
    const created = await service.save("w1", "b1", {
      displayName: "Guide",
      status: "ready",
      mode: "basic",
    });
    await expect(
      service.save("w1", "b1", { displayName: "Guide 2", status: "ready", mode: "basic" }),
    ).rejects.toThrow("Presenter changed");
    const updated = await service.save("w1", "b1", {
      displayName: "Guide 2",
      status: "ready",
      mode: "talking-avatar",
      expectedVersion: created.presenter!.version,
    });
    expect(updated.presenter).toMatchObject({ displayName: "Guide 2", mode: "talking-avatar", version: 2 });
  });

  it("fails closed unless both profile and provider are eligible", async () => {
    const store = new MemoryPresenterStore();
    const unavailable = new BrandPresenterService(store);
    const created = await unavailable.save("w1", "b1", {
      displayName: "Guide",
      status: "ready",
      mode: "basic",
    });
    await expect(
      unavailable.requireEligible("w1", "b1", created.presenter!.id),
    ).rejects.toThrow("Presenter rendering is not available for this Brand");

    const available = new BrandPresenterService(store, () => new Date(), availableProvider);
    await expect(available.requireEligible("w1", "b1", created.presenter!.id)).resolves.toMatchObject({
      id: created.presenter!.id,
      status: "ready",
    });

    await expect(available.requireEligible("w1", "b2", created.presenter!.id)).rejects.toThrow(
      "Presenter is not available for this Brand",
    );
  });
});
