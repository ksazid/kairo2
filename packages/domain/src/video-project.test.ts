import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import {
  assertVideoProjectScope,
  compileVideoProject,
  createVideoProject,
  moveVideoProjectScene,
  parseVideoProject,
  retimeVideoProjectScene,
  reviewableVideoProjectContent,
  serializeVideoProject,
  updateVideoProjectScene,
  videoProjectReviewText,
} from "./video-project";
import type { ReelPlan } from "./creative-formats";

const reel: ReelPlan = {
  format: "reel",
  hook: "Your content workflow is becoming a system.",
  targetDurationSeconds: 24,
  scenes: [
    {
      startSecond: 0,
      endSecond: 4,
      visual: "Direct-to-camera hook",
      onScreenText: "Content → system",
      voiceover: "The workflow is changing.",
      supportingClaimIds: ["claim-1"],
    },
    {
      startSecond: 4,
      endSecond: 14,
      visual: "Workflow diagram",
      onScreenText: "Research + creation",
      voiceover: "Evidence and production now stay connected.",
      supportingClaimIds: ["claim-2"],
    },
    {
      startSecond: 14,
      endSecond: 24,
      visual: "Closing frame",
      onScreenText: "Keep the lineage",
      voiceover: "The useful part is preserving what supports the content.",
      supportingClaimIds: ["claim-3"],
    },
  ],
  caption: "A concise workflow shift to watch.",
  cta: "Save this for your next content review.",
  supportingClaimIds: ["claim-1", "claim-2", "claim-3"],
};

const project = () => createVideoProject({
  id: "video-project-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  campaignId: "campaign-1",
  assetId: "asset-1",
  sourceVersionId: "version-7",
  sourceVersion: 7,
  plan: reel,
});

const expectedScope = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  campaignId: "campaign-1",
  assetId: "asset-1",
};

describe("VS-54 Video Project", () => {
  it("creates a scoped editable project that compiles back to the source ReelPlan", () => {
    const value = project();

    expect(value.workspaceId).toBe("workspace-1");
    expect(value.brandId).toBe("brand-1");
    expect(value.sourceVersionId).toBe("version-7");
    expect(value.scenes.map((scene) => scene.id)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(compileVideoProject(value)).toEqual(reel);
  });

  it("updates visible scene copy without changing scope, timing or Claim lineage", () => {
    const before = project();
    const after = updateVideoProjectScene(before, "scene-02", {
      visual: "Animated workflow map",
      onScreenText: "Research → create",
      voiceover: "Research and creation now stay connected in one traceable workflow.",
    });

    expect(after.workspaceId).toBe(before.workspaceId);
    expect(after.brandId).toBe(before.brandId);
    expect(after.scenes[1]).toMatchObject({
      id: "scene-02",
      startSecond: 4,
      endSecond: 14,
      visual: "Animated workflow map",
      supportingClaimIds: ["claim-2"],
    });
  });

  it("rejects a scene edit that introduces a Claim outside the project lineage", () => {
    expect(() => updateVideoProjectScene(project(), "scene-02", {
      supportingClaimIds: ["claim-missing"],
    })).toThrow(DomainValidationError);
  });

  it("reorders scenes while retaining scene identity and duration and rebuilding a contiguous timeline", () => {
    const moved = moveVideoProjectScene(project(), "scene-03", 0);

    expect(moved.scenes.map((scene) => scene.id)).toEqual(["scene-03", "scene-01", "scene-02"]);
    expect(moved.scenes.map((scene) => [scene.startSecond, scene.endSecond])).toEqual([
      [0, 10],
      [10, 14],
      [14, 24],
    ]);
    expect(moved.targetDurationSeconds).toBe(24);
    expect(compileVideoProject(moved).scenes[0]?.voiceover).toContain("preserving what supports");
  });

  it("retimes one scene and deterministically shifts later scene boundaries", () => {
    const retimed = retimeVideoProjectScene(project(), "scene-02", 6);

    expect(retimed.scenes.map((scene) => [scene.startSecond, scene.endSecond])).toEqual([
      [0, 4],
      [4, 10],
      [10, 20],
    ]);
    expect(retimed.targetDurationSeconds).toBe(20);
    expect(compileVideoProject(retimed).targetDurationSeconds).toBe(20);
  });

  it("round-trips canonical project serialization without changing the compiled ReelPlan", () => {
    const value = project();
    const serialized = serializeVideoProject(value);
    const parsed = parseVideoProject(serialized);

    expect(serializeVideoProject(parsed)).toBe(serialized);
    expect(compileVideoProject(parsed)).toEqual(reel);
  });

  it("fails closed on malformed project metadata and duplicate scene identities", () => {
    const value = project();
    const malformed = JSON.stringify({ ...value, sourceVersion: 0 });
    expect(() => parseVideoProject(malformed)).toThrow(DomainValidationError);

    const duplicateScenes = JSON.stringify({
      ...value,
      scenes: value.scenes.map((scene) => ({ ...scene, id: "scene-01" })),
    });
    expect(() => parseVideoProject(duplicateScenes)).toThrow(DomainValidationError);
  });

  it("fails closed when a structurally valid project claims a different Brand or Asset scope", () => {
    expect(assertVideoProjectScope(project(), expectedScope).assetId).toBe("asset-1");
    expect(() => assertVideoProjectScope(project(), { ...expectedScope, brandId: "brand-2" })).toThrow(DomainValidationError);
    expect(() => reviewableVideoProjectContent(serializeVideoProject(project()), { ...expectedScope, assetId: "asset-2" })).toThrow(DomainValidationError);
  });

  it("produces a readable review representation without exposing project metadata as creative copy", () => {
    const reviewText = videoProjectReviewText(project());

    expect(reviewText).toContain("Hook: Your content workflow is becoming a system.");
    expect(reviewText).toContain("Scene 2 (4-14 sec)");
    expect(reviewText).toContain("Voiceover: Evidence and production now stay connected.");
    expect(reviewText).toContain("Caption: A concise workflow shift to watch.");
    expect(reviewText).not.toContain("workspace-1");
    expect(reviewText).not.toContain("sourceVersionId");
  });

  it("converts only valid Video Project JSON to review copy and leaves normal content unchanged", () => {
    const serialized = serializeVideoProject(project());
    expect(reviewableVideoProjectContent(serialized, expectedScope)).toBe(videoProjectReviewText(project()));
    expect(reviewableVideoProjectContent("A normal text post stays unchanged.", expectedScope)).toBe("A normal text post stays unchanged.");
  });
});
