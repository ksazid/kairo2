import { beforeEach, describe, expect, it, vi } from "vitest";

const { startHomeCreation, getHomeCreation } = vi.hoisted(() => ({
  startHomeCreation: vi.fn(),
  getHomeCreation: vi.fn(),
}));

vi.mock("../../../../lib/api", () => ({ startHomeCreation, getHomeCreation }));

import { POST } from "./route";

describe("home generation route", () => {
  beforeEach(() => {
    startHomeCreation.mockReset();
    getHomeCreation.mockReset();
  });

  it("starts opportunity development before asking for any optional visual asset", async () => {
    startHomeCreation.mockResolvedValue({ id: "creation-1", status: "queued" });

    const response = await POST(new Request("http://localhost/api/home/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId: "brand-1", opportunityId: "opportunity-1", format: "carousel" }),
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ creationId: "creation-1", status: "queued" });
    expect(startHomeCreation).toHaveBeenCalledWith({ brandId: "brand-1", opportunityId: "opportunity-1", format: "carousel" });
  });
});
