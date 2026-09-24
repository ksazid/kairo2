import { createHash } from "node:crypto";
import type { VideoProject, VideoProjectScene } from "@kairo/domain/video-project";

export type SceneProductionStatus = "ready" | "needs-narration" | "failed";
export type SceneVisualContentType = "video/mp4" | "image/png";
export type NarrationContentType = "audio/mpeg" | "audio/wav";

export interface VideoGenerationCapabilities {
  minDurationSeconds: number;
  maxDurationSeconds: number;
  aspectRatios: readonly string[];
  maxReferenceAssets: number;
  nativeAudio?: boolean;
}

export interface VideoGenerationRequest {
  projectId: string;
  sceneId: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: "9:16";
  resolution: "1080x1920";
  referenceAssetIds: string[];
}

export interface GenerationCost {
  billable: boolean;
  amount?: number;
  currency?: string;
  pricingNote: string;
}

export interface VideoGenerationEstimate extends GenerationCost {
  providerId: string;
  model?: string;
  generatedSeconds: number;
}

export interface GeneratedVideoClip {
  contentType: "video/mp4";
  bytes: Uint8Array;
  providerId: string;
  model?: string;
  externalTaskId?: string;
  generatedAt: string;
  actualCost?: Omit<GenerationCost, "pricingNote"> & { pricingNote?: string };
}

export interface VideoGenerationProvider {
  readonly id: string;
  readonly model?: string;
  readonly capabilities: VideoGenerationCapabilities;
  isAvailable(): boolean;
  estimate(request: VideoGenerationRequest): Promise<VideoGenerationEstimate>;
  generate(request: VideoGenerationRequest): Promise<GeneratedVideoClip>;
  probe?(): Promise<{ status: "ready" | "unavailable"; message: string }>;
}

export interface NarrationEstimate extends GenerationCost {
  providerId: string;
  model?: string;
  characters: number;
}

export interface NarrationResult {
  contentType: NarrationContentType;
  bytes: Uint8Array;
  providerId: string;
  model?: string;
  externalTaskId?: string;
  generatedAt: string;
  actualCost?: Omit<GenerationCost, "pricingNote"> & { pricingNote?: string };
}

export interface NarrationProvider {
  readonly id: string;
  readonly model?: string;
  isAvailable(): boolean;
  estimate(text: string): Promise<NarrationEstimate>;
  synthesize(input: { text: string; sceneId: string; projectId: string }): Promise<NarrationResult>;
  probe?(): Promise<{ status: "ready" | "unavailable"; message: string }>;
}

export interface StoredSceneAsset {
  assetId: string;
  contentType: SceneVisualContentType | NarrationContentType;
  contentHash: string;
  sizeBytes: number;
}

export interface SceneProductionRevision {
  projectId: string;
  sourceVersionId: string;
  sceneId: string;
  revision: number;
  sceneFingerprint: string;
  status: SceneProductionStatus;
  visual: StoredSceneAsset & {
    providerId: string;
    model?: string;
    externalTaskId?: string;
    origin: "generated" | "uploaded";
    rightsConfirmed: boolean;
    rightsBasis: string;
  };
  narration:
    | (StoredSceneAsset & {
        status: "current";
        providerId: string;
        model?: string;
        externalTaskId?: string;
      })
    | { status: "intentional-silence"; reason: string }
    | { status: "unavailable"; reason: string };
  supportingClaimIds: string[];
  estimate: SceneProductionEstimate;
  actualCost: {
    video?: Omit<GenerationCost, "pricingNote"> & { pricingNote?: string };
    narration?: Omit<GenerationCost, "pricingNote"> & { pricingNote?: string };
  };
  createdAt: string;
}

export interface SceneProductionEstimate {
  providerId: string;
  providerModel?: string;
  narrationProviderId?: string;
  narrationModel?: string;
  generatedSeconds: number;
  video: VideoGenerationEstimate;
  narration?: NarrationEstimate;
  billable: boolean;
  estimatedAmount?: number;
  currency?: string;
}

export interface SceneProductionStorePort {
  latestRevision(input: { projectId: string; sceneId: string }): Promise<SceneProductionRevision | null>;
  putAsset(input: {
    projectId: string;
    sceneId: string;
    revision: number;
    role: "visual" | "narration";
    contentType: StoredSceneAsset["contentType"];
    bytes: Uint8Array;
    contentHash: string;
  }): Promise<{ assetId: string }>;
  saveRevision(revision: SceneProductionRevision): Promise<void>;
}

