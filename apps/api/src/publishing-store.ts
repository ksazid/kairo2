import { ResourceNotFoundError, type KairoRepository } from "@kairo/domain";
import type { ChannelAccount, PublishAttempt, PublishCommand, PublishedPost } from "@kairo/domain/publishing";
import type { PublishingRepository } from "@kairo/domain/publishing-service";

export class MemoryPublishingRepository implements PublishingRepository {
  private channels = new Map<string, ChannelAccount>();
  private commands = new Map<string, PublishCommand>();
  private attempts = new Map<string, PublishAttempt>();
  private posts = new Map<string, PublishedPost>();

  constructor(private core: KairoRepository) {}

  async saveChannelAccount(accountId: string, channel: ChannelAccount) {
    await this.scope(accountId, channel.brandId);
    this.channels.set(channel.id, structuredClone(channel));
    return structuredClone(channel);
  }

  async getChannelAccount(accountId: string, brandId: string, id: string) {
    await this.scope(accountId, brandId);
    const channel = this.channels.get(id);
    return channel?.brandId === brandId ? structuredClone(channel) : null;
  }

  async listChannelAccounts(accountId: string, brandId: string) {
    await this.scope(accountId, brandId);
    return [...this.channels.values()].filter((x) => x.brandId === brandId).map((x) => structuredClone(x));
  }

  async saveCommand(accountId: string, command: PublishCommand) {
    await this.scope(accountId, command.brandId);
    this.commands.set(command.id, structuredClone(command));
    return structuredClone(command);
  }

  async getCommand(accountId: string, brandId: string, id: string) {
    await this.scope(accountId, brandId);
    const command = this.commands.get(id);
    return command?.brandId === brandId ? structuredClone(command) : null;
  }

  async getCommandByApproval(accountId: string, brandId: string, approvalId: string) {
    await this.scope(accountId, brandId);
    const command = [...this.commands.values()].find((x) => x.brandId === brandId && x.approvalId === approvalId);
    return command ? structuredClone(command) : null;
  }

  async listCommands(accountId: string, brandId: string, from?: string, to?: string) {
    await this.scope(accountId, brandId);
    return [...this.commands.values()]
      .filter((x) => x.brandId === brandId && (!from || x.scheduledFor >= from) && (!to || x.scheduledFor <= to))
      .sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor) || x.id.localeCompare(y.id))
      .map((x) => structuredClone(x));
  }

  async cancelCommand(accountId: string, brandId: string, id: string) {
    await this.scope(accountId, brandId);
    const command = this.commands.get(id);
    if (!command || command.brandId !== brandId) throw new ResourceNotFoundError("Publish Command not found");
    const next = { ...command, status: "cancelled" as const };
    this.commands.set(id, next);
    return structuredClone(next);
  }

  async recordDispatch(accountId: string, command: PublishCommand, attempt: PublishAttempt) {
    await this.scope(accountId, command.brandId);
    this.commands.set(command.id, structuredClone(command));
    this.attempts.set(attempt.id, structuredClone(attempt));
    return structuredClone(attempt);
  }

  async getLatestAttempt(accountId: string, brandId: string, commandId: string) {
    const command = await this.getCommand(accountId, brandId, commandId);
    if (!command) return null;
    const match = [...this.attempts.values()].filter((x) => x.commandId === commandId).sort((x, y) => y.attemptNumber - x.attemptNumber)[0];
    return match ? structuredClone(match) : null;
  }

  async recordOutcome(accountId: string, command: PublishCommand, attempt: PublishAttempt, post?: PublishedPost) {
    await this.scope(accountId, command.brandId);
    this.commands.set(command.id, structuredClone(command));
    this.attempts.set(attempt.id, structuredClone(attempt));
    if (post) this.posts.set(post.id, structuredClone(post));
    return structuredClone(command);
  }

  private async scope(accountId: string, brandId: string) {
    const brand = await this.core.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    return brand;
  }
}
