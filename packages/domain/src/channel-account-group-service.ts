import { randomUUID } from "node:crypto";
import type { KairoRepository } from "./index";
import { ResourceNotFoundError } from "./index";
import type { ChannelAccount } from "./publishing";
import { createChannelAccountGroup, updateChannelAccountGroup, type ChannelAccountGroup } from "./channel-account-groups";

export interface ChannelAccountGroupRepository {
  saveChannelAccountGroup(accountId: string, group: ChannelAccountGroup): Promise<ChannelAccountGroup>;
  getChannelAccountGroup(accountId: string, brandId: string, groupId: string): Promise<ChannelAccountGroup | null>;
  listChannelAccountGroups(accountId: string, brandId: string): Promise<ChannelAccountGroup[]>;
  deleteChannelAccountGroup(accountId: string, brandId: string, groupId: string): Promise<void>;
}

export interface ChannelAccountLookup {
  getChannelAccount(accountId: string, brandId: string, channelAccountId: string): Promise<ChannelAccount | null>;
}

export class ChannelAccountGroupService {
  constructor(
    private core: KairoRepository,
    private groups: ChannelAccountGroupRepository,
    private channels: ChannelAccountLookup,
    private now: () => Date = () => new Date(),
  ) {}

  list(accountId: string, brandId: string) {
    return this.groups.listChannelAccountGroups(accountId, brandId);
  }

  async group(accountId: string, brandId: string, groupId: string) {
    const group = await this.groups.getChannelAccountGroup(accountId, brandId, groupId);
    if (!group) throw new ResourceNotFoundError("Channel Account Group not found");
    return group;
  }

  async create(accountId: string, brandId: string, input: { name: string; memberAccountIds: string[] }) {
    const brand = await this.core.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    await this.requireMembers(accountId, brandId, input.memberAccountIds);
    const at = this.now().toISOString();
    return this.groups.saveChannelAccountGroup(accountId, createChannelAccountGroup({
      id: randomUUID(),
      workspaceId: brand.workspaceId,
      brandId,
      name: input.name,
      memberAccountIds: input.memberAccountIds,
      createdAt: at,
      updatedAt: at,
    }));
  }

  async update(accountId: string, brandId: string, groupId: string, input: { name: string; memberAccountIds: string[] }) {
    const current = await this.group(accountId, brandId, groupId);
    await this.requireMembers(accountId, brandId, input.memberAccountIds);
    return this.groups.saveChannelAccountGroup(accountId, updateChannelAccountGroup(current, {
      name: input.name,
      memberAccountIds: input.memberAccountIds,
      updatedAt: this.now().toISOString(),
    }));
  }

  async remove(accountId: string, brandId: string, groupId: string) {
    await this.group(accountId, brandId, groupId);
    await this.groups.deleteChannelAccountGroup(accountId, brandId, groupId);
  }

  async members(accountId: string, brandId: string, groupId: string): Promise<ChannelAccount[]> {
    const group = await this.group(accountId, brandId, groupId);
    return Promise.all(group.memberAccountIds.map(async (id) => {
      const account = await this.channels.getChannelAccount(accountId, brandId, id);
      if (!account) throw new ResourceNotFoundError("Channel Account Group contains an unavailable destination");
      return account;
    }));
  }

  private async requireMembers(accountId: string, brandId: string, ids: string[]) {
    await Promise.all(ids.map(async (id) => {
      const account = await this.channels.getChannelAccount(accountId, brandId, id);
      if (!account) throw new ResourceNotFoundError("Channel Account not found");
    }));
  }
}
