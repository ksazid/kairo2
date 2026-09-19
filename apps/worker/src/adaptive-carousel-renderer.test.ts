import { describe, expect, it, vi } from "vitest";
import type { CarouselPlan } from "@kairo/domain/creative-formats";
import { AdaptiveBitmapCarouselRenderer } from "./adaptive-carousel-renderer";
import { CreativeAssetProductionService, type CreativeObjectStorePort } from "./creative-renderer";

const longHook = "A practical guide to choosing a content strategy that fits your audience and goals";
const cta = "Save this guide and use it for your next planning session.";
const plan: CarouselPlan = {
  format: "carousel",
  coverHook: longHook,
  slides: [
    { headline: longHook, body: "For teams that need a clear decision without extra noise.", supportingClaimIds: ["claim-1"] },
    { headline: "What the evidence says", body: "Start with the audience need, then compare the format against the outcome you want to create.", supportingClaimIds: ["claim-1"] },
    { headline: "Your next step", body: cta, supportingClaimIds: ["claim-1"] },
  ],
  caption: "An evidence-linked guide.",
  cta,
  supportingClaimIds: ["claim-1"],
};

describe("adaptive carousel renderer", () => {
  it("fits live-style bootstrap copy at the production preset without truncating it or drawing equivalent text twice", async () => {
    const store: CreativeObjectStorePort = { putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })) };
    const produced = await new CreativeAssetProductionService(store, { carouselRenderer: new AdaptiveBitmapCarouselRenderer() }).produce(
      { workspaceId: "ws-1", brandId: "brand-1" },
      plan,
    );

    const slides = produced.assets.filter((asset) => asset.role === "carousel-slide");
    expect(slides).toHaveLength(3);
    expect(slides[0]?.layoutMetrics?.canvas).toEqual({ width: 1080, height: 1350 });
    expect(slides[0]?.layoutMetrics?.text.map((metric) => metric.role)).toEqual(["cover", "body"]);
    expect(slides[0]?.layoutMetrics?.text[0]).toMatchObject({ characterCount: longHook.length });
    expect(slides[0]?.layoutMetrics?.text[0]?.lineCount).toBeLessThanOrEqual(3);
    expect(slides.at(-1)?.layoutMetrics?.text.map((metric) => metric.role)).toEqual(["headline", "body"]);
    expect(slides.at(-1)?.layoutMetrics?.text.at(-1)).toMatchObject({ characterCount: cta.length });
  });

  it("renders Instagram-style @handles with underscores without changing approved copy length", async () => {
    const socialCta = "Follow @_dukeman390 for more practical KTM Duke notes.";
    const socialPlan: CarouselPlan = {
      ...plan,
      slides: [
        plan.slides[0]!,
        plan.slides[1]!,
        { ...plan.slides[2]!, body: "Keep this rider-focused checklist handy." },
      ],
      cta: socialCta,
    };
    const store: CreativeObjectStorePort = { putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })) };
    const produced = await new CreativeAssetProductionService(store, { carouselRenderer: new AdaptiveBitmapCarouselRenderer() }).produce(
      { workspaceId: "ws-1", brandId: "brand-1" },
      socialPlan,
    );

    const finalSlide = produced.assets.filter((asset) => asset.role === "carousel-slide").at(-1);
    expect(finalSlide?.layoutMetrics?.text.at(-1)).toMatchObject({ role: "cta", characterCount: socialCta.length });
    expect(store.putPrivateObject).toHaveBeenCalled();
  });

  it("preserves contract-valid body and CTA copy through rendering so quality policy can decide whether it is publishable", async () => {
    const maxBody = "evidence ".repeat(222).trim();
    const maxCta = "save ".repeat(100).trim();
    const contractSized: CarouselPlan = {
      ...plan,
      slides: [
        plan.slides[0]!,
        { ...plan.slides[1]!, body: maxBody },
        { ...plan.slides[2]!, body: "Review the evidence." },
      ],
      cta: maxCta,
    };
    const store: CreativeObjectStorePort = { putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })) };
    const produced = await new CreativeAssetProductionService(store, { carouselRenderer: new AdaptiveBitmapCarouselRenderer() }).produce(
      { workspaceId: "ws-1", brandId: "brand-1" },
      contractSized,
    );

    const slides = produced.assets.filter((asset) => asset.role === "carousel-slide");
    expect(maxBody.length).toBeLessThanOrEqual(2_000);
    expect(maxCta.length).toBeLessThanOrEqual(500);
    expect(slides[1]?.layoutMetrics?.text.at(-1)).toMatchObject({ role: "body", characterCount: maxBody.length });
    expect(slides[2]?.layoutMetrics?.text.at(-1)).toMatchObject({ role: "cta", characterCount: maxCta.length });
  });

  it("still fails closed when copy cannot fit even at the minimum deterministic scale", async () => {
    const store: CreativeObjectStorePort = { putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })) };
    await expect(
      new CreativeAssetProductionService(store, { carouselRenderer: new AdaptiveBitmapCarouselRenderer() }).produce(
        { workspaceId: "ws-1", brandId: "brand-1" },
        plan,
        { width: 64, height: 64 },
      ),
    ).rejects.toThrow(/does not fit/i);
    expect(store.putPrivateObject).not.toHaveBeenCalled();
  });
});
