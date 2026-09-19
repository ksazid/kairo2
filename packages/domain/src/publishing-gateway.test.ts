import { describe, expect, it } from "vitest";
import type { KairoRepository } from "./index";
import type { CampaignRepository } from "./campaign-service";
import type { ResearchRepository } from "./research-service";
import { ReviewService, type CriticEvaluationPort, type ReviewRepository } from "./review-service";
import type { ApprovalDestination, ContentApproval, ContentReview } from "./review";
import type { ChannelAccount, PublishAttempt, PublishCommand, PublishedPost } from "./publishing";
import { PublishingGateway, PublishingService, type PublishingRepository } from "./publishing-service";

class ReviewRepo implements ReviewRepository {
  reviews = new Map<string, ContentReview>();
  approvals = new Map<string, ContentApproval>();

  async saveReview(_: string, review: ContentReview) {
    this.reviews.set(review.assetId, review);
    return review;
  }
  async getLatestReview(_: string, __: string, assetId: string) {
    return this.reviews.get(assetId) ?? null;
  }
  async saveApproval(_: string, approval: ContentApproval) {
    const existing = await this.getApprovalForDestination("", approval.brandId, approval.assetId, approval.destination);
    if (existing && existing.versionId === approval.versionId) return existing;
    this.approvals.set(approval.id, approval);
    return approval;
  }
  async getApproval(_: string, brandId: string, assetId: string) {
    return [...this.approvals.values()].find((x) => x.brandId === brandId && x.assetId === assetId) ?? null;
  }
  async getApprovalForDestination(_: string, brandId: string, assetId: string, destination: ApprovalDestination) {
    return [...this.approvals.values()].find(
      (x) => x.brandId === brandId && x.assetId === assetId && x.destination.channel === destination.channel && x.destination.accountRef === destination.accountRef,
    ) ?? null;
  }
  async listApprovals(_: string, brandId: string, assetId: string) {
    return [...this.approvals.values()].filter((x) => x.brandId === brandId && x.assetId === assetId);
  }
}

class PublishRepo implements PublishingRepository {
  channels = new Map<string, ChannelAccount>();
  commands = new Map<string, PublishCommand>();
  attempts = new Map<string, PublishAttempt>();

  async saveChannelAccount(_: string, value: ChannelAccount) {
    this.channels.set(value.id, value);
    return value;
  }
  async getChannelAccount(_: string, __: string, id: string) {
    return this.channels.get(id) ?? null;
  }
  async listChannelAccounts() {
    return [...this.channels.values()];
  }
  async saveCommand(_: string, value: PublishCommand) {
    this.commands.set(value.id, value);
    return value;
  }
  async getCommand(_: string, __: string, id: string) {
    return this.commands.get(id) ?? null;
  }
  async getCommandByApproval(_: string, __: string, approvalId: string) {
    return [...this.commands.values()].find((x) => x.approvalId === approvalId) ?? null;
  }
  async listCommands() {
    return [...this.commands.values()];
  }
  async cancelCommand(_: string, __: string, id: string) {
    const command = this.commands.get(id)!;
    const next = { ...command, status: "cancelled" as const };
    this.commands.set(id, next);
    return next;
  }
  async recordDispatch(_: string, command: PublishCommand, attempt: PublishAttempt) {
    this.commands.set(command.id, command);
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }
  async getLatestAttempt(_: string, __: string, commandId: string) {
    return [...this.attempts.values()].find((x) => x.commandId === commandId) ?? null;
  }
  async recordOutcome(_: string, command: PublishCommand, attempt: PublishAttempt, _post?: PublishedPost) {
    this.commands.set(command.id, command);
    this.attempts.set(attempt.id, attempt);
    return command;
  }
}

function fixture() {
  const campaign = {
    campaign: {
      id: "campaign-1",
      workspaceId: "ws-1",
      brandId: "brand-1",
      ideaId: "idea-1",
      researchId: "research-1",
      angleId: "angle-1",
      name: "Launch",
      objective: "Reach",
      supportingClaimIds: [],
      createdAt: "2026-08-17T08:00:00Z",
    },
    assets: [
      {
        asset: {
          id: "asset-instagram",
          workspaceId: "ws-1",
          brandId: "brand-1",
          campaignId: "campaign-1",
          channel: "instagram",
          format: "image",
          audience: "riders",
          topic: "checklist",
          hookType: "question",
          cta: "save",
          currentVersion: 1,
          createdAt: "2026-08-17T08:00:00Z",
        },
        versions: [
          {
            id: "version-instagram-1",
            workspaceId: "ws-1",
            brandId: "brand-1",
            campaignId: "campaign-1",
            assetId: "asset-instagram",
            version: 1,
            content: "Instagram caption",
            supportingClaimIds: [],
            actor: "agent",
            action: "initial-draft",
            createdAt: "2026-08-17T08:00:00Z",
          },
        ],
      },
      {
        asset: {
          id: "asset-linkedin",
          workspaceId: "ws-1",
          brandId: "brand-1",
          campaignId: "campaign-1",
          channel: "linkedin",
          format: "post",
          audience: "buyers",
          topic: "checklist",
          hookType: "fact",
          cta: "read",
          currentVersion: 1,
          createdAt: "2026-08-17T08:00:00Z",
        },
        versions: [
          {
            id: "version-linkedin-1",
            workspaceId: "ws-1",
            brandId: "brand-1",
            campaignId: "campaign-1",
            assetId: "asset-linkedin",
            version: 1,
            content: "LinkedIn post",
            supportingClaimIds: [],
            actor: "agent",
            action: "initial-draft",
            createdAt: "2026-08-17T08:00:00Z",
          },
        ],
      },
    ],
  };
  const core = {
    getBrandForAccount: async () => ({ id: "brand-1", workspaceId: "ws-1", name: "Kairo", createdAt: "2026-08-17T08:00:00Z" }),
  } as unknown as KairoRepository;
  const campaigns = { getCampaign: async () => campaign } as unknown as CampaignRepository;
  const reviews = new ReviewRepo();
  reviews.reviews.set("asset-instagram", passedReview("asset-instagram", "version-instagram-1"));
  reviews.reviews.set("asset-linkedin", passedReview("asset-linkedin", "version-linkedin-1"));
  const reviewService = new ReviewService(
    campaigns,
    {} as ResearchRepository,
    reviews,
    { async evaluate() { return { passed: true, score: 100, findings: [] }; } } as CriticEvaluationPort,
    () => new Date("2026-08-17T08:30:00Z"),
  );
  const publishingRepo = new PublishRepo();
  const publishingService = new PublishingService(core, campaigns, reviews, publishingRepo, () => new Date("2026-08-17T08:30:00Z"));
  const gateway = new PublishingGateway(reviewService, publishingService);
  return { gateway, publishingService, publishingRepo, reviews };
}