export class SceneProductionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export class VideoProviderRegistry {
  private readonly providers: Map<string, VideoGenerationProvider>;

  constructor(providers: readonly VideoGenerationProvider[]) {
    this.providers = new Map();
    for (const provider of providers) {
      if (!provider?.id?.trim()) throw new Error("Video provider id is required");
      if (this.providers.has(provider.id)) throw new Error(`Duplicate video provider id: ${provider.id}`);
      validateCapabilities(provider.capabilities);
      this.providers.set(provider.id, provider);
    }
  }

  list(): Array<{ id: string; model?: string; available: boolean; capabilities: VideoGenerationCapabilities }> {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      ...(provider.model ? { model: provider.model } : {}),
      available: provider.isAvailable(),
      capabilities: provider.capabilities,
    }));
  }

  select(request: VideoGenerationRequest, requestedId?: string): VideoGenerationProvider {
    if (requestedId) {
      const provider = this.providers.get(requestedId);
      if (!provider) throw new SceneProductionError(`Video provider ${requestedId} is not registered`, "video-provider-not-found");
      if (!provider.isAvailable()) throw new SceneProductionError(`Video provider ${requestedId} is unavailable`, "video-provider-unavailable");
      if (!supports(provider.capabilities, request)) throw new SceneProductionError(`Video provider ${requestedId} does not support this scene`, "video-provider-unsupported");
      return provider;
    }

    const provider = [...this.providers.values()].find((candidate) => candidate.isAvailable() && supports(candidate.capabilities, request));
    if (!provider) throw new SceneProductionError("No available video provider supports this scene", "video-provider-unavailable");
    return provider;
  }
}

