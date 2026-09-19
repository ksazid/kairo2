import { describe, expect, it, vi } from "vitest";
import { discoveryRefreshNotice, refreshDiscovery } from "./discovery-refresh";

describe("Brand Brain discovery refresh", () => {
  it("executes the manual Hunter endpoint and returns persisted activation", async () => {
    const payload = { run: { evidenceCount: 2, candidateCount: 1, opportunityCount: 1 }, opportunities: [{ id: "o1", title: "Real" }], activation: { hunterReady: true } };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(refreshDiscovery("brand-1", fetchImpl as typeof fetch)).resolves.toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/api/discover/refresh", expect.objectContaining({ method: "POST", body: JSON.stringify({ brandId: "brand-1" }) }));
  });

  it("surfaces endpoint failures and truthful zero-result outcomes", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Hunter is unavailable." }), { status: 400 }));
    await expect(refreshDiscovery("brand-1", fetchImpl as typeof fetch)).rejects.toThrow("Hunter is unavailable.");
    expect(discoveryRefreshNotice({ evidenceCount: 0, candidateCount: 0, opportunityCount: 0, degradedSources: ["github"] })).toContain("1 source was unavailable");
  });
});
