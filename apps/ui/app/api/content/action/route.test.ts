import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  approveContentVersion: vi.fn(), getContentData: vi.fn(), reviewContentVersion: vi.fn(), saveContentVersion: vi.fn(), scheduleContentVersion: vi.fn(),
}));
vi.mock("../../../../lib/api", () => api);
import { POST } from "./route";

const scope = { brandId: "brand-1", campaignId: "campaign-1", assetId: "asset-1", expectedVersion: 2 };
const account = { id: "account-1", channel: "instagram", accountRef: "ig-1", displayName: "Kairo IG", capabilities: ["publish-image"], status: "connected" };
function request(action: string, extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/content/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...scope, ...extra }) });
}

describe("V2 content actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getContentData.mockResolvedValue({ authenticated: true, brandId: "brand-1", channelAccounts: [account], details: [{ campaign: { id: "campaign-1" }, assets: [{ asset: { id: "asset-1", currentVersion: 2, channel: "instagram", format: "image" }, versions: [] }] }] });
  });

  it("persists a new immutable content version", async () => {
    api.saveContentVersion.mockResolvedValue({ assets: [{ asset: { id: "asset-1" }, versions: [{ version: 3 }] }] });
    expect((await POST(request("save", { content: "Clean caption" }))).status).toBe(200);
    expect(api.saveContentVersion).toHaveBeenCalledWith("brand-1", "campaign-1", "asset-1", { expectedVersion: 2, content: "Clean caption" });
  });

  it("runs the real readiness review", async () => {
    api.reviewContentVersion.mockResolvedValue({ status: "passed" });
    expect((await POST(request("review"))).status).toBe(200);
    expect(api.reviewContentVersion).toHaveBeenCalledWith("brand-1", "campaign-1", "asset-1", 2);
  });

  it("binds approval to a server-verified connected destination", async () => {
    expect((await POST(request("approve", { channelAccountId: "account-1" }))).status).toBe(200);
    expect(api.approveContentVersion).toHaveBeenCalledWith("brand-1", "campaign-1", "asset-1", { expectedVersion: 2, destination: account });
  });

  it("rejects mismatched destinations and stale versions", async () => {
    expect((await POST(request("approve", { channelAccountId: "other" }))).status).toBe(400);
    api.getContentData.mockResolvedValueOnce({ authenticated: true, brandId: "brand-1", channelAccounts: [account], details: [{ campaign: { id: "campaign-1" }, assets: [{ asset: { id: "asset-1", currentVersion: 3, channel: "instagram" }, versions: [] }] }] });
    expect((await POST(request("approve", { channelAccountId: "account-1" }))).status).toBe(409);
    expect(api.approveContentVersion).not.toHaveBeenCalled();
  });

  it("schedules only a capable destination at a future time", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    api.scheduleContentVersion.mockResolvedValue({ scheduledFor: future });
    expect((await POST(request("schedule", { channelAccountId: "account-1", scheduledFor: future }))).status).toBe(200);
    expect(api.scheduleContentVersion).toHaveBeenCalledWith("brand-1", "campaign-1", "asset-1", { channelAccountId: "account-1", contentType: "image", scheduledFor: future });
  });
});
