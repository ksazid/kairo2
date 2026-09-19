import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "kairo_access_token" ? { value: "token" } : undefined,
  }),
}));

import { createBrand } from "./api";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createBrand first-workspace onboarding", () => {
  beforeEach(() => {
    process.env.KAIRO_API_URL = "https://api.example";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KAIRO_API_URL;
  });

  it("creates the first workspace and Brand when the authenticated account has no workspace", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/session")) {
        return json({
          account: { id: "account-1", displayName: "Member" },
          workspaces: [],
        });
      }
      if (url.endsWith("/api/v1/workspaces") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          workspaceName: "Calle Bistro E2E",
          brandName: "Calle Bistro E2E",
          publicSourceUrl: "https://www.callebistromalta.com",
        });
        return json({
          workspace: { id: "workspace-1", name: "Calle Bistro E2E", role: "owner" },
          brand: { id: "brand-1", workspaceId: "workspace-1", name: "Calle Bistro E2E" },
        }, 201);
      }
      if (url.endsWith("/api/v1/brands/brand-1/brain/bootstrap") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          publicReferenceUrl: "https://www.callebistromalta.com",
        });
        return json({ brain: [], generatorStatus: "generated", proposedCount: 0, skippedConfirmedCount: 0, sourceIds: [] });
      }
      return json({ detail: "unexpected request" }, 404);
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(createBrand({
      brandName: "Calle Bistro E2E",
      publicSourceUrl: "https://www.callebistromalta.com",
    })).resolves.toEqual({
      id: "brand-1",
      workspaceId: "workspace-1",
      name: "Calle Bistro E2E",
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
