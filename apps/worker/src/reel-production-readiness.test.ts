import { describe, expect, it } from "vitest";
import {
  ReelProductionReadinessService,
  type ReelAssemblyReadinessProbe,
} from "./reel-production-readiness";
import {
  VideoProviderRegistry,
  type GeneratedVideoClip,
  type NarrationEstimate,
  type NarrationProvider,
  type NarrationResult,
  type VideoGenerationEstimate,
  type VideoGenerationProvider,
  type VideoGenerationRequest,
} from "./reel-production-v2";

class Provider implements VideoGenerationProvider {
  readonly id = "motion";
  readonly capabilities = { minDurationSeconds: 1, maxDurationSeconds: 30, aspectRatios: ["9:16"], maxReferenceAssets: 0 };
  constructor(private readonly probeStatus: "ready" | "unavailable" = "ready") {}
  isAvailable() { return true; }
  async estimate(request: VideoGenerationRequest): Promise<VideoGenerationEstimate> { return { providerId: this.id, generatedSeconds: request.durationSeconds, billable: false, pricingNote: "fixture" }; }
  async generate(): Promise<GeneratedVideoClip> { throw new Error("not used"); }
  async probe() { return { status: this.probeStatus, message: this.probeStatus === "ready" ? "motion verified" : "motion unavailable" } as const; }
}

class Narration implements NarrationProvider {
  readonly id = "voice";
  isAvailable() { return true; }
  async estimate(text: string): Promise<NarrationEstimate> { return { providerId: this.id, characters: text.length, billable: false, pricingNote: "fixture" }; }
  async synthesize(): Promise<NarrationResult> { throw new Error("not used"); }
  async probe() { return { status: "ready" as const, message: "voice verified" }; }
}

class AssemblerProbe implements ReelAssemblyReadinessProbe {
  constructor(private readonly status: "ready" | "unavailable" = "ready") {}
  async probe() { return { status: this.status, message: this.status === "ready" ? "ffmpeg verified" : "ffmpeg unavailable" }; }
}

describe("Reel Production V2 readiness", () => {
  it("passes only when motion, narration and assembly are live verified", async () => {
    const service = new ReelProductionReadinessService(new VideoProviderRegistry([new Provider()]), new Narration(), new AssemblerProbe(), () => new Date("2026-09-25T00:20:00.000Z"));
    const report = await service.run();
    expect(report.status).toBe("passed");
    expect(report.checks.map((item) => item.status)).toEqual(["passed", "passed", "passed"]);
    expect(() => service.assertReady(report)).not.toThrow();
  });

  it("blocks when a required live media capability is unavailable", async () => {
    const service = new ReelProductionReadinessService(new VideoProviderRegistry([new Provider("unavailable")]), new Narration(), new AssemblerProbe());
    const report = await service.run();
    expect(report.status).toBe("failed");
    expect(() => service.assertReady(report)).toThrowError(/readiness/);
  });
});
