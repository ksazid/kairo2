import type { Pool, PoolClient } from "pg";
import { ResourceNotFoundError } from "@kairo/domain";
import type { ContentAssetLibrary, ContentAssetLibraryQuery, ContentAssetLibraryRepository, ContentAssetProviderStateInput, ContentLibraryAsset } from "@kairo/domain/content-asset-library";

export class PgContentAssetLibraryRepository implements ContentAssetLibraryRepository {
  constructor(private pool: Pool) {}

  async saveLibrary(accountId: string, library: ContentAssetLibrary) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, library.brandId);
      if (workspaceId !== library.workspaceId) throw new ResourceNotFoundError("Brand not found");
      const result = await client.query(
        `insert into content_asset_libraries(id,workspace_id,brand_id,name,provider,status,external_root_ref,provider_label,created_at,updated_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict(id) do update set name=excluded.name,provider=excluded.provider,status=excluded.status,external_root_ref=excluded.external_root_ref,provider_label=excluded.provider_label,updated_at=excluded.updated_at
         where content_asset_libraries.workspace_id=excluded.workspace_id and content_asset_libraries.brand_id=excluded.brand_id
         returning *`,
        [library.id,library.workspaceId,library.brandId,library.name,library.provider,library.status,library.externalRootRef??null,library.providerLabel??null,library.createdAt,library.updatedAt],
      );
      if (!result.rows[0]) throw new ResourceNotFoundError("Content Asset Library not found");
      return mapLibrary(result.rows[0]);
    } finally { client.release(); }
  }

  async listLibraries(accountId: string, brandId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const result = await client.query(`select * from content_asset_libraries where workspace_id=$1 and brand_id=$2 order by lower(name),id`, [workspaceId, brandId]);
      return result.rows.map(mapLibrary);
    } finally { client.release(); }
  }

  async getLibrary(accountId: string, brandId: string, libraryId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const result = await client.query(`select * from content_asset_libraries where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId, brandId, libraryId]);
      return result.rows[0] ? mapLibrary(result.rows[0]) : null;
    } finally { client.release(); }
  }

  async listAssets(accountId: string, brandId: string, query: ContentAssetLibraryQuery = {}) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const values: unknown[] = [workspaceId, brandId];
      const clauses = ["workspace_id=$1", "brand_id=$2"];
      if (query.libraryId) { values.push(query.libraryId); clauses.push(`library_id=$${values.length}`); }
      if (query.kind) { values.push(query.kind); clauses.push(`kind=$${values.length}`); }
      if (query.query) { values.push(`%${escapeLike(query.query)}%`); clauses.push(`(lower(name) like $${values.length} escape '\\' or lower(mime_type) like $${values.length} escape '\\')`); }
      const result = await client.query(`select * from content_library_assets where ${clauses.join(" and ")} order by modified_at desc nulls last, lower(name), id`, values);
      return result.rows.map(mapAsset);
    } finally { client.release(); }
  }

  async getAssetsByIds(accountId: string, brandId: string, assetIds: string[]) {
    if (!assetIds.length) return [];
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const result = await client.query(
        `select * from content_library_assets where workspace_id=$1 and brand_id=$2 and id=any($3::text[])`,
        [workspaceId, brandId, assetIds],
      );
      return result.rows.map(mapAsset);
    } finally { client.release(); }
  }

  async replaceIndexedAssets(accountId: string, library: ContentAssetLibrary, assets: ContentLibraryAsset[]) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, library.brandId);
      if (workspaceId !== library.workspaceId) throw new ResourceNotFoundError("Brand not found");
      await client.query("begin");
      try {
        await client.query(`delete from content_library_assets where workspace_id=$1 and brand_id=$2 and library_id=$3`, [workspaceId, library.brandId, library.id]);
        for (const asset of assets) {
          if (asset.workspaceId !== workspaceId || asset.brandId !== library.brandId || asset.libraryId !== library.id) throw new ResourceNotFoundError("Content Asset Library not found");
          await client.query(
            `insert into content_library_assets(id,workspace_id,brand_id,library_id,external_id,name,kind,mime_type,size_bytes,modified_at,provider_ref,preview_ref,indexed_at)
             values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [asset.id,asset.workspaceId,asset.brandId,asset.libraryId,asset.externalId,asset.name,asset.kind,asset.mimeType,asset.sizeBytes??null,asset.modifiedAt??null,asset.providerRef??null,asset.previewRef??null,asset.indexedAt],
          );
        }
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    } finally { client.release(); }
  }

  async updateProviderState(accountId: string, brandId: string, libraryId: string, input: ContentAssetProviderStateInput) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const result = await client.query(
        `update content_asset_libraries
         set status=$4,
             external_root_ref=case when $5 then null when $6::text is not null then $6 else external_root_ref end,
             provider_label=case when $5 then null when $7::text is not null then $7 else provider_label end,
             updated_at=$8
         where workspace_id=$1 and brand_id=$2 and id=$3
         returning *`,
        [workspaceId,brandId,libraryId,input.status,input.clearRoot===true,input.externalRootRef??null,input.providerLabel??null,new Date().toISOString()],
      );
      if (!result.rows[0]) throw new ResourceNotFoundError("Content Asset Library not found");
      return mapLibrary(result.rows[0]);
    } finally { client.release(); }
  }

  async clearIndexedAssets(accountId: string, brandId: string, libraryId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const exists = await client.query(`select 1 from content_asset_libraries where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId,brandId,libraryId]);
      if (!exists.rowCount) throw new ResourceNotFoundError("Content Asset Library not found");
      await client.query(`delete from content_library_assets where workspace_id=$1 and brand_id=$2 and library_id=$3`, [workspaceId,brandId,libraryId]);
    } finally { client.release(); }
  }
}

async function scope(client: PoolClient, accountId: string, brandId: string) {
  const result = await client.query(
    `select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id where m.account_id=$1 and m.active=true and b.id=$2`,
    [accountId, brandId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("Brand not found");
  return result.rows[0].workspace_id as string;
}

function mapLibrary(row: any): ContentAssetLibrary {
  return { id:row.id,workspaceId:row.workspace_id,brandId:row.brand_id,name:row.name,provider:row.provider,status:row.status,...(row.external_root_ref?{externalRootRef:row.external_root_ref}:{}),...(row.provider_label?{providerLabel:row.provider_label}:{}),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) };
}
function mapAsset(row: any): ContentLibraryAsset {
  return { id:row.id,workspaceId:row.workspace_id,brandId:row.brand_id,libraryId:row.library_id,externalId:row.external_id,name:row.name,kind:row.kind,mimeType:row.mime_type,...(row.size_bytes==null?{}:{sizeBytes:Number(row.size_bytes)}),...(row.modified_at?{modifiedAt:iso(row.modified_at)}:{}),...(row.provider_ref?{providerRef:row.provider_ref}:{}),...(row.preview_ref?{previewRef:row.preview_ref}:{}),indexedAt:iso(row.indexed_at) };
}
function iso(value: Date|string){return value instanceof Date?value.toISOString():new Date(value).toISOString()}
function escapeLike(value:string){return value.toLocaleLowerCase().replace(/[\\%_]/g,(character)=>`\\${character}`)}
