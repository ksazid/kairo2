import { describe, expect, it, vi } from "vitest";
import { loadAccessibleBrandDirectory, resolveAccessibleBrand, workspaceForBrand } from "./brand-access";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Kairo UI v2 Brand access", () => {
  it("loads Brands from every workspace in the authenticated session", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/api/v1/session")) {
        return json({
          account: { id: "account-1", displayName: "Member" },
          workspaces: [
            { id: "workspace-a", name: "A", role: "owner" },
            { id: "workspace-b", name: "B", role: "member" },
          ],
        });
      }
      if (path.endsWith("/workspaces/workspace-a/brands")) return json([{ id: "brand-a", name: "Alpha" }]);
      if (path.endsWith("/workspaces/workspace-b/brands")) return json([{ id: "brand-b", name: "Beta" }]);
      return json({}, 404);
    });

    const directory = await loadAccessibleBrandDirectory({ token: "token", apiBase: "https://api.example", fetcher: fetcher as typeof fetch });

    expect(directory.authenticated).toBe(true);
    expect(directory.brands).toEqual([
      { id: "brand-a", workspaceId: "workspace-a", name: "Alpha" },
      { id: "brand-b", workspaceId: "workspace-b", name: "Beta" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("resolves a selected Brand in a non-primary workspace", () => {
    const brands = [
      { id: "brand-a", workspaceId: "workspace-a", name: "Alpha" },
      { id: "brand-b", workspaceId: "workspace-b", name: "Beta" },
    ];
    const workspaces = [
      { id: "workspace-a", name: "A", role: "owner" as const },
      { id: "workspace-b", name: "B", role: "member" as const },
    ];

    const selected = resolveAccessibleBrand(brands, "brand-b");
    expect(selected?.name).toBe("Beta");
    expect(workspaceForBrand(workspaces, selected)?.id).toBe("workspace-b");
  });

  it("does not silently replace an inaccessible requested Brand with the first Brand", () => {
    const brands = [{ id: "brand-a", workspaceId: "workspace-a", name: "Alpha" }];
    expect(resolveAccessibleBrand(brands, "brand-missing")).toBeNull();
    expect(resolveAccessibleBrand(brands)?.id).toBe("brand-a");
  });
});
