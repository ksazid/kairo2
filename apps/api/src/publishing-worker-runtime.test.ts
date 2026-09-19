import { describe, expect, it } from "vitest";
import { runPublishingTick } from "./publishing-worker-runtime";

describe("publishing worker runtime", () => {
  it("stops when no scheduled Instagram job is available", async () => {
    let calls = 0;
    const processed = await runPublishingTick({ runOnce: async () => { calls += 1; return false; } }, 5);
    expect(processed).toBe(0);
    expect(calls).toBe(1);
  });

  it("never exceeds the configured per-tick bound", async () => {
    let calls = 0;
    const processed = await runPublishingTick({ runOnce: async () => { calls += 1; return true; } }, 3);
    expect(processed).toBe(3);
    expect(calls).toBe(3);
  });

  it("rejects an invalid max-jobs bound", async () => {
    await expect(runPublishingTick({ runOnce: async () => false }, 0)).rejects.toThrow("maxJobsPerTick is invalid");
  });
});
