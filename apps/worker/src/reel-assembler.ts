import { createHash } from "node:crypto";
import { NodeFfmpegExecutionPort, type FfmpegExecutionFile, type FfmpegExecutionPort } from "./reel-encoder";
import type { NarrationContentType, SceneVisualContentType } from "./reel-production-v2";

export interface ReelAssemblyVisual {
  contentType: SceneVisualContentType;
  bytes: Uint8Array;
  contentHash?: string;
}

export type ReelAssemblyNarration =
  | { status: "current"; contentType: NarrationContentType; bytes: Uint8Array; contentHash?: string }
  | { status: "intentional-silence"; reason: string };

export interface ReelAssemblyScene {
  id: string;
  durationSeconds: number;
  visual: ReelAssemblyVisual;
  narration: ReelAssemblyNarration;
}

export interface ReelAssemblyResult {
  contentType: "video/mp4";
  bytes: Uint8Array;
  sceneCount: number;
  durationSeconds: number;
  assemblyFingerprint: string;
  assemblerVersion: string;
}

interface ReelAssemblerOptions {
  width?: number;
  height?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export class FfmpegReelAssembler {
  readonly version = "ffmpeg-reel-v2";
  private readonly width: number;
  private readonly height: number;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(
    private readonly executable: string,
    private readonly execution: FfmpegExecutionPort = new NodeFfmpegExecutionPort(),
    options: ReelAssemblerOptions = {},
  ) {
    if (typeof executable !== "string" || !executable.trim() || executable.includes("\0") || executable.length > 500) throw new Error("FFmpeg executable is invalid");
    this.width = boundedInt(options.width ?? 1080, "width", 64, 2160);
    this.height = boundedInt(options.height ?? 1920, "height", 64, 3840);
    this.timeoutMs = boundedInt(options.timeoutMs ?? 120_000, "timeoutMs", 1, 300_000);
    this.maxOutputBytes = boundedInt(options.maxOutputBytes ?? 200 * 1024 * 1024, "maxOutputBytes", 1, 512 * 1024 * 1024);
  }

  async assemble(input: { projectId: string; scenes: readonly ReelAssemblyScene[] }): Promise<ReelAssemblyResult> {
    const projectId = required(input?.projectId, "projectId", 200);
    if (!Array.isArray(input?.scenes) || input.scenes.length < 1 || input.scenes.length > 40) throw new Error("Reel assembly requires 1 to 40 scenes");

    let durationSeconds = 0;
    const normalized: Array<{ name: string; bytes: Uint8Array }> = [];
    const fingerprintInput: Array<Record<string, unknown>> = [];

    for (let index = 0; index < input.scenes.length; index += 1) {
      const scene = input.scenes[index]!;
      const duration = finiteDuration(scene.durationSeconds);
      durationSeconds += duration;
      if (durationSeconds > 300) throw new Error("Reel assembly duration exceeds 300 seconds");

      const visualHash = validatedVisual(scene.visual);
      const narrationHash = validatedNarration(scene.narration);
      const name = `scene-${String(index).padStart(3, "0")}.mp4`;
      const bytes = await this.normalizeScene(scene, index, duration, name);
      normalized.push({ name, bytes });
      fingerprintInput.push({ id: required(scene.id, "scene.id", 200), duration, visualHash, narrationHash });
    }

    const concat = normalized.flatMap((scene) => [`file '${scene.name}'`]).join("\n") + "\n";
    const files: FfmpegExecutionFile[] = [
      ...normalized.map((scene) => ({ name: scene.name, bytes: scene.bytes })),
      { name: "scenes.txt", bytes: new TextEncoder().encode(concat) },
    ];
    const result = await this.execution.run({
      executable: this.executable,
      args: [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", "scenes.txt",
        "-c", "copy", "-movflags", "+faststart", "-map_metadata", "-1", "output.mp4",
      ],
      files,
      outputFilename: "output.mp4",
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      shell: false,
    });
    if (result.exitCode !== 0) throw new Error(`FFmpeg Reel assembly failed${result.stderr ? `: ${safeMessage(result.stderr)}` : ""}`);
    validateMp4(result.outputBytes, this.maxOutputBytes);

    return {
      contentType: "video/mp4",
      bytes: result.outputBytes,
      sceneCount: normalized.length,
      durationSeconds,
      assemblyFingerprint: sha256(JSON.stringify({ version: this.version, projectId, width: this.width, height: this.height, scenes: fingerprintInput })),
      assemblerVersion: this.version,
    };
  }

  private async normalizeScene(scene: ReelAssemblyScene, index: number, duration: number, outputFilename: string): Promise<Uint8Array> {
    const visualExtension = scene.visual.contentType === "video/mp4" ? "mp4" : "png";
    const visualName = `visual-${String(index).padStart(3, "0")}.${visualExtension}`;
    const files: FfmpegExecutionFile[] = [{ name: visualName, bytes: scene.visual.bytes }];
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];

    if (scene.visual.contentType === "image/png") args.push("-loop", "1", "-framerate", "30", "-i", visualName);
    else args.push("-i", visualName);

    if (scene.narration.status === "current") {
      const extension = scene.narration.contentType === "audio/mpeg" ? "mp3" : "wav";
      const audioName = `audio-${String(index).padStart(3, "0")}.${extension}`;
      files.push({ name: audioName, bytes: scene.narration.bytes });
      args.push("-i", audioName);
    } else {
      requiredSilence(scene.narration.reason);
      args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    }

    args.push(
      "-map", "0:v:0", "-map", "1:a:0",
      "-t", formatDuration(duration),
      "-vf", `scale=${this.width}:${this.height}:force_original_aspect_ratio=decrease,pad=${this.width}:${this.height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
      "-shortest", "-movflags", "+faststart", "-map_metadata", "-1", outputFilename,
    );

    const result = await this.execution.run({
      executable: this.executable,
      args,
      files,
      outputFilename,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      shell: false,
    });
    if (result.exitCode !== 0) throw new Error(`FFmpeg scene normalization failed for ${scene.id}${result.stderr ? `: ${safeMessage(result.stderr)}` : ""}`);
    validateMp4(result.outputBytes, this.maxOutputBytes);
    return result.outputBytes;
  }
}

function validatedVisual(visual: ReelAssemblyVisual): string {
  if (!visual || !(visual.bytes instanceof Uint8Array)) throw new Error("Reel scene visual is required");
  if (visual.contentType === "video/mp4") validateMp4(visual.bytes, 512 * 1024 * 1024);
  else if (visual.contentType === "image/png") validatePng(visual.bytes);
  else throw new Error("Reel scene visual type is unsupported");
  const hash = sha256(visual.bytes);
  if (visual.contentHash && visual.contentHash !== hash) throw new Error("Reel scene visual hash does not match bytes");
  return hash;
}

function validatedNarration(narration: ReelAssemblyNarration): string {
  if (!narration) throw new Error("Reel scene narration state is required");
  if (narration.status === "intentional-silence") return sha256(requiredSilence(narration.reason));
  if (!["audio/mpeg", "audio/wav"].includes(narration.contentType) || !(narration.bytes instanceof Uint8Array) || narration.bytes.byteLength === 0) {
    throw new Error("Reel scene narration is invalid");
  }
  const hash = sha256(narration.bytes);
  if (narration.contentHash && narration.contentHash !== hash) throw new Error("Reel scene narration hash does not match bytes");
  return hash;
}

function validateMp4(bytes: Uint8Array, max: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12 || bytes.byteLength > max) throw new Error("Reel MP4 is invalid");
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) throw new Error("Reel MP4 is missing ftyp signature");
}

function validatePng(bytes: Uint8Array): void {
  const signature = [137,80,78,71,13,10,26,10];
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < signature.length || !signature.every((value, index) => bytes[index] === value)) throw new Error("Reel scene PNG is invalid");
}

function requiredSilence(value: string): string {
  const reason = required(value, "intentional silence reason", 500);
  if (reason.length < 10) throw new Error("Intentional silence reason must be at least 10 characters");
  return reason;
}

function finiteDuration(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 300) throw new Error("Reel scene duration is invalid");
  return value;
}

function formatDuration(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function boundedInt(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} is invalid`);
  return value;
}

function required(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${field} is required`);
  return value.trim();
}

function safeMessage(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
