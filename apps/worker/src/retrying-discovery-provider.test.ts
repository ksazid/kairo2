import { describe, expect, it, vi } from "vitest";
import type { DiscoveryRequest, DiscoverySourceProvider } from "@kairo/agent-contracts";
import { ResearchEvidenceAdapterError } from "./research-evidence-adapters";
import { RetryingDiscoverySourceProvider } from "./retrying-discovery-provider";

const request: DiscoveryRequest = {
  query: "motorcycle exhaust performance",
  maxResults: 4,
  timeoutMs: 5_000,
  scope: { visibility: "global-public" },
};

const evidence = [{
  title: "Motorcycle exhaust study",
  sourceUrl: "https://example.com/study",
  platform: "research",
  retrievedAt: "2026-08-21T00:00:00.000Z",
  provider: "test",
}];

describe("RetryingDiscoverySourceProvider", () => {
  it("recovers from a bounded rate limit without changing the request", async () => {
    const discover = vi.fn()
      .mockRejectedValueOnce(new ResearchEvidenceAdapterError("rate-limited", "slow down"))
      .mockResolvedValueOnce(evidence);
    const sleep = vi.fn(async (_ms: number) => undefined);
    const provider = new RetryingDiscoverySourceProvider({ discover } as DiscoverySourceProvider, { sleep, now: () => 0 });

    await expect(provider.discover(request)).resolves.toEqual(evidence);
    expect(discover).toHaveBeenCalledTimes(2);
    expect(discover).toHaveBeenNthCalledWith(1, request);
    expect(discover).toHaveBeenNthCalledWith(2, request);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("retries transient upstream failures only to the configured bound", async () => {
    const discover = vi.fn(async () => { throw new ResearchEvidenceAdapterError("upstream", "unavailable"); });
    const sleep = vi.fn(async (_ms: number) => undefined);
    const provider = new RetryingDiscoverySourceProvider({ discover } as DiscoverySourceProvider, { maxAttempts: 3, sleep });

    await expect(provider.discover(request)).rejects.toMatchObject({ kind: "upstream" });
    expect(discover).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry invalid responses", async () => {
    const discover = vi.fn(async () => { throw new ResearchEvidenceAdapterError("invalid-response", "bad payload"); });
    const sleep = vi.fn(async (_ms: number) => undefined);
    const provider = new RetryingDiscoverySourceProvider({ discover } as DiscoverySourceProvider, { sleep });

    await expect(provider.discover(request)).rejects.toMatchObject({ kind: "invalid-response" });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("shares one timeout budget across attempts and retry delays", async () => {
    let now = 0;
    const discover = vi.fn(async (_request: DiscoveryRequest) => {
      if (discover.mock.calls.length === 1) {
        now += 3_000;
        throw new ResearchEvidenceAdapterError("upstream", "unavailable");
      }
      return evidence;
    });
    const provider = new RetryingDiscoverySourceProvider({ discover }, {
      now: () => now,
      sleep: async (ms) => { now += ms; },
    });

    await expect(provider.discover(request)).resolves.toEqual(evidence);
    expect(discover).toHaveBeenNthCalledWith(2, { ...request, timeoutMs: 1_750 });
  });

  it("does not sleep or retry when the remaining budget cannot fit a valid attempt", async () => {
    let now = 0;
    const discover = vi.fn(async () => {
      now += 4_800;
      throw new ResearchEvidenceAdapterError("upstream", "unavailable");
    });
    const sleep = vi.fn(async (_ms: number) => undefined);
    const provider = new RetryingDiscoverySourceProvider({ discover }, { now: () => now, sleep });

    await expect(provider.discover(request)).rejects.toMatchObject({ kind: "upstream" });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