export class SceneProductionService {
  constructor(
    private readonly providers: VideoProviderRegistry,
    private readonly narration: NarrationProvider,
    private readonly store: SceneProductionStorePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async estimate(
    project: VideoProject,
    sceneId: string,
    options: { providerId?: string; includeNarration?: boolean } = {},
  ): Promise<SceneProductionEstimate> {
    const scene = findScene(project, sceneId);
    const request = requestFor(project, scene);
    const provider = this.providers.select(request, options.providerId);
    const video = await provider.estimate(request);
    validateVideoEstimate(video, provider, request);

    let narration: NarrationEstimate | undefined;
    if (options.includeNarration !== false && scene.voiceover.trim()) {
      if (!this.narration.isAvailable()) throw new SceneProductionError("Narration provider is unavailable", "narration-provider-unavailable");
      narration = await this.narration.estimate(scene.voiceover);
      validateNarrationEstimate(narration, this.narration);
    }

    const costs = [video, narration].filter((value): value is VideoGenerationEstimate | NarrationEstimate => Boolean(value));
    const monetary = costs.filter((value) => typeof value.amount === "number");
    const currencies = new Set(monetary.map((value) => value.currency).filter((value): value is string => Boolean(value)));
    const estimatedAmount = monetary.length && currencies.size <= 1 ? monetary.reduce((sum, value) => sum + (value.amount ?? 0), 0) : undefined;
    const currency = currencies.size === 1 ? [...currencies][0] : undefined;

    return {
      providerId: provider.id,
      ...(provider.model ? { providerModel: provider.model } : {}),
      ...(narration ? { narrationProviderId: narration.providerId, ...(narration.model ? { narrationModel: narration.model } : {}) } : {}),
      generatedSeconds: request.durationSeconds,
      video,
      ...(narration ? { narration } : {}),
      billable: costs.some((value) => value.billable),
      ...(estimatedAmount !== undefined ? { estimatedAmount } : {}),
      ...(currency ? { currency } : {}),
    };
  }

  async regenerate(
    project: VideoProject,
    sceneId: string,
    options: {
      providerId?: string;
      confirmPaid?: boolean;
      intentionalSilence?: boolean;
      silenceReason?: string;
      includeNarration?: boolean;
    } = {},
  ): Promise<SceneProductionRevision> {
    const scene = findScene(project, sceneId);
    const estimate = await this.estimate(project, sceneId, {
      ...(options.providerId ? { providerId: options.providerId } : {}),
      includeNarration: options.intentionalSilence === true ? false : options.includeNarration,
    });
    if (estimate.billable && options.confirmPaid !== true) {
      throw new SceneProductionError("Paid scene generation requires explicit confirmation", "paid-generation-confirmation-required");
    }

    const request = requestFor(project, scene);
    const provider = this.providers.select(request, estimate.providerId);
    const previous = await this.store.latestRevision({ projectId: project.id, sceneId: scene.id });
    const revision = (previous?.revision ?? 0) + 1;

    let video: GeneratedVideoClip;
    try {
      video = await provider.generate(request);
    } catch (error) {
      throw new SceneProductionError(`Video generation failed: ${message(error)}`, "video-generation-failed");
    }
    validateGeneratedVideo(video, provider);

    const visualHash = sha256(video.bytes);
    const visualStored = await this.store.putAsset({
      projectId: project.id,
      sceneId: scene.id,
      revision,
      role: "visual",
      contentType: video.contentType,
      bytes: video.bytes,
      contentHash: visualHash,
    });

    let narration: SceneProductionRevision["narration"];
    let narrationCost: SceneProductionRevision["actualCost"]["narration"];
    if (options.intentionalSilence === true) {
      const reason = requiredSilenceReason(options.silenceReason);
      narration = { status: "intentional-silence", reason };
    } else if (options.includeNarration === false || !scene.voiceover.trim()) {
      narration = { status: "unavailable", reason: "Narration was not generated for this scene" };
    } else {
      if (!this.narration.isAvailable()) throw new SceneProductionError("Narration provider is unavailable", "narration-provider-unavailable");
      let result: NarrationResult;
      try {
        result = await this.narration.synthesize({ text: scene.voiceover, sceneId: scene.id, projectId: project.id });
      } catch (error) {
        throw new SceneProductionError(`Narration generation failed: ${message(error)}`, "narration-generation-failed");
      }
      validateNarrationResult(result, this.narration);
      const narrationHash = sha256(result.bytes);
      const narrationStored = await this.store.putAsset({
        projectId: project.id,
        sceneId: scene.id,
        revision,
        role: "narration",
        contentType: result.contentType,
        bytes: result.bytes,
        contentHash: narrationHash,
      });
      narration = {
        status: "current",
        assetId: narrationStored.assetId,
        contentType: result.contentType,
        contentHash: narrationHash,
        sizeBytes: result.bytes.byteLength,
        providerId: result.providerId,
        ...(result.model ? { model: result.model } : {}),
        ...(result.externalTaskId ? { externalTaskId: result.externalTaskId } : {}),
      };
      narrationCost = result.actualCost;
    }

    const createdAt = iso(this.clock());
    const result: SceneProductionRevision = {
      projectId: project.id,
      sourceVersionId: project.sourceVersionId,
      sceneId: scene.id,
      revision,
      sceneFingerprint: sceneFingerprint(project, scene),
      status: narration.status === "current" || narration.status === "intentional-silence" ? "ready" : "needs-narration",
      visual: {
        assetId: visualStored.assetId,
        contentType: video.contentType,
        contentHash: visualHash,
        sizeBytes: video.bytes.byteLength,
        providerId: video.providerId,
        ...(video.model ? { model: video.model } : {}),
        ...(video.externalTaskId ? { externalTaskId: video.externalTaskId } : {}),
        origin: "generated",
        rightsConfirmed: true,
        rightsBasis: "generated-by-configured-provider",
      },
      narration,
      supportingClaimIds: [...scene.supportingClaimIds],
      estimate,
      actualCost: {
        ...(video.actualCost ? { video: video.actualCost } : {}),
        ...(narrationCost ? { narration: narrationCost } : {}),
      },
      createdAt,
    };
    await this.store.saveRevision(result);
    return result;
  }

  async replaceVisualAsset(
    project: VideoProject,
    sceneId: string,
    input: {
      contentType: SceneVisualContentType;
      bytes: Uint8Array;
      rightsConfirmed: boolean;
      rightsBasis: string;
    },
  ): Promise<SceneProductionRevision> {
    const scene = findScene(project, sceneId);
    if (input.rightsConfirmed !== true) throw new SceneProductionError("Replacement media rights must be confirmed", "media-rights-confirmation-required");
    const rightsBasis = text(input.rightsBasis, "rightsBasis", 500);
    validateVisualBytes(input.contentType, input.bytes);

    const previous = await this.store.latestRevision({ projectId: project.id, sceneId: scene.id });
    const revision = (previous?.revision ?? 0) + 1;
    const contentHash = sha256(input.bytes);
    const stored = await this.store.putAsset({
      projectId: project.id,
      sceneId: scene.id,
      revision,
      role: "visual",
      contentType: input.contentType,
      bytes: input.bytes,
      contentHash,
    });
    const fingerprint = sceneFingerprint(project, scene);
    const narration = previous?.sceneFingerprint === fingerprint
      ? previous.narration
      : { status: "unavailable" as const, reason: "Scene content changed after the previous narration revision" };

    const result: SceneProductionRevision = {
      projectId: project.id,
      sourceVersionId: project.sourceVersionId,
      sceneId: scene.id,
      revision,
      sceneFingerprint: fingerprint,
      status: narration.status === "current" || narration.status === "intentional-silence" ? "ready" : "needs-narration",
      visual: {
        assetId: stored.assetId,
        contentType: input.contentType,
        contentHash,
        sizeBytes: input.bytes.byteLength,
        providerId: "operator-upload",
        origin: "uploaded",
        rightsConfirmed: true,
        rightsBasis,
      },
      narration,
      supportingClaimIds: [...scene.supportingClaimIds],
      estimate: zeroEstimate(scene),
      actualCost: {},
      createdAt: iso(this.clock()),
    };
    await this.store.saveRevision(result);
    return result;
  }

  assertReady(project: VideoProject, revisions: readonly SceneProductionRevision[]): void {
    const latest = new Map<string, SceneProductionRevision>();
    for (const revision of revisions) {
      if (revision.projectId !== project.id) continue;
      const current = latest.get(revision.sceneId);
      if (!current || revision.revision > current.revision) latest.set(revision.sceneId, revision);
    }
    for (const scene of project.scenes) {
      const revision = latest.get(scene.id);
      if (!revision) throw new SceneProductionError(`Scene ${scene.id} has no production revision`, "scene-production-missing");
      if (revision.sceneFingerprint !== sceneFingerprint(project, scene)) throw new SceneProductionError(`Scene ${scene.id} production is stale`, "scene-production-stale");
      if (revision.status !== "ready") throw new SceneProductionError(`Scene ${scene.id} is not production-ready`, "scene-production-not-ready");
      if (!revision.visual.rightsConfirmed) throw new SceneProductionError(`Scene ${scene.id} media rights are unresolved`, "media-rights-unresolved");
      if (!sameIds(revision.supportingClaimIds, scene.supportingClaimIds)) throw new SceneProductionError(`Scene ${scene.id} Claim lineage changed`, "scene-claim-lineage-mismatch");
    }
  }
}

function findScene(project: VideoProject, sceneId: string): VideoProjectScene {
  if (!project || project.format !== "reel") throw new SceneProductionError("A Reel Video Project is required", "video-project-invalid");
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new SceneProductionError(`Scene ${sceneId} was not found`, "scene-not-found");
  return scene;
}

function requestFor(project: VideoProject, scene: VideoProjectScene): VideoGenerationRequest {
  return {
    projectId: project.id,
    sceneId: scene.id,
    prompt: scene.visual,
    durationSeconds: scene.endSecond - scene.startSecond,
    aspectRatio: "9:16",
    resolution: "1080x1920",
    referenceAssetIds: [],
  };
}

function sceneFingerprint(project: VideoProject, scene: VideoProjectScene): string {
  return sha256(JSON.stringify({
    sourceVersionId: project.sourceVersionId,
    sourceVersion: project.sourceVersion,
    scene: {
      id: scene.id,
      startSecond: scene.startSecond,
      endSecond: scene.endSecond,
      visual: scene.visual,
      onScreenText: scene.onScreenText,
      voiceover: scene.voiceover,
      supportingClaimIds: scene.supportingClaimIds,
    },
  }));
}

function zeroEstimate(scene: VideoProjectScene): SceneProductionEstimate {
  const duration = scene.endSecond - scene.startSecond;
  const video: VideoGenerationEstimate = {
    providerId: "operator-upload",
    generatedSeconds: 0,
    billable: false,
    pricingNote: "Operator-supplied media; provider generation was not used",
  };
  return { providerId: "operator-upload", generatedSeconds: duration, video, billable: false };
}

function supports(capabilities: VideoGenerationCapabilities, request: VideoGenerationRequest): boolean {
  return request.durationSeconds >= capabilities.minDurationSeconds
    && request.durationSeconds <= capabilities.maxDurationSeconds
    && capabilities.aspectRatios.includes(request.aspectRatio)
    && request.referenceAssetIds.length <= capabilities.maxReferenceAssets;
}

function validateCapabilities(value: VideoGenerationCapabilities): void {
  if (!value || !Number.isFinite(value.minDurationSeconds) || !Number.isFinite(value.maxDurationSeconds) || value.minDurationSeconds <= 0 || value.maxDurationSeconds < value.minDurationSeconds) {
    throw new Error("Video provider duration capabilities are invalid");
  }
  if (!Array.isArray(value.aspectRatios) || !value.aspectRatios.length) throw new Error("Video provider aspect ratios are required");
  if (!Number.isInteger(value.maxReferenceAssets) || value.maxReferenceAssets < 0) throw new Error("Video provider reference asset limit is invalid");
}

function validateVideoEstimate(value: VideoGenerationEstimate, provider: VideoGenerationProvider, request: VideoGenerationRequest): void {
  if (!value || value.providerId !== provider.id || value.generatedSeconds !== request.durationSeconds || typeof value.billable !== "boolean" || !value.pricingNote?.trim()) {
    throw new SceneProductionError("Video provider returned an invalid estimate", "video-estimate-invalid");
  }
  validateMoney(value);
}

function validateNarrationEstimate(value: NarrationEstimate, provider: NarrationProvider): void {
  if (!value || value.providerId !== provider.id || !Number.isInteger(value.characters) || value.characters < 0 || typeof value.billable !== "boolean" || !value.pricingNote?.trim()) {
    throw new SceneProductionError("Narration provider returned an invalid estimate", "narration-estimate-invalid");
  }
  validateMoney(value);
}

function validateMoney(value: GenerationCost): void {
  if (value.amount !== undefined && (!Number.isFinite(value.amount) || value.amount < 0)) throw new SceneProductionError("Provider estimate amount is invalid", "provider-cost-invalid");
  if (value.amount !== undefined && !value.currency?.trim()) throw new SceneProductionError("Provider estimate currency is required with an amount", "provider-cost-invalid");
}

function validateGeneratedVideo(value: GeneratedVideoClip, provider: VideoGenerationProvider): void {
  if (!value || value.providerId !== provider.id || value.contentType !== "video/mp4") throw new SceneProductionError("Video provider returned an invalid result", "video-result-invalid");
  validateVisualBytes(value.contentType, value.bytes);
}

function validateNarrationResult(value: NarrationResult, provider: NarrationProvider): void {
  if (!value || value.providerId !== provider.id || !["audio/mpeg", "audio/wav"].includes(value.contentType)) throw new SceneProductionError("Narration provider returned an invalid result", "narration-result-invalid");
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0) throw new SceneProductionError("Narration provider returned empty audio", "narration-result-invalid");
}

function validateVisualBytes(contentType: SceneVisualContentType, bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) throw new SceneProductionError("Scene visual asset is empty or invalid", "scene-asset-invalid");
  if (contentType === "video/mp4") {
    if (bytes.byteLength < 12 || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) {
      throw new SceneProductionError("Scene video is missing the MP4 ftyp signature", "scene-asset-invalid");
    }
    return;
  }
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!png.every((value, index) => bytes[index] === value)) throw new SceneProductionError("Scene image is not a PNG", "scene-asset-invalid");
}

function requiredSilenceReason(value: unknown): string {
  const reason = text(value, "silenceReason", 500);
  if (reason.length < 10) throw new SceneProductionError("Intentional silence requires a reason of at least 10 characters", "silence-reason-required");
  return reason;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new SceneProductionError(`${field} is required`, "scene-production-input-invalid");
  const normalized = value.trim();
  if (normalized.length > max) throw new SceneProductionError(`${field} is too long`, "scene-production-input-invalid");
  return normalized;
}

function iso(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("Scene production clock returned an invalid date");
  return value.toISOString();
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