function passedReview(assetId: string, versionId: string): ContentReview {
  return {
    id: `review-${assetId}`,
    workspaceId: "ws-1",
    brandId: "brand-1",
    campaignId: "campaign-1",
    assetId,
    versionId,
    version: 1,
    status: "passed",
    truth: {
      workspaceId: "ws-1",
      brandId: "brand-1",
      campaignId: "campaign-1",
      assetId,
      versionId,
      version: 1,
      passed: true,
      findings: [],
    },
    critic: { passed: true, score: 95, findings: [] },
    revisionCycle: 0,
    requestedAt: "2026-08-17T08:10:00Z",
    completedAt: "2026-08-17T08:11:00Z",
  };
}

describe("PublishingGateway", () => {
  it("fans one campaign action into independently approved Instagram and LinkedIn commands and is retry-idempotent", async () => {
    const { gateway, publishingService, publishingRepo, reviews } = fixture();
    const instagram = await publishingService.connect("human-1", "brand-1", {
      channel: "instagram",
      accountRef: "178414000001",
      displayName: "Kairo IG",
      credentialRef: "vault://instagram-secret",
      capabilities: ["publish-image", "publish-carousel", "publish-reel"],
    });
    const linkedin = await publishingService.connect("human-1", "brand-1", {
      channel: "linkedin",
      accountRef: "urn:li:organization:1",
      displayName: "Kairo LinkedIn",
      credentialRef: "vault://linkedin-secret",
      capabilities: ["publish-text"],
    });
    const input = {
      scheduledFor: "2026-08-17T09:00:00Z",
      destinations: [
        {
          assetId: "asset-instagram",
          expectedVersion: 1,
          channelAccountId: instagram.id,
          contentType: "image" as const,
          mediaItems: [{ kind: "image" as const, url: "https://media.example/kairo.png" }],
        },
        { assetId: "asset-linkedin", expectedVersion: 1, channelAccountId: linkedin.id, contentType: "text" as const },
      ],
    };
    const first = await gateway.distribute("human-1", "brand-1", "campaign-1", input);
    const second = await gateway.distribute("human-1", "brand-1", "campaign-1", input);
    expect(first.destinations.map((x) => x.status)).toEqual(["scheduled", "scheduled"]);
    expect(second.destinations.map((x) => x.commandId)).toEqual(first.destinations.map((x) => x.commandId));
    expect(publishingRepo.commands.size).toBe(2);
    expect(reviews.approvals.size).toBe(2);
    expect(JSON.stringify(first)).not.toContain("vault://");
    expect(JSON.stringify(first)).not.toContain("credentialRef");
  });

  it("keeps valid destinations scheduled when another account requires reconnection", async () => {
    const { gateway, publishingService, publishingRepo } = fixture();
    const instagram = await publishingService.connect("human-1", "brand-1", {
      channel: "instagram",
      accountRef: "178414000001",
      displayName: "Kairo IG",
      credentialRef: "vault://instagram-secret",
      capabilities: ["publish-image"],
    });
    const linkedin = await publishingService.connect("human-1", "brand-1", {
      channel: "linkedin",
      accountRef: "urn:li:organization:1",
      displayName: "Kairo LinkedIn",
      credentialRef: "vault://linkedin-secret",
      capabilities: ["publish-text"],
    });
    publishingRepo.channels.set(linkedin.id, { ...linkedin, status: "reconnect-required" });
    const result = await gateway.distribute("human-1", "brand-1", "campaign-1", {
      scheduledFor: "2026-08-17T09:00:00Z",
      destinations: [
        {
          assetId: "asset-instagram",
          expectedVersion: 1,
          channelAccountId: instagram.id,
          contentType: "image",
          mediaItems: [{ kind: "image", url: "https://media.example/kairo.png" }],
        },
        { assetId: "asset-linkedin", expectedVersion: 1, channelAccountId: linkedin.id, contentType: "text" },
      ],
    });
    expect(result.destinations).toMatchObject([
      { status: "scheduled", channel: "instagram" },
      { status: "reconnect-required", channel: "linkedin" },
    ]);
    expect(publishingRepo.commands.size).toBe(1);
  });
});
