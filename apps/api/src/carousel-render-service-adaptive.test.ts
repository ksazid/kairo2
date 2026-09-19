import { describe, expect, it, vi } from "vitest";
import type { CreativeObjectStorePort } from "@kairo/worker/creative-renderer";
import type { PgCarouselStudioStore } from "./carousel-studio-postgres";
import { CarouselRenderService } from "./carousel-render-service";

const longHook = "A practical guide to choosing a content strategy that fits your audience and goals";
const cta = "Save this guide and use it for your next planning session.";
const project = {
  schemaVersion: 1 as const,
  format: "carousel" as const,
  structure: "listicle" as const,
  coverHook: longHook,
  slides: [
    { id: "hook", role: "hook" as const, headline: longHook, body: "For teams that need a clear decision without extra noise.", supportingClaimIds: ["claim-1"] },
    { id: "insight", role: "list-item" as const, headline: "What the evidence says", body: "Start with the audience need, then compare the format against the outcome you want to create.", supportingClaimIds: ["claim-1"] },
    { id: "cta", role: "cta" as const, headline: "Your next step", body: cta, supportingClaimIds: ["claim-1"] },
  ],
  caption: "An evidence-linked guide.",
  cta,
  supportingClaimIds: ["claim-1"],
};

describe("production carousel adaptive layout", () => {
  it("renders bootstrap-equivalent copy into a ready quality-checked version", async () => {
    const objects: CreativeObjectStorePort = {
      putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })),
    };
    const projects = {
      getRenderSource: vi.fn().mockResolvedValue({
        workspaceId: "ws-1",
        brandId: "brand-1",
        projectId: "project-1",
        revision: 1,
        version: 1,
        style: {},
        project,
      }),
      saveRenderedVersion: vi.fn(async (_account, _brand, _project, input) => input),
    } as unknown as PgCarouselStudioStore;

    const result: any = await new CarouselRenderService(projects, objects, "s3-private").render("account-1", "brand-1", "project-1", 1);

    expect(result).toMatchObject({
      projectRevision: 1,
      storageProvider: "s3-private",
      status: "ready",
      qualityReport: { blockingErrorCount: 0 },
    });
    expect(result.slides).toHaveLength(3);
    expect((objects.putPrivateObject as any).mock.calls).toHaveLength(5);
    expect(projects.saveRenderedVersion).toHaveBeenCalledOnce();
  });

  it("lets contract-valid oversized copy reach quality rejection instead of failing in text layout", async () => {
    const maxBody = "evidence ".repeat(222).trim();
    const maxCta = "save ".repeat(100).trim();
    const oversizedProject = {
      ...project,
      slides: [
        project.slides[0]!,
        { ...project.slides[1]!, body: maxBody },
        { ...project.slides[2]!, body: "Review the evidence." },
      ],
      cta: maxCta,
    };
    const objects: CreativeObjectStorePort = {
      putPrivateObject: vi.fn(async (input) => ({ objectId: input.objectKey })),
    };
    const projects = {
      getRenderSource: vi.fn().mockResolvedValue({
        workspaceId: "ws-1",
        brandId: "brand-1",
        projectId: "project-1",
        revision: 1,
        version: 1,
        style: {},
        project: oversizedProject,
      }),
      saveRenderedVersion: vi.fn(),
    } as unknown as PgCarouselStudioStore;

    expect(maxBody.length).toBeLessThanOrEqual(2_000);
    expect(maxCta.length).toBeLessThanOrEqual(500);
    await expect(
      new CarouselRenderService(projects, objects, "s3-private").render("account-1", "brand-1", "project-1", 1),
    ).rejects.toThrow(/blocking quality finding/i);
    expect(objects.putPrivateObject).not.toHaveBeenCalled();
    expect(projects.saveRenderedVersion).not.toHaveBeenCalled();
  });
});
