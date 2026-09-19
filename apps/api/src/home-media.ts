import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainValidationError, ResourceNotFoundError } from "@kairo/domain";
import {
  privateMediaObjectKey,
  S3PrivateUploadSigner,
  S3TemporaryObjectSigner,
} from "./private-object-storage";

export type HomeMediaKind = "image" | "video";
export type HomeMediaSource = "uploaded" | "generated" | "brand-asset";

export interface HomeMediaAssetView {
  id: string;
  name: string;
  kind: HomeMediaKind;
  source: HomeMediaSource;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  previewUrl: string;
  createdAt: string;
}

export interface BeginHomeMediaUploadInput {
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface HomeMediaReference {
  id: string;
  libraryId: string;
  name: string;
  kind: HomeMediaKind;
  mimeType: string;
  sizeBytes: number;
  indexedAt: string;
}

interface StoredMediaAsset {
  id: string;
  accountId: string;
  workspaceId: string;
  brandId: string;
  source: HomeMediaSource;
  objectKey: string;
  fileName: string;
  kind: HomeMediaKind;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "processing" | "ready" | "failed";
  uploadExpiresAt?: string;
  libraryAssetId?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
}

export interface HomeMediaRepository {
  createUploading(value: StoredMediaAsset): Promise<void>;
  getUploadingForCompletion(accountId: string, brandId: string, assetId: string): Promise<StoredMediaAsset | null>;
  markReady(asset: StoredMediaAsset, readyAt: string): Promise<StoredMediaAsset>;
  listReady(accountId: string, brandId: string): Promise<StoredMediaAsset[]>;
  requireAssets(accountId: string, brandId: string, ids: string[]): Promise<HomeMediaReference[]>;
}

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const SIGNED_URL_SECONDS = 600;
const MAX_CREATION_MEDIA = 12;

export class PgHomeMediaRepository implements HomeMediaRepository {
  constructor(private readonly pool: Pool) {}

  async createUploading(value: StoredMediaAsset) {
    await this.pool.query(
      `insert into media_assets(
        id,account_id,workspace_id,brand_id,source,object_key,original_filename,kind,mime_type,size_bytes,status,upload_expires_at,created_at,updated_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'uploading',$11,$12,$12)`,
      [
        value.id,
        value.accountId,
        value.workspaceId,
        value.brandId,
        value.source,
        value.objectKey,
        value.fileName,
        value.kind,
        value.mimeType,
        value.sizeBytes,
        value.uploadExpiresAt ?? null,
        value.createdAt,
      ],
    );
  }

