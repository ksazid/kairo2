import { describe, expect, it } from "vitest";
import type { CampaignDetailView, ContentReviewStatusView, PublishCommandView } from "./api";
import { campaignFallback, campaignHref, filterCampaigns, toCampaignItems } from "./campaigns";

describe("Kairo UI v2 Campaign behavior", () => {
  it("provides the three approved mock campaigns with coordinated assets", () => {
    const campaigns = campaignFallback();
    expect(campaigns).toHaveLength(3);
    expect(campaigns[0]).toMatchObject({ name: "Malta Summer Rental Guide", readyAssets: 2, totalAssets: 4 });
    expect(campaigns[0]?.assets.length).toBeGreaterThanOrEqual(3);
  });

  it("filters campaigns by status and objective search", () => {
    const campaigns = campaignFallback();
    expect(filterCampaigns(campaigns, { query: "engagement", status: "all" }).map((item) => item.id)).toEqual(["summer-travel"]);
    expect(filterCampaigns(campaigns, { query: "", status: "draft" }).map((item) => item.id)).toEqual(["local-car-hire"]);
  });

  it("builds encoded v2 Campaign Preview routes", () => {
    expect(campaignHref("summer guide", "brand/one")).toBe("/campaigns/summer%20guide?brand=brand%2Fone");
  });

  it("projects real campaign details and scheduled evidence", () => {
    const details = [{
      campaign: { id: "campaign", workspaceId: "workspace", brandId: "brand", ideaId: "idea", name: "Summer Guide", objective: "Drive bookings", status: "draft", createdAt: "2026-08-01T00:00:00Z" },
      assets: [{
        asset: { id: "asset", campaignId: "campaign", topic: "Malta coast", format: "reel", channel: "instagram", audience: "Visitors", hookType: "list", cta: "Book now", currentVersion: 1, status: "draft", createdAt: "2026-08-01T00:00:00Z" },
        versions: [{ id: "version", assetId: "asset", version: 1, content: "See Malta by car.", actor: "ai", createdAt: "2026-08-01T00:00:00Z" }],
      }],
    }] as CampaignDetailView[];
    const reviews = { asset: { review: { versionId: "version", status: "passed" }, approval: { versionId: "version", approvedAt: "2026-08-01T01:00:00Z" } } } as Record<string, ContentReviewStatusView | null>;
    const commands = [{ assetId: "asset", versionId: "version", scheduledFor: "2026-08-12T10:00:00Z", status: "scheduled", createdAt: "2026-08-01T02:00:00Z" }] as PublishCommandView[];
    expect(toCampaignItems(details, reviews, commands)[0]).toMatchObject({ id: "campaign", status: "scheduled", readyAssets: 1, totalAssets: 4 });
  });
});
