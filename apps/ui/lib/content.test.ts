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

  it("creates encoded v2 preview routes with optional Brand context", () => {
    const item = { campaignId: "Malta Summer", id: "asset/one" };
    expect(contentPreviewHref(item)).toBe("/content/Malta%20Summer/asset%2Fone");
    expect(contentPreviewHref(item, "Brand One")).toBe("/content/Malta%20Summer/asset%2Fone?brand=Brand%20One");
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
