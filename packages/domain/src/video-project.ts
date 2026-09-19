import { DomainValidationError } from "./index";
import { validateReelPlan, type ReelPlan } from "./creative-formats";

export const VIDEO_PROJECT_SCHEMA_VERSION = 1 as const;

export interface VideoProjectScene {
  id: string;
  startSecond: number;
  endSecond: number;
  visual: string;
  onScreenText: string;
  voiceover: string;
  supportingClaimIds: string[];
}

export interface VideoProject {
  schemaVersion: typeof VIDEO_PROJECT_SCHEMA_VERSION;
  format: "reel";
  id: string;
  workspaceId: string;
  brandId: string;
  campaignId: string;
  assetId: string;
  sourceVersionId: string;
  sourceVersion: number;
  hook: string;
  targetDurationSeconds: number;
  scenes: VideoProjectScene[];
  caption: string;
  cta: string;
  supportingClaimIds: string[];
}

export interface VideoProjectScope {
  workspaceId: string;
  brandId: string;
  campaignId: string;
  assetId: string;
}

export interface CreateVideoProjectInput extends VideoProjectScope {
  id: string;
  sourceVersionId: string;
  sourceVersion: number;
  plan: ReelPlan;
}

export type VideoProjectScenePatch = Partial<Pick<VideoProjectScene, "visual" | "onScreenText" | "voiceover" | "supportingClaimIds">>;

export function createVideoProject(input: CreateVideoProjectInput): VideoProject {
  const plan = validateReelPlan(input.plan);
  return validateVideoProject({
    schemaVersion: VIDEO_PROJECT_SCHEMA_VERSION,
    format: "reel",
    id: scopedText(input.id, "videoProject.id"),
    workspaceId: scopedText(input.workspaceId, "videoProject.workspaceId"),
    brandId: scopedText(input.brandId, "videoProject.brandId"),
    campaignId: scopedText(input.campaignId, "videoProject.campaignId"),
    assetId: scopedText(input.assetId, "videoProject.assetId"),
    sourceVersionId: scopedText(input.sourceVersionId, "videoProject.sourceVersionId"),
    sourceVersion: positiveVersion(input.sourceVersion, "videoProject.sourceVersion"),
    hook: plan.hook,
    targetDurationSeconds: plan.targetDurationSeconds,
    scenes: plan.scenes.map((scene, index) => ({
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      ...scene,
      supportingClaimIds: [...scene.supportingClaimIds],
    })),
    caption: plan.caption,
    cta: plan.cta,
    supportingClaimIds: [...plan.supportingClaimIds],
  });
}

export function validateVideoProject(input: VideoProject): VideoProject {
  if (!input || typeof input !== "object") throw new DomainValidationError("Video Project is required");
  if (input.schemaVersion !== VIDEO_PROJECT_SCHEMA_VERSION) throw new DomainValidationError("Video Project schema version is not supported");
  if (input.format !== "reel") throw new DomainValidationError("Video Project format must be reel");
  if (!Array.isArray(input.scenes)) throw new DomainValidationError("Video Project scenes must be a list");

  const ids = input.scenes.map((scene, index) => scopedText(scene?.id, `videoProject.scenes[${index}].id`));
  if (new Set(ids).size !== ids.length) throw new DomainValidationError("Video Project scene IDs must be unique");

  const validatedPlan = validateReelPlan({
    format: "reel",
    hook: input.hook,
    targetDurationSeconds: input.targetDurationSeconds,
    scenes: input.scenes.map((scene) => ({
      startSecond: scene.startSecond,
      endSecond: scene.endSecond,
      visual: scene.visual,
      onScreenText: scene.onScreenText,
      voiceover: scene.voiceover,
      supportingClaimIds: scene.supportingClaimIds,
    })),
    caption: input.caption,
    cta: input.cta,
    supportingClaimIds: input.supportingClaimIds,
  });

  return {
    schemaVersion: VIDEO_PROJECT_SCHEMA_VERSION,
    format: "reel",
    id: scopedText(input.id, "videoProject.id"),
    workspaceId: scopedText(input.workspaceId, "videoProject.workspaceId"),
    brandId: scopedText(input.brandId, "videoProject.brandId"),
    campaignId: scopedText(input.campaignId, "videoProject.campaignId"),
    assetId: scopedText(input.assetId, "videoProject.assetId"),
    sourceVersionId: scopedText(input.sourceVersionId, "videoProject.sourceVersionId"),
    sourceVersion: positiveVersion(input.sourceVersion, "videoProject.sourceVersion"),
    hook: validatedPlan.hook,
    targetDurationSeconds: validatedPlan.targetDurationSeconds,
    scenes: validatedPlan.scenes.map((scene, index) => ({
      id: ids[index]!,
      ...scene,
      supportingClaimIds: [...scene.supportingClaimIds],
    })),
    caption: validatedPlan.caption,
    cta: validatedPlan.cta,
    supportingClaimIds: [...validatedPlan.supportingClaimIds],
  };
}

export function assertVideoProjectScope(project: VideoProject, expected: VideoProjectScope): VideoProject {
  const value = validateVideoProject(project);
  const scope: VideoProjectScope = {
    workspaceId: scopedText(expected.workspaceId, "expectedScope.workspaceId"),
    brandId: scopedText(expected.brandId, "expectedScope.brandId"),
    campaignId: scopedText(expected.campaignId, "expectedScope.campaignId"),
    assetId: scopedText(expected.assetId, "expectedScope.assetId"),
  };
  if (
    value.workspaceId !== scope.workspaceId ||
    value.brandId !== scope.brandId ||
    value.campaignId !== scope.campaignId ||
    value.assetId !== scope.assetId
  ) throw new DomainValidationError("Video Project is outside the expected scope");
  return value;
}

