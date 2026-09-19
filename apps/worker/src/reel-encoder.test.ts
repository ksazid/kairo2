import { describe, expect, it, vi } from "vitest";
import {
  FfmpegReelEncoder,
  type FfmpegExecutionPort,
  type FfmpegExecutionRequest,
} from "./reel-encoder";

const png = new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const mp4 = new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,2,0,105,115,111,109,105,115,111,50]);

describe("FfmpegReelEncoder", () => {
  it("builds a confined direct-process request from Kairo-owned frame files and timings", async () => {
    let captured:FfmpegExecutionRequest|undefined;
    const run = vi.fn(async (request:FfmpegExecutionRequest) => { captured=request; return { exitCode:0, stderr:"", outputBytes:mp4 }; });
    const execution: FfmpegExecutionPort = { run };
    const encoder = new FfmpegReelEncoder("/usr/bin/ffmpeg", execution, { timeoutMs:5_000, maxOutputBytes:1_000_000 });
    const result = await encoder.encode({
      sourceFingerprint:"b".repeat(64),
      frames:[
        { bytes:png, durationSeconds:2 },
        { bytes:png, durationSeconds:3 },
      ],
    });
    expect(result.contentType).toBe("video/mp4");
    expect(result.bytes).toEqual(mp4);
    expect(encoder.version).toMatch(/^ffmpeg-h264-/);
    expect(run).toHaveBeenCalledTimes(1);
    const request = captured!;
    expect(request.executable).toBe("/usr/bin/ffmpeg");
    expect(request.shell).toBe(false);
    expect(request.outputFilename).toBe("output.mp4");
    expect(request.timeoutMs).toBe(5_000);
    expect(request.maxOutputBytes).toBe(1_000_000);
    expect(request.args).toContain("libx264");
    expect(request.args).toContain("yuv420p");
    expect(request.args).toContain("+faststart");
    expect(request.args).not.toContain("https://example.com/untrusted");
    expect(request.files.map((file) => file.name)).toEqual(["frame-000.png","frame-001.png","frames.txt"]);
    const concat = new TextDecoder().decode(request.files.find((file) => file.name==="frames.txt")!.bytes);
    expect(concat).toContain("duration 2");
    expect(concat).toContain("duration 3");
    expect(concat).toContain("file 'frame-000.png'");
    expect(concat).toContain("file 'frame-001.png'");
  });

  it("rejects invalid frame durations before invoking the process boundary", async () => {
    const execution: FfmpegExecutionPort = { run:vi.fn(async () => ({ exitCode:0, stderr:"", outputBytes:mp4 })) };
    const encoder = new FfmpegReelEncoder("ffmpeg", execution);
    await expect(encoder.encode({ sourceFingerprint:"b".repeat(64), frames:[{bytes:png,durationSeconds:0}] })).rejects.toThrow(/duration/i);
    expect(execution.run).not.toHaveBeenCalled();
  });

  it("propagates bounded encoder failure without fabricating output", async () => {
    const execution: FfmpegExecutionPort = { run:vi.fn(async () => ({ exitCode:1, stderr:"encoder failed", outputBytes:new Uint8Array() })) };
    const encoder = new FfmpegReelEncoder("ffmpeg", execution);
    await expect(encoder.encode({ sourceFingerprint:"b".repeat(64), frames:[{bytes:png,durationSeconds:1}] })).rejects.toThrow(/encoder failed|ffmpeg/i);
  });

  it("rejects an execution result larger than the configured bound even if the runner misbehaves", async () => {
    const execution: FfmpegExecutionPort = { run:vi.fn(async () => ({ exitCode:0, stderr:"", outputBytes:new Uint8Array(65) })) };
    const encoder = new FfmpegReelEncoder("ffmpeg", execution, { maxOutputBytes:64 });
    await expect(encoder.encode({ sourceFingerprint:"b".repeat(64), frames:[{bytes:png,durationSeconds:1}] })).rejects.toThrow(/size|bound/i);
  });
});