  async getUploadingForCompletion(accountId: string, brandId: string, assetId: string) {
    const result = await this.pool.query(
      `select a.*
         from media_assets a
         join workspace_memberships m on m.workspace_id=a.workspace_id and m.account_id=$1 and m.active=true
        where a.id=$2 and a.brand_id=$3 and a.account_id=$1 and a.status='uploading'`,
      [accountId, assetId, brandId],
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }

  async markReady(asset: StoredMediaAsset, readyAt: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const libraryId = await ensureKairoMediaLibrary(client, asset.workspaceId, asset.brandId, readyAt);
      await client.query(
        `insert into content_library_assets(
          id,workspace_id,brand_id,library_id,external_id,name,kind,mime_type,size_bytes,modified_at,provider_ref,preview_ref,indexed_at
        ) values($1,$2,$3,$4,$1,$5,$6,$7,$8,$9,null,null,$9)
        on conflict(id) do update set
          name=excluded.name,
          kind=excluded.kind,
          mime_type=excluded.mime_type,
          size_bytes=excluded.size_bytes,
          modified_at=excluded.modified_at,
          provider_ref=null,
          preview_ref=null,
          indexed_at=excluded.indexed_at`,
        [asset.id, asset.workspaceId, asset.brandId, libraryId, asset.fileName, asset.kind, asset.mimeType, asset.sizeBytes, readyAt],
      );
      const updated = await client.query(
        `update media_assets
            set status='ready', ready_at=$4, updated_at=$4, upload_expires_at=null, library_asset_id=$1
          where id=$1 and workspace_id=$2 and brand_id=$3 and status='uploading'
          returning *`,
        [asset.id, asset.workspaceId, asset.brandId, readyAt],
      );
      if (!updated.rows[0]) throw new Error("Media upload completion changed concurrently");
      await client.query("commit");
      return mapAsset(updated.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listReady(accountId: string, brandId: string) {
    const result = await this.pool.query(
      `select a.*
         from media_assets a
         join workspace_memberships m on m.workspace_id=a.workspace_id and m.account_id=$1 and m.active=true
        where a.brand_id=$2 and a.status='ready'
        order by a.ready_at desc nulls last,a.created_at desc`,
      [accountId, brandId],
    );
    return result.rows.map(mapAsset);
  }

  async requireAssets(accountId: string, brandId: string, ids: string[]): Promise<HomeMediaReference[]> {
    const normalized = normalizeIds(ids);
    if (!normalized.length) return [];
    const result = await this.pool.query(
      `select a.*, l.library_id
         from media_assets a
         join workspace_memberships m on m.workspace_id=a.workspace_id and m.account_id=$1 and m.active=true
         left join content_library_assets l on l.id=a.library_asset_id and l.brand_id=a.brand_id
        where a.brand_id=$2 and a.status='ready' and a.id=any($3::text[])`,
      [accountId, brandId, normalized],
    );
    const byId = new Map(result.rows.map((row) => [String(row.id), row]));
    if (byId.size !== normalized.length) throw new ResourceNotFoundError("One or more media assets are unavailable for this Brand");
    return normalized.map((id) => {
      const row = byId.get(id)!;
      const item = mapAsset(row);
      const libraryId = typeof row.library_id === "string" ? row.library_id : "";
      if (!libraryId) throw new ResourceNotFoundError("Media library metadata is unavailable");
      return {
        id: item.id,
        libraryId,
        name: item.fileName,
        kind: item.kind,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        indexedAt: item.readyAt ?? item.updatedAt,
      };
    });
  }
}

export class HomeMediaService {
  constructor(
    private readonly repository: HomeMediaRepository,
    private readonly uploadSigner: S3PrivateUploadSigner,
    private readonly deliverySigner: S3TemporaryObjectSigner,
    private readonly storageProvider: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(accountId: string, workspaceId: string, brandId: string, raw: BeginHomeMediaUploadInput) {
    const input = validateUpload(raw);
    const id = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + SIGNED_URL_SECONDS * 1000);
    const objectKey = privateMediaObjectKey(workspaceId, brandId, id);
    const value: StoredMediaAsset = {
      id,
      accountId,
      workspaceId,
      brandId,
      source: "uploaded",
      objectKey,
      fileName: input.name,
      kind: input.kind,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "uploading",
      uploadExpiresAt: expiresAt.toISOString(),
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    };
    await this.repository.createUploading(value);
    const uploadUrl = await this.uploadSigner.signPut({
      objectKey,
      contentType: input.mimeType,
      expiresInSeconds: SIGNED_URL_SECONDS,
    });
    return {
      mediaAssetId: id,
      uploadUrl,
      expiresInSeconds: SIGNED_URL_SECONDS,
      headers: { "content-type": input.mimeType },
    };
  }

  async complete(accountId: string, brandId: string, assetId: string) {
    const id = identifier(assetId, "mediaAssetId");
    const pending = await this.repository.getUploadingForCompletion(accountId, brandId, id);
    if (!pending) throw new ResourceNotFoundError("Media upload was not found");
    const now = this.now();
    if (!pending.uploadExpiresAt || new Date(pending.uploadExpiresAt).getTime() < now.getTime()) {
      throw new DomainValidationError("Media upload has expired. Upload the file again.");
    }
    await this.verifyObject(pending);
    const completed = await this.repository.markReady(pending, now.toISOString());
    return this.toView(completed);
  }

  async list(accountId: string, brandId: string): Promise<HomeMediaAssetView[]> {
    const items = await this.repository.listReady(accountId, brandId);
    return Promise.all(items.map((item) => this.toView(item)));
  }

  requireAssets(accountId: string, brandId: string, ids: string[]) {
    return this.repository.requireAssets(accountId, brandId, ids);
  }

  private async verifyObject(upload: StoredMediaAsset) {
    const previewUrl = await this.deliverySigner.sign({
      storageProvider: this.storageProvider,
      objectKey: upload.objectKey,
      expiresInSeconds: 120,
    });
    const response = await this.fetcher(previewUrl, { headers: { range: "bytes=0-0" } });
    try {
      if (!(response.ok || response.status === 206)) throw new DomainValidationError("Uploaded media could not be verified");
      const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
      if (contentType && contentType !== upload.mimeType) throw new DomainValidationError("Uploaded media type does not match the requested file type");
      const actualSize = sizeFromHeaders(response.headers);
      if (actualSize !== undefined && actualSize !== upload.sizeBytes) throw new DomainValidationError("Uploaded media size does not match the requested file size");
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }

  private async toView(item: StoredMediaAsset): Promise<HomeMediaAssetView> {
    const previewUrl = await this.deliverySigner.sign({
      storageProvider: this.storageProvider,
      objectKey: item.objectKey,
      expiresInSeconds: SIGNED_URL_SECONDS,
    });
    return {
      id: item.id,
      name: item.fileName,
      kind: item.kind,
      source: item.source,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      ...(item.width ? { width: item.width } : {}),
      ...(item.height ? { height: item.height } : {}),
      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      previewUrl,
      createdAt: item.readyAt ?? item.createdAt,
    };
  }
}

async function ensureKairoMediaLibrary(client: PoolClient, workspaceId: string, brandId: string, at: string) {
  const existing = await client.query(
    `select id from content_asset_libraries where workspace_id=$1 and brand_id=$2 and lower(name)='kairo media' limit 1`,
    [workspaceId, brandId],
  );
  if (existing.rows[0]) return String(existing.rows[0].id);
  const id = `kairo-media-${brandId}`;
  await client.query(
    `insert into content_asset_libraries(id,workspace_id,brand_id,name,provider,status,provider_label,created_at,updated_at)
     values($1,$2,$3,'Kairo Media','manual','connected','Private media',$4,$4)
     on conflict do nothing`,
    [id, workspaceId, brandId, at],
  );
  const resolved = await client.query(
    `select id from content_asset_libraries where workspace_id=$1 and brand_id=$2 and lower(name)='kairo media' limit 1`,
    [workspaceId, brandId],
  );
  if (!resolved.rows[0]) throw new Error("Unable to create Kairo Media library");
  return String(resolved.rows[0].id);
}

function validateUpload(raw: BeginHomeMediaUploadInput) {
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 240) throw new DomainValidationError("Media file name must be between 1 and 240 characters");
  const mimeType = typeof raw?.mimeType === "string" ? raw.mimeType.trim().toLowerCase() : "";
  const sizeBytes = Number(raw?.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new DomainValidationError("Media file size is invalid");
  if (IMAGE_MIME.has(mimeType)) {
    if (sizeBytes > IMAGE_MAX_BYTES) throw new DomainValidationError("Image must be 25 MiB or smaller");
    return { name, mimeType, sizeBytes, kind: "image" as const };
  }
  if (VIDEO_MIME.has(mimeType)) {
    if (sizeBytes > VIDEO_MAX_BYTES) throw new DomainValidationError("Video must be 512 MiB or smaller");
    return { name, mimeType, sizeBytes, kind: "video" as const };
  }
  throw new DomainValidationError("Unsupported media type. Use JPEG, PNG, WebP, MP4, MOV, or WebM.");
}

export function normalizeHomeMediaIds(input: unknown) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new DomainValidationError("mediaAssetIds must be an array");
  const unique = [...new Set(input.map((value) => identifier(value, "mediaAssetId")))];
  if (unique.length > MAX_CREATION_MEDIA) throw new DomainValidationError(`A creation can use at most ${MAX_CREATION_MEDIA} media assets`);
  return unique;
}

function normalizeIds(input: string[]) { return normalizeHomeMediaIds(input); }
function identifier(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 200 || !/^[A-Za-z0-9._-]+$/.test(normalized)) throw new DomainValidationError(`${field} is invalid`);
  return normalized;
}
function sizeFromHeaders(headers: Headers) {
  const contentRange = headers.get("content-range");
  const match = contentRange?.match(/\/(\d+)$/);
  if (match) return Number(match[1]);
  const contentLength = headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) return Number(contentLength);
  return undefined;
}
function mapAsset(row: any): StoredMediaAsset {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    source: row.source,
    objectKey: String(row.object_key),
    fileName: String(row.original_filename),
    kind: row.kind,
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    ...(row.upload_expires_at ? { uploadExpiresAt: new Date(row.upload_expires_at).toISOString() } : {}),
    ...(row.library_asset_id ? { libraryAssetId: String(row.library_asset_id) } : {}),
    ...(row.width ? { width: Number(row.width) } : {}),
    ...(row.height ? { height: Number(row.height) } : {}),
    ...(row.duration_ms != null ? { durationMs: Number(row.duration_ms) } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.ready_at ? { readyAt: new Date(row.ready_at).toISOString() } : {}),
  };
}
