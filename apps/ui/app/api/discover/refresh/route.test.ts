import { beforeEach, describe, expect, it, vi } from "vitest";

const { runManualHunter, getHomeOpportunities, getBrandBrainActivation } = vi.hoisted(() => ({
  runManualHunter: vi.fn(),
  getHomeOpportunities: vi.fn(),
  getBrandBrainActivation: vi.fn(),
}));

vi.mock("../../../../lib/api", () => ({ runManualHunter, getHomeOpportunities }));
vi.mock("../../../../lib/brand-brain-api", () => ({ getBrandBrainActivation }));

import { POST } from "./route";

describe("manual discovery refresh route", () => {
  beforeEach(() => {
    runManualHunter.mockReset();
    getHomeOpportunities.mockReset();
    getBrandBrainActivation.mockReset();
  });

  it("runs Hunter and returns the persisted opportunities for Discover", async () => {
    runManualHunter.mockResolvedValue({ evidenceCount: 1, candidateCount: 1, opportunityCount: 1 });
    getHomeOpportunities.mockResolvedValue([{ id: "opportunity-1", title: "A persisted Hunter opportunity" }]);
    getBrandBrainActivation.mockResolvedValue({ hunterReady: true, discoveryRun: { runId: "run-1" } });

    const response = await POST(new Request("http://localhost/api/discover/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId: "brand-1" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: { evidenceCount: 1, candidateCount: 1, opportunityCount: 1 },
      opportunities: [{ id: "opportunity-1", title: "A persisted Hunter opportunity" }],
      activation: { hunterReady: true, discoveryRun: { runId: "run-1" } },
    });
    expect(runManualHunter).toHaveBeenCalledWith("brand-1");
    expect(getHomeOpportunities).toHaveBeenCalledWith("brand-1");
    expect(getBrandBrainActivation).toHaveBeenCalledWith("brand-1");
    expect(runManualHunter.mock.invocationCallOrder[0]).toBeLessThan(getHomeOpportunities.mock.invocationCallOrder[0]!);
  });

  it("rejects a missing Brand before starting Hunter", async () => {
    const response = await POST(new Request("http://localhost/api/discover/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(400);
    expect(runManualHunter).not.toHaveBeenCalled();
  });
});
