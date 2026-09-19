import { describe, expect, it } from "vitest";
import type { KairoRepository } from "./index";
import type { ChannelAccount } from "./publishing";
import { ChannelAccountGroupService, type ChannelAccountGroupRepository } from "./channel-account-group-service";
import type { ChannelAccountGroup } from "./channel-account-groups";

const account = (id: string, brandId = "brand-1"): ChannelAccount => ({
  id,
  workspaceId: "ws-1",
  brandId,
  channel: "linkedin",
  accountRef: id,
  displayName: id,
  credentialRef: `vault:${id}`,
  capabilities: ["publish-text"],
  status: "connected",
  connectedAt: "2026-08-17T10:00:00.000Z",
});

function harness() {
  const saved = new Map<string, ChannelAccountGroup>();
  const channels = new Map([["a", account("a")], ["b", account("b")]]);
  const core = { getBrandForAccount: async (_accountId: string, brandId: string) => brandId === "brand-1" ? { id: brandId, workspaceId: "ws-1" } : null } as unknown as KairoRepository;
  const groups: ChannelAccountGroupRepository = {
    saveChannelAccountGroup: async (_accountId, group) => (saved.set(group.id, group), group),
    getChannelAccountGroup: async (_accountId, brandId, groupId) => { const item = saved.get(groupId); return item?.brandId === brandId ? item : null; },
    listChannelAccountGroups: async (_accountId, brandId) => [...saved.values()].filter((item) => item.brandId === brandId),
    deleteChannelAccountGroup: async (_accountId, brandId, groupId) => { const item = saved.get(groupId); if (item?.brandId === brandId) saved.delete(groupId); },
  };
  const service = new ChannelAccountGroupService(core, groups, { getChannelAccount: async (_accountId, brandId, id) => channels.get(id)?.brandId === brandId ? channels.get(id)! : null }, () => new Date("2026-08-17T12:00:00.000Z"));
  return { service };
}

describe("ChannelAccountGroupService", () => {
  it("creates a brand-scoped reusable destination group", async () => {
    const { service } = harness();
    const group = await service.create("owner", "brand-1", { name: "Launch channels", memberAccountIds: ["a", "b"] });
    expect(group.name).toBe("Launch channels");
    expect(group.memberAccountIds).toEqual(["a", "b"]);
    expect((await service.members("owner", "brand-1", group.id)).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("rejects members outside the selected brand scope", async () => {
    const { service } = harness();
    await expect(service.create("owner", "brand-1", { name: "Unsafe", memberAccountIds: ["outside"] })).rejects.toThrow("Channel Account not found");
  });

  it("rejects duplicate destinations in a group", async () => {
    const { service } = harness();
    await expect(service.create("owner", "brand-1", { name: "Duplicate", memberAccountIds: ["a", "a"] })).rejects.toThrow("must not contain duplicates");
  });
});