export function compileVideoProject(project: VideoProject): ReelPlan {
  const value = validateVideoProject(project);
  return validateReelPlan({
    format: "reel",
    hook: value.hook,
    targetDurationSeconds: value.targetDurationSeconds,
    scenes: value.scenes.map(({ id: _id, ...scene }) => ({
      ...scene,
      supportingClaimIds: [...scene.supportingClaimIds],
    })),
    caption: value.caption,
    cta: value.cta,
    supportingClaimIds: [...value.supportingClaimIds],
  });
}

export function updateVideoProjectScene(project: VideoProject, sceneId: string, patch: VideoProjectScenePatch): VideoProject {
  const value = validateVideoProject(project);
  const id = scopedText(sceneId, "sceneId");
  const index = value.scenes.findIndex((scene) => scene.id === id);
  if (index < 0) throw new DomainValidationError("Video Project scene was not found");

  const scenes = value.scenes.map((scene, sceneIndex) => sceneIndex === index
    ? {
        ...scene,
        ...(patch.visual !== undefined ? { visual: patch.visual } : {}),
        ...(patch.onScreenText !== undefined ? { onScreenText: patch.onScreenText } : {}),
        ...(patch.voiceover !== undefined ? { voiceover: patch.voiceover } : {}),
        ...(patch.supportingClaimIds !== undefined ? { supportingClaimIds: [...patch.supportingClaimIds] } : {}),
      }
    : { ...scene, supportingClaimIds: [...scene.supportingClaimIds] });

  return validateVideoProject({ ...value, scenes });
}

export function moveVideoProjectScene(project: VideoProject, sceneId: string, toIndex: number): VideoProject {
  const value = validateVideoProject(project);
  const id = scopedText(sceneId, "sceneId");
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= value.scenes.length) throw new DomainValidationError("Video Project scene destination is out of range");
  const fromIndex = value.scenes.findIndex((scene) => scene.id === id);
  if (fromIndex < 0) throw new DomainValidationError("Video Project scene was not found");
  if (fromIndex === toIndex) return value;

  const ordered = value.scenes.map((scene) => ({ ...scene, supportingClaimIds: [...scene.supportingClaimIds] }));
  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved!);
  return validateVideoProject({ ...value, ...reflowScenes(ordered) });
}

export function retimeVideoProjectScene(project: VideoProject, sceneId: string, durationSeconds: number): VideoProject {
  const value = validateVideoProject(project);
  const id = scopedText(sceneId, "sceneId");
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new DomainValidationError("Video Project scene duration must be a positive finite number");
  }
  const index = value.scenes.findIndex((scene) => scene.id === id);
  if (index < 0) throw new DomainValidationError("Video Project scene was not found");

  const scenes = value.scenes.map((scene, sceneIndex) => ({
    ...scene,
    endSecond: sceneIndex === index ? scene.startSecond + durationSeconds : scene.endSecond,
    supportingClaimIds: [...scene.supportingClaimIds],
  }));
  const durations = scenes.map((scene, sceneIndex) => sceneIndex === index ? durationSeconds : durationOf(value.scenes[sceneIndex]!));
  return validateVideoProject({ ...value, ...reflowScenesWithDurations(scenes, durations) });
}

export function serializeVideoProject(project: VideoProject): string {
  return JSON.stringify(validateVideoProject(project));
}

export function parseVideoProject(content: string): VideoProject {
  if (typeof content !== "string" || !content.trim()) throw new DomainValidationError("Video Project content is required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DomainValidationError("Video Project content is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new DomainValidationError("Video Project content must be an object");
  return validateVideoProject(parsed as VideoProject);
}

export function videoProjectReviewText(project: VideoProject): string {
  const value = validateVideoProject(project);
  const sceneText = value.scenes.map((scene, index) => [
    `Scene ${index + 1} (${scene.startSecond}-${scene.endSecond} sec)`,
    `Visual: ${scene.visual}`,
    `On-screen text: ${scene.onScreenText}`,
    `Voiceover: ${scene.voiceover}`,
  ].join("\n")).join("\n\n");
  return [
    `Hook: ${value.hook}`,
    sceneText,
    `Caption: ${value.caption}`,
    `CTA: ${value.cta}`,
  ].join("\n\n");
}

export function reviewableVideoProjectContent(content: string, expectedScope?: VideoProjectScope): string {
  let project: VideoProject;
  try {
    project = parseVideoProject(content);
  } catch {
    return content;
  }
  const scoped = expectedScope ? assertVideoProjectScope(project, expectedScope) : project;
  return videoProjectReviewText(scoped);
}

function reflowScenes(scenes: VideoProjectScene[]): Pick<VideoProject, "scenes" | "targetDurationSeconds"> {
  return reflowScenesWithDurations(scenes, scenes.map(durationOf));
}

function reflowScenesWithDurations(scenes: VideoProjectScene[], durations: number[]): Pick<VideoProject, "scenes" | "targetDurationSeconds"> {
  let cursor = 0;
  const reflowed = scenes.map((scene, index) => {
    const duration = durations[index]!;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) throw new DomainValidationError("Video Project scene duration must be positive");
    const startSecond = cursor;
    const endSecond = startSecond + duration;
    cursor = endSecond;
    return { ...scene, startSecond, endSecond, supportingClaimIds: [...scene.supportingClaimIds] };
  });
  return { scenes: reflowed, targetDurationSeconds: cursor };
}

function durationOf(scene: Pick<VideoProjectScene, "startSecond" | "endSecond">): number {
  return scene.endSecond - scene.startSecond;
}

function scopedText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > 200) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function positiveVersion(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new DomainValidationError(`${field} must be a positive integer`);
  return value as number;
}
