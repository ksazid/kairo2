import { describe, expect, it } from "vitest";
import { contentFallback, contentPreviewHref, contentWithCaption, filterContent, toContentItems } from "./content";
import type { CampaignDetailView, ContentReviewStatusView, PublishCommandView } from "./api";

describe("Kairo UI v2 Content behavior", () => {
  it("updates captions without discarding structured generation data", () => {
    expect(contentWithCaption('{"caption":"Old","scenes":[{"id":"one"}]}', "  New caption  ")).toBe('{"caption":"New caption","scenes":[{"id":"one"}]}');
    expect(contentWithCaption("Old caption", "New caption")).toBe("New caption");
    expect(() => contentWithCaption("Old caption", "   ")).toThrow(/empty/i);
  });
  it("provides the four approved preview items without sharing mutable media arrays", () => {
    const first = contentFallback();
    const second = contentFallback();
    expect(first).toHaveLength(4);
    expect(first.map((item) => item.formatLabel)).toEqual(["Carousel", "Reel", "Post", "Carousel"]);
    first[0]!.media.pop();
    expect(second[0]!.media).toHaveLength(4);
  });

  it("combines search, status and format filters", () => {
    const items = contentFallback();
    expect(filterContent(items, { query: "scenic", status: "all", format: "all" }).map((item) => item.id)).toEqual(["content-two"]);
    expect(filterContent(items, { query: "", status: "scheduled", format: "image" }).map((item) => item.id)).toEqual(["content-three"]);
    expect(filterContent(items, { query: "instagram", status: "all", format: "carousel" }).map((item) => item.id)).toEqual(["content-one"]);
  });

  it("keeps raw generated content intact while sanitizing Content metadata", () => {
    const rawCaption = "This is the complete generated caption and it must remain available for editing and publishing even when UI metadata is shortened.";
    const details = [{
      campaign: { id: "campaign", ideaId: "idea", name: "A Very Long Campaign Name for Maltese Food Stories and AI Video Experiments Across Social Media", objective: "Increase engagement by publishing useful local stories with clear practical value for readers across several channels.", status: "draft", createdAt: "2026-09-19T00:00:00Z" },
      assets: [{
        asset: { id: "asset", campaignId: "campaign", topic: "A Very Long Generated Topic About Creating AI Cooking Videos With Gemini and Google Flow for Local Readers", format: "reel", channel: "instagram", audience: "Readers in Malta who enjoy local food, recipes, lifestyle stories and practical digital content.", cta: "Read the full story and share it with somebody who would enjoy it today.", createdAt: "2026-09-19T00:00:00Z" },
        versions: [{ id: "version", assetId: "asset", content: rawCaption, createdAt: "2026-09-19T01:00:00Z" }],
      }],
    }] as CampaignDetailView[];

    const item = toContentItems(details, {}, [])[0]!;
    expect(item.title.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(item.objective.split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(item.audience.split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(item.cta.split(/\s+/).length).toBeLessThanOrEqual(10);
    expect(item.caption).toBe(rawCaption);
    expect(item.rawContent).toBe(rawCaption);
  });

  it("creates encoded v2 preview routes with optional Brand context", () => {
    const item = { campaignId: "Malta Summer", id: "asset/one" };
    expect(contentPreviewHref(item)).toBe("/content/Malta%20Summer/asset%2Fone");
    expect(contentPreviewHref(item, "Brand One")).toBe("/content/Malta%20Summer/asset%2Fone?brand=Brand%20One");
  });

  it("uses a neutral Kairo placeholder when real Content has no media", () => {
    const details = [{
      campaign: { id: "campaign", ideaId: "idea", name: "Restaurant Guide", objective: "Help diners", status: "draft", createdAt: "2026-09-19T00:00:00Z" },
      assets: [{
        asset: { id: "asset", campaignId: "campaign", topic: "Seasonal menu", format: "carousel", channel: "instagram", audience: "Diners", cta: "View menu", createdAt: "2026-09-19T00:00:00Z" },
        versions: [{ id: "version", assetId: "asset", content: "Try our seasonal menu.", createdAt: "2026-09-19T00:00:00Z" }],
      }],
    }] as CampaignDetailView[];
    expect(toContentItems(details, {}, [])[0]?.image).toBe("/kairo-logo.svg");
  });

  it("projects real Campaign assets and lifecycle evidence into Content items", () => {
    const details = [{
      campaign: { id: "campaign", ideaId: "idea", name: "Summer Guide", objective: "Drive bookings", status: "draft", createdAt: "2026-08-01T00:00:00Z" },
      assets: [{
        asset: { id: "asset", campaignId: "campaign", topic: "Malta coast", format: "reel", channel: "linkedin", audience: "Visitors", cta: "Book now", createdAt: "2026-08-01T00:00:00Z" },
        versions: [{ id: "version", assetId: "asset", content: JSON.stringify({ caption: "Take the coast road." }), libraryAssetRefs: [{ kind: "image", previewRef: "https://images.example/coast.jpg" }], createdAt: "2026-08-02T00:00:00Z" }],
      }],
    }] as CampaignDetailView[];
    const reviews: Record<string, ContentReviewStatusView> = { asset: { review: { versionId: "version", status: "review" }, approval: null } };
    const commands = [] as PublishCommandView[];
    expect(toContentItems(details, reviews, commands)).toEqual([
      expect.objectContaining({ id: "asset", caption: "Take the coast road.", channel: "LinkedIn", format: "reel", status: "in-review", image: "https://images.example/coast.jpg" }),
    ]);
  });
});
