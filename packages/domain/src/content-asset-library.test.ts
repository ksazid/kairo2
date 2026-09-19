import { describe, expect, it } from "vitest";
import { ContentAssetLibraryService, matchesContentAsset, type ContentAssetLibrary, type ContentAssetLibraryRepository, type ContentAssetProviderStateInput, type ContentLibraryAsset } from "./content-asset-library";

function core(accessBrandId = "brand-1") {
  return { getBrandForAccount: async (_accountId: string, brandId: string) => brandId === accessBrandId ? { id: brandId, workspaceId: "workspace-1", name: "Brand" } : null } as any;
}

class MemoryRepository implements ContentAssetLibraryRepository {
  libraries: ContentAssetLibrary[] = [];
  assets: ContentLibraryAsset[] = [];
  async saveLibrary(_accountId: string, library: ContentAssetLibrary) { this.libraries = [...this.libraries.filter((item) => item.id !== library.id), library]; return library; }
  async listLibraries(_accountId: string, brandId: string) { return this.libraries.filter((item) => item.brandId === brandId).sort((a,b) => a.name.localeCompare(b.name)); }
  async getLibrary(_accountId: string, brandId: string, libraryId: string) { return this.libraries.find((item) => item.brandId === brandId && item.id === libraryId) ?? null; }
  async listAssets(_accountId: string, brandId: string, query = {}) { return this.assets.filter((asset) => asset.brandId === brandId && matchesContentAsset(asset, query)); }
  async replaceIndexedAssets(_accountId: string, library: ContentAssetLibrary, assets: ContentLibraryAsset[]) { this.assets = [...this.assets.filter((asset) => asset.libraryId !== library.id), ...assets]; }
  async updateProviderState(_accountId:string,brandId:string,libraryId:string,input:ContentAssetProviderStateInput){const library=this.libraries.find((item)=>item.brandId===brandId&&item.id===libraryId);if(!library)throw new Error("missing");const updated={...library,status:input.status,...(input.clearRoot?{externalRootRef:undefined,providerLabel:undefined}:{}),...(input.externalRootRef?{externalRootRef:input.externalRootRef}:{}),...(input.providerLabel?{providerLabel:input.providerLabel}:{})};this.libraries=this.libraries.map((item)=>item.id===libraryId?updated:item);return updated;}
  async clearIndexedAssets(_accountId:string,brandId:string,libraryId:string){this.assets=this.assets.filter((asset)=>asset.brandId!==brandId||asset.libraryId!==libraryId);}
}

describe("Content Asset Library", () => {
  it("creates multiple Brand-scoped libraries in a disconnected state", async () => {
    const repository = new MemoryRepository();
    const service = new ContentAssetLibraryService(core(), repository, () => new Date("2026-08-18T19:00:00Z"));
    await service.createLibrary("account-1", "brand-1", { name: "Product Photos", provider: "google-drive" });
    await service.createLibrary("account-1", "brand-1", { name: "Video Library", provider: "google-drive" });
    const libraries = await service.listLibraries("account-1", "brand-1");
    expect(libraries.map((library) => library.name)).toEqual(["Product Photos", "Video Library"]);
    expect(libraries.every((library) => library.status === "not-connected")).toBe(true);
  });

  it("rejects access to another Brand before repository data can leak", async () => {
    const service = new ContentAssetLibraryService(core("brand-1"), new MemoryRepository());
    await expect(service.listLibraries("account-1", "brand-2")).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("filters indexed metadata deterministically without changing provenance", () => {
    const asset: ContentLibraryAsset = { id:"library-1:file-1",workspaceId:"workspace-1",brandId:"brand-1",libraryId:"library-1",externalId:"file-1",name:"Summer Product Hero.jpg",kind:"image",mimeType:"image/jpeg",providerRef:"drive://file-1",indexedAt:"2026-08-18T19:00:00Z" };
    expect(matchesContentAsset(asset, { kind: "image", query: "product hero" })).toBe(true);
    expect(matchesContentAsset(asset, { kind: "video" })).toBe(false);
    expect(asset.providerRef).toBe("drive://file-1");
  });

  it("uses only an explicitly supplied connector and keeps its provider provenance", async () => {
    const repository = new MemoryRepository();
    const library: ContentAssetLibrary = { id:"library-1",workspaceId:"workspace-1",brandId:"brand-1",name:"Photography",provider:"google-drive",status:"connected",externalRootRef:"folder-1",createdAt:"2026-08-18T19:00:00Z",updatedAt:"2026-08-18T19:00:00Z" };
    repository.libraries.push(library);
    let calls = 0;
    const service = new ContentAssetLibraryService(core(), repository, () => new Date("2026-08-18T20:00:00Z"));
    const assets = await service.replaceFromConnector("account-1", "brand-1", "library-1", {
      provider: "google-drive",
      async listAssets() { calls++; return { assets: [{ externalId:"file-9",name:"Launch.mov",kind:"video",mimeType:"video/quicktime",providerRef:"drive://file-9" }] }; },
    });
    expect(calls).toBe(1);
    expect(assets[0]?.id).toBe("library-1:file-9");
    expect(assets[0]?.providerRef).toBe("drive://file-9");
    expect(assets[0]?.brandId).toBe("brand-1");
  });

  it("does not invoke a connector until Brand authorization succeeds", async () => {
    const repository = new MemoryRepository();
    repository.libraries.push({ id:"library-1",workspaceId:"workspace-1",brandId:"brand-2",name:"Foreign",provider:"google-drive",status:"connected",externalRootRef:"folder-foreign",createdAt:"2026-08-18T19:00:00Z",updatedAt:"2026-08-18T19:00:00Z" });
    let calls = 0;
    const service = new ContentAssetLibraryService(core("brand-1"), repository);
    await expect(service.replaceFromConnector("account-1", "brand-2", "library-1", {
      provider: "google-drive",
      async listAssets() { calls++; return { assets: [] }; },
    })).rejects.toMatchObject({ code: "resource_not_found" });
    expect(calls).toBe(0);
  });
});
