import type { NarrationProvider } from "./reel-production-v2";
import { SceneProductionError, VideoProviderRegistry } from "./reel-production-v2";

export type ReadinessCheckStatus = "passed" | "warning" | "failed";

export interface ReelProductionReadinessCheck {
  id: "video-provider" | "narration-provider" | "ffmpeg-assembly";
  blocking: true;
  status: ReadinessCheckStatus;
  message: string;
}

export interface ReelProductionReadinessReport {
  status: "passed" | "warning" | "failed";
  checks: ReelProductionReadinessCheck[];
  checkedAt: string;
}

export interface ReelAssemblyReadinessProbe {
  probe(): Promise<{ status: "ready" | "unavailable"; message: string }>;
}

export class ReelProductionReadinessService {
  constructor(
    private readonly providers: VideoProviderRegistry,
    private readonly narration: NarrationProvider,
    private readonly assembler: ReelAssemblyReadinessProbe,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(): Promise<ReelProductionReadinessReport> {
    const providerProbes = await this.providers.probeAvailable();
    const readyProvider = providerProbes.find((item) => item.status === "ready");
    const unverifiedProvider = providerProbes.find((item) => item.status === "unverified");
    const video: ReelProductionReadinessCheck = readyProvider
      ? { id: "video-provider", blocking: true, status: "passed", message: `${readyProvider.id} live generation readiness verified` }
      : unverifiedProvider
        ? { id: "video-provider", blocking: true, status: "warning", message: `${unverifiedProvider.id} is configured but not live-probed` }
        : { id: "video-provider", blocking: true, status: "failed", message: "No configured video provider passed readiness" };

    const narration = await this.narrationCheck();
    const assembly = await this.assemblyCheck();
    const checks = [video, narration, assembly];
    const status = checks.some((check) => check.status === "failed")
      ? "failed"
      : checks.some((check) => check.status === "warning")
        ? "warning"
        : "passed";
    const checkedAt = this.clock();
    if (!(checkedAt instanceof Date) || Number.isNaN(checkedAt.getTime())) throw new Error("Reel readiness clock returned an invalid date");
    return { status, checks, checkedAt: checkedAt.toISOString() };
  }

  assertReady(report: ReelProductionReadinessReport): void {
    if (report.status !== "passed") {
      const unresolved = report.checks.filter((check) => check.status !== "passed").map((check) => check.id);
      throw new SceneProductionError(`Reel Production V2 readiness is not fully verified: ${unresolved.join(", ")}`, "reel-production-readiness-blocked");
    }
  }

  private async narrationCheck(): Promise<ReelProductionReadinessCheck> {
    if (!this.narration.isAvailable()) return { id: "narration-provider", blocking: true, status: "failed", message: "Narration provider is unavailable" };
    if (!this.narration.probe) return { id: "narration-provider", blocking: true, status: "warning", message: `${this.narration.id} is configured but not live-probed` };
    try {
      const result = await this.narration.probe();
      return result.status === "ready"
        ? { id: "narration-provider", blocking: true, status: "passed", message: result.message }
        : { id: "narration-provider", blocking: true, status: "failed", message: result.message };
    } catch (error) {
      return { id: "narration-provider", blocking: true, status: "failed", message: `Narration readiness probe failed: ${message(error)}` };
    }
  }

  private async assemblyCheck(): Promise<ReelProductionReadinessCheck> {
    try {
      const result = await this.assembler.probe();
      return result.status === "ready"
        ? { id: "ffmpeg-assembly", blocking: true, status: "passed", message: result.message }
        : { id: "ffmpeg-assembly", blocking: true, status: "failed", message: result.message };
    } catch (error) {
      return { id: "ffmpeg-assembly", blocking: true, status: "failed", message: `FFmpeg readiness probe failed: ${message(error)}` };
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
