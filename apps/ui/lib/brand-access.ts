export type BrandAccessAccount = {
  id: string;
  email?: string;
  displayName?: string;
};

export type BrandAccessWorkspace = {
  id: string;
  name: string;
  role: "owner" | "member";
};

export type AccessibleBrand = {
  id: string;
  workspaceId: string;
  name: string;
};

export type AccessibleBrandDirectory = {
  authenticated: boolean;
  account?: BrandAccessAccount;
  workspaces: BrandAccessWorkspace[];
  brands: AccessibleBrand[];
};

type FetchLike = typeof fetch;

type SessionWorkspace = {
  id?: string;
  name?: string;
  role?: "owner" | "member";
};

export async function loadAccessibleBrandDirectory(input: {
  token: string;
  apiBase: string;
  fetcher?: FetchLike;
}): Promise<AccessibleBrandDirectory> {
  const fetcher = input.fetcher ?? fetch;
  const base = input.apiBase.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${input.token}` };
  const sessionResponse = await fetcher(`${base}/api/v1/session`, { cache: "no-store", headers });
  if (!sessionResponse.ok) return { authenticated: false, workspaces: [], brands: [] };

  const session = await sessionResponse.json() as {
    account?: BrandAccessAccount;
    workspaces?: SessionWorkspace[];
  };
  const workspaces = (session.workspaces ?? [])
    .filter((workspace): workspace is SessionWorkspace & { id: string } => typeof workspace.id === "string" && workspace.id.length > 0)
    .map((workspace): BrandAccessWorkspace => ({
      id: workspace.id,
      name: typeof workspace.name === "string" && workspace.name.trim() ? workspace.name : "Workspace",
      role: workspace.role === "owner" ? "owner" : "member",
    }));

  const brandsByWorkspace = await Promise.all(workspaces.map(async (workspace) => {
    const response = await fetcher(`${base}/api/v1/workspaces/${encodeURIComponent(workspace.id)}/brands`, { cache: "no-store", headers });
    if (!response.ok) return [] as AccessibleBrand[];
    const brands = await response.json() as Array<{ id?: string; name?: string }>;
    return brands
      .filter((brand): brand is { id: string; name: string } => typeof brand.id === "string" && brand.id.length > 0 && typeof brand.name === "string" && brand.name.trim().length > 0)
      .map((brand) => ({ id: brand.id, workspaceId: workspace.id, name: brand.name }));
  }));

  const seen = new Set<string>();
  const brands = brandsByWorkspace.flat().filter((brand) => {
    if (seen.has(brand.id)) return false;
    seen.add(brand.id);
    return true;
  });

  return {
    authenticated: true,
    ...(session.account ? { account: session.account } : {}),
    workspaces,
    brands,
  };
}

export function resolveAccessibleBrand(brands: AccessibleBrand[], requestedBrandId?: string): AccessibleBrand | null {
  if (requestedBrandId) return brands.find((brand) => brand.id === requestedBrandId) ?? null;
  return brands[0] ?? null;
}

export function workspaceForBrand(workspaces: BrandAccessWorkspace[], brand: AccessibleBrand | null): BrandAccessWorkspace | null {
  if (!brand) return null;
  return workspaces.find((workspace) => workspace.id === brand.workspaceId) ?? null;
}
