import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/brand-brain-api", () => ({
  addBrandBrainSource: vi.fn(),
  saveBrandBrainField: vi.fn(),
  saveBrandDiscoveryTopic: vi.fn(),
  setBrandBrainSourceStatus: vi.fn(),
}));

import { setBrandBrainSourceStatus } from "../../../lib/brand-brain-api";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("Brand source status route", () => {
  afterEach(() => vi.clearAllMocks());

  it("passes only the selected Brand, source and reversible status to the authenticated API helper", async () => {
    vi.mocked(setBrandBrainSourceStatus).mockResolvedValue({ hunterReady: true } as never);
    const response = await POST(request({ action: "set-source-status", brandId: "brand-1", sourceId: "source-2", status: "disabled" }));
    expect(response.status).toBe(200);
    expect(setBrandBrainSourceStatus).toHaveBeenCalledWith({ brandId: "brand-1", sourceId: "source-2", status: "disabled" });
  });

  it("rejects unsupported source statuses before calling the API", async () => {
    const response = await POST(request({ action: "set-source-status", brandId: "brand-1", sourceId: "source-2", status: "removed" }));
    expect(response.status).toBe(400);
    expect(setBrandBrainSourceStatus).not.toHaveBeenCalled();
  });
});
