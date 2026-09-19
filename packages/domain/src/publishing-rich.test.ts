import { describe, expect, it } from "vitest";
import { connectChannelAccount, createPublishCommand } from "./publishing";
import type { ContentApproval } from "./review";

const approval: ContentApproval = {
  id: "approval-ig",
  reviewId: "review-ig",
  approverAccountId: "human-1",
  workspaceId: "ws-1",
  brandId: "brand-1",
  campaignId: "campaign-1",
  assetId: "asset-1",
  versionId: "version-1",
  version: 1,
  destination: { channel: "instagram", accountRef: "123" },
  approvedAt: "2026-08-15T02:00:00Z",
};

function account(capabilities: Array<"publish-image" | "publish-carousel" | "publish-reel">) {
  return connectChannelAccount({
    id: "channel-ig",
    workspaceId: "ws-1",
    brandId: "brand-1",
    channel: "instagram",
    accountRef: "123",
    displayName: "Kairo IG",
    credentialRef: "vault://instagram/brand-1",
    capabilities,
    connectedAt: "2026-08-15T02:01:00Z",
  });
}

const times = { scheduledFor: "2026-08-15T03:00:00Z", createdAt: "2026-08-15T02:02:00Z" };

describe("VS-15 rich publishing domain", () => {
  it("schedules an explicit Reel with one video and bounded Instagram options", () => {
    const command = createPublishCommand({
      id: "reel-1",
      approval,
      currentVersionId: "version-1",
      channelAccount: account(["publish-reel"]),
      contentType: "reel",
      mediaItems: [{ kind: "video", url: "https://cdn.example.com/reel.mp4" }],
      options: { instagram: { shareToFeed: true } },
      ...times,
    });

    expect(command).toMatchObject({
      status: "scheduled",
      contentType: "reel",
      mediaItems: [{ kind: "video", url: "https://cdn.example.com/reel.mp4" }],
      options: { instagram: { shareToFeed: true } },
    });
  });

  it("requires the exact Instagram media shape for image, Reel and image carousel", () => {
    expect(() => createPublishCommand({
      id: "bad-image", approval, currentVersionId: "version-1", channelAccount: account(["publish-image"]),
      contentType: "image", mediaItems: [], ...times,
    })).toThrow(/exactly one image/i);

    expect(() => createPublishCommand({
      id: "bad-reel", approval, currentVersionId: "version-1", channelAccount: account(["publish-reel"]),
      contentType: "reel", mediaItems: [{ kind: "image", url: "https://cdn.example.com/not-video.jpg" }], ...times,
    })).toThrow(/exactly one video/i);

    expect(() => createPublishCommand({
      id: "bad-carousel", approval, currentVersionId: "version-1", channelAccount: account(["publish-carousel"]),
      contentType: "carousel", mediaItems: [{ kind: "image", url: "https://cdn.example.com/1.jpg" }], ...times,
    })).toThrow(/2.*10.*images/i);

    const carousel = createPublishCommand({
      id: "carousel-1", approval, currentVersionId: "version-1", channelAccount: account(["publish-carousel"]),
      contentType: "carousel",
      mediaItems: [
        { kind: "image", url: "https://cdn.example.com/1.jpg" },
        { kind: "image", url: "https://cdn.example.com/2.jpg" },
      ],
      ...times,
    });
    expect(carousel.status).toBe("scheduled");
  });

  it("requires publish-reel capability and normalizes options instead of retaining arbitrary input", () => {
    const manual = createPublishCommand({
      id: "reel-manual", approval, currentVersionId: "version-1", channelAccount: account(["publish-image"]),
      contentType: "reel", mediaItems: [{ kind: "video", url: "https://cdn.example.com/reel.mp4" }], ...times,
    });
    expect(manual.status).toBe("manual-required");

    const command = createPublishCommand({
      id: "reel-options", approval, currentVersionId: "version-1", channelAccount: account(["publish-reel"]),
      contentType: "reel", mediaItems: [{ kind: "video", url: "https://cdn.example.com/reel.mp4" }],
      options: { instagram: { shareToFeed: false, accessToken: "must-not-survive" } } as any,
      ...times,
    });
    expect(command.options).toEqual({ instagram: { shareToFeed: false } });
    expect(JSON.stringify(command)).not.toContain("must-not-survive");
  });
});
