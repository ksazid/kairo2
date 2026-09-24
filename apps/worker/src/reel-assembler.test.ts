import { describe, expect, it } from "vitest";
import type { FfmpegExecutionPort, FfmpegExecutionRequest, FfmpegExecutionResult } from "./reel-encoder";
import { FfmpegReelAssembler } from "./reel-assembler";

const MP4 = new Uint8Array([0,0,0,24,0x66,0x74,0x79,0x70,0,0,0,0,0,0,0,0]);
const PNG = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);

class FakeExecution implements FfmpegExecutionPort {
  requests: FfmpegExecutionRequest[] = [];
  async run(request: FfmpegExecutionRequest): Promise<FfmpegExecutionResult> {
    this.requests.push(request);
    return { exitCode: 0, stderr: "", outputBytes: MP4 };
  }
}

describe("Ffmpeg Reel Production V2 assembler", () => {
  it("normalizes every scene with audio and concatenates one publishable MP4", async () => {
    const execution = new FakeExecution();
    const assembler = new FfmpegReelAssembler("/usr/bin/ffmpeg", execution);
    const result = await assembler.assemble({
      projectId: "project-1",
      scenes: [
        { id: "scene-01", durationSeconds: 4, visual: { contentType: "video/mp4", bytes: MP4 }, narration: { status: "current", contentType: "audio/mpeg", bytes: new Uint8Array([1,2,3]) } },
        { id: "scene-02", durationSeconds: 6, visual: { contentType: "image/png", bytes: PNG }, narration: { status: "intentional-silence", reason: "Intentional silent product close-up" } },
      ],
    });

    expect(execution.requests).toHaveLength(3);
    expect(execution.requests[0]?.args).toContain("audio-000.mp3");
    expect(execution.requests[1]?.args.join(" ")).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(execution.requests[2]?.args).toContain("concat");
    expect(result).toMatchObject({ contentType: "video/mp4", sceneCount: 2, durationSeconds: 10, assemblerVersion: "ffmpeg-reel-v2" });
    expect(result.assemblyFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when supplied asset hashes do not match bytes", async () => {
    const assembler = new FfmpegReelAssembler("/usr/bin/ffmpeg", new FakeExecution());
    await expect(assembler.assemble({
      projectId: "project-1",
      scenes: [{ id: "scene-01", durationSeconds: 4, visual: { contentType: "video/mp4", bytes: MP4, contentHash: "0".repeat(64) }, narration: { status: "intentional-silence", reason: "Intentional silence for this scene" } }],
    })).rejects.toThrow(/hash/);
  });
});
