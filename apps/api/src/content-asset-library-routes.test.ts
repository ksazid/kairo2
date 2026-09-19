import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { MemoryKairoRepository } from "./store";
import { registerContentAssetLibraryRoutes } from "./content-asset-library-routes";
import { matchesContentAsset, type ContentAssetLibrary, type ContentAssetLibraryQuery, type ContentAssetLibraryRepository, type ContentAssetProviderStateInput, type ContentLibraryAsset } from "@kairo/domain/content-asset-library";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:") ? { provider: "test", subject: value.slice(12) } : null;
  }
}

class MemoryLibraryStore implements ContentAssetLibraryRepository {
  libraries: ContentAssetLibrary[] = [];
  assets: ContentLibraryAsset[] = [];
  async saveLibrary(_accountId: string, library: ContentAssetLibrary) { this.libraries.push(library); return library; }
  async listLibraries(_accountId: string, brandId: string) { return this.libraries.filter((item) => item.brandId === brandId); }
  async getLibrary(_accountId: string, brandId: string, libraryId: string) { return this.libraries.find((item) => item.brandId === brandId && item.id === libraryId) ?? null; }
  async listAssets(_accountId: string, brandId: string, query: ContentAssetLibraryQuery = {}) { return this.assets.filter((asset) => asset.brandId === brandId && matchesContentAsset(asset, query)); }
  async replaceIndexedAssets(_accountId: string, library: ContentAssetLibrary, assets: ContentLibraryAsset[]) { this.assets = [...this.assets.filter((asset) => asset.libraryId !== library.id), ...assets]; }
  async updateProviderState(_accountId:string,brandId:string,libraryId:string,input:ContentAssetProviderStateInput){const library=this.libraries.find((item)=>item.brandId===brandId&&item.id===libraryId);if(!library)throw new Error("missing");const updated={...library,status:input.status,...(input.clearRoot?{externalRootRef:undefined,providerLabel:undefined}:{}),...(input.externalRootRef?{externalRootRef:input.externalRootRef}:{}),...(input.providerLabel?{providerLabel:input.providerLabel}:{})};this.libraries=this.libraries.map((item)=>item.id===libraryId?updated:item);return updated;}
  async clearIndexedAssets(_accountId:string,brandId:string,libraryId:string){this.assets=this.assets.filter((asset)=>asset.brandId!==brandId||asset.libraryId!==libraryId);}
}

describe("VS-59 Content Asset Library API", () => {
  it("requires auth and enforces Brand membership before returning library data", async () => {
    const core = new MemoryKairoRepository();
    const store = new MemoryLibraryStore();
    const verifier = new Verifier();
    const app = buildApp({ store: core, identityVerifier: verifier });
    registerContentAssetLibraryRoutes(app, { coreStore: core, libraryStore: store, identityVerifier: verifier });

    expect((await app.inject({ method: "GET", url: "/api/v1/brands/secret/content-asset-libraries" })).statusCode).toBe(401);

    const setup = await app.inject({ method: "POST", url: "/api/v1/workspaces", headers: { authorization: "Bearer test:alice" }, payload: { workspaceName: "Studio", brandName: "Kairo" } });
    const brandId = setup.json().brand.id as string;

    const created = await app.inject({ method: "POST", url: `/api/v1/brands/${brandId}/content-asset-libraries`, headers: { authorization: "Bearer test:alice" }, payload: { name: "Product Photos", provider: "google-drive" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ brandId, name: "Product Photos", provider: "google-drive", status: "not-connected" });

    const listed = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/content-asset-libraries`, headers: { authorization: "Bearer test:alice" } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const foreign = await app.inject({ method: "GET", url: `/api/v1/brands/${brandId}/content-asset-libraries`, headers: { authorization: "Bearer test:bob" } });
    expect(foreign.statusCode).toBe(404);

    await app.close();
  });
});
