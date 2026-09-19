import { randomUUID } from "node:crypto";
import { DomainValidationError, ResourceNotFoundError, type KairoRepository } from "./index";

export type ContentAssetProvider = "google-drive" | "manual";
export type ContentAssetLibraryStatus = "not-connected" | "connected" | "needs-attention";
export type ContentAssetKind = "image" | "video" | "document" | "other";

export interface ContentAssetLibrary {
  id: string;
  workspaceId: string;
  brandId: string;
  name: string;
  provider: ContentAssetProvider;
  status: ContentAssetLibraryStatus;
  externalRootRef?: string;
  providerLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentLibraryAsset {
  id: string;
  workspaceId: string;
  brandId: string;
  libraryId: string;
  externalId: string;
  name: string;
  kind: ContentAssetKind;
  mimeType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  providerRef?: string;
  previewRef?: string;
  indexedAt: string;
}

export interface ContentAssetLibraryQuery {
  libraryId?: string;
  kind?: ContentAssetKind;
  query?: string;
}

export interface ContentAssetProviderStateInput {
  status: ContentAssetLibraryStatus;
  externalRootRef?: string;
  providerLabel?: string;
  clearRoot?: boolean;
}

export interface ContentAssetLibraryRepository {
  saveLibrary(accountId: string, library: ContentAssetLibrary): Promise<ContentAssetLibrary>;
  listLibraries(accountId: string, brandId: string): Promise<ContentAssetLibrary[]>;
  getLibrary(accountId: string, brandId: string, libraryId: string): Promise<ContentAssetLibrary | null>;
  listAssets(accountId: string, brandId: string, query?: ContentAssetLibraryQuery): Promise<ContentLibraryAsset[]>;
  getAssetsByIds?(accountId: string, brandId: string, assetIds: string[]): Promise<ContentLibraryAsset[]>;
  replaceIndexedAssets(accountId: string, library: ContentAssetLibrary, assets: ContentLibraryAsset[]): Promise<void>;
  updateProviderState(accountId: string, brandId: string, libraryId: string, input: ContentAssetProviderStateInput): Promise<ContentAssetLibrary>;
  clearIndexedAssets(accountId: string, brandId: string, libraryId: string): Promise<void>;
}

export interface ContentAssetConnectorAsset {
  externalId: string;
  name: string;
  kind: ContentAssetKind;
  mimeType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  providerRef?: string;
  previewRef?: string;
}

export interface ContentAssetConnector {
  readonly provider: ContentAssetProvider;
  listAssets(input: { externalRootRef: string; cursor?: string }): Promise<{ assets: ContentAssetConnectorAsset[]; nextCursor?: string }>;
}

export class ContentAssetLibraryService {
  constructor(
    private core: KairoRepository,
    private repository: ContentAssetLibraryRepository,
    private now: () => Date = () => new Date(),
  ) {}

  async listLibraries(accountId: string, brandId: string) {
    await this.requireBrand(accountId, brandId);
    return this.repository.listLibraries(accountId, brandId);
  }

  async listAssets(accountId: string, brandId: string, query: ContentAssetLibraryQuery = {}) {
    await this.requireBrand(accountId, brandId);
    const normalized = normalizeQuery(query);
    if (normalized.libraryId) {
      const library = await this.repository.getLibrary(accountId, brandId, normalized.libraryId);
      if (!library) throw new ResourceNotFoundError("Content Asset Library not found");
    }
    return this.repository.listAssets(accountId, brandId, normalized);
  }

  async createLibrary(accountId: string, brandId: string, input: { name: string; provider?: ContentAssetProvider }) {
    const brand = await this.requireBrand(accountId, brandId);
    const name = input.name?.trim();
    if (!name || name.length > 120) throw new DomainValidationError("Library name must be between 1 and 120 characters");
    const provider = input.provider ?? "google-drive";
    if (provider !== "google-drive" && provider !== "manual") throw new DomainValidationError("Unsupported Content Asset provider");
    const at = this.now().toISOString();
    return this.repository.saveLibrary(accountId, {
      id: randomUUID(),
      workspaceId: brand.workspaceId,
      brandId,
      name,
      provider,
      status: "not-connected",
      createdAt: at,
      updatedAt: at,
    });
  }

  async replaceFromConnector(accountId: string, brandId: string, libraryId: string, connector: ContentAssetConnector) {
    await this.requireBrand(accountId, brandId);
    const library = await this.repository.getLibrary(accountId, brandId, libraryId);
    if (!library) throw new ResourceNotFoundError("Content Asset Library not found");
    if (library.provider !== connector.provider) throw new DomainValidationError("Connector does not match Content Asset Library provider");
    if (!library.externalRootRef) throw new DomainValidationError("Content Asset Library is not connected");
    const indexedAt = this.now().toISOString();
    const collected: ContentAssetConnectorAsset[] = [];
    let cursor: string | undefined;
    do {
      const page = await connector.listAssets({ externalRootRef: library.externalRootRef, ...(cursor ? { cursor } : {}) });
      collected.push(...page.assets);
      cursor = page.nextCursor;
    } while (cursor);
    const assets = collected.map((asset) => toIndexedAsset(library, asset, indexedAt));
    await this.repository.replaceIndexedAssets(accountId, library, assets);
    return assets;
  }

  private async requireBrand(accountId: string, brandId: string) {
    const brand = await this.core.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    return brand;
  }
}

export function normalizeQuery(input: ContentAssetLibraryQuery): ContentAssetLibraryQuery {
  const query = input.query?.trim().toLocaleLowerCase();
  const kind = input.kind;
  if (kind && !["image", "video", "document", "other"].includes(kind)) throw new DomainValidationError("Unsupported Content Asset kind");
  return {
    ...(input.libraryId?.trim() ? { libraryId: input.libraryId.trim() } : {}),
    ...(kind ? { kind } : {}),
    ...(query ? { query } : {}),
  };
}

export function matchesContentAsset(asset: ContentLibraryAsset, query: ContentAssetLibraryQuery): boolean {
  const normalized = normalizeQuery(query);
  if (normalized.libraryId && asset.libraryId !== normalized.libraryId) return false;
  if (normalized.kind && asset.kind !== normalized.kind) return false;
  if (normalized.query) {
    const haystack = `${asset.name} ${asset.mimeType}`.toLocaleLowerCase();
    if (!haystack.includes(normalized.query)) return false;
  }
  return true;
}

function toIndexedAsset(library: ContentAssetLibrary, asset: ContentAssetConnectorAsset, indexedAt: string): ContentLibraryAsset {
  if (!asset.externalId?.trim() || !asset.name?.trim() || !asset.mimeType?.trim()) throw new DomainValidationError("Connector returned invalid Content Asset metadata");
  return {
    id: `${library.id}:${asset.externalId}`,
    workspaceId: library.workspaceId,
    brandId: library.brandId,
    libraryId: library.id,
    externalId: asset.externalId,
    name: asset.name.trim(),
    kind: asset.kind,
    mimeType: asset.mimeType.trim(),
    ...(asset.sizeBytes === undefined ? {} : { sizeBytes: asset.sizeBytes }),
    ...(asset.modifiedAt ? { modifiedAt: asset.modifiedAt } : {}),
    ...(asset.providerRef ? { providerRef: asset.providerRef } : {}),
    ...(asset.previewRef ? { previewRef: asset.previewRef } : {}),
    indexedAt,
  };
}
