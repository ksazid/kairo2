import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ResourceNotFoundError } from "@kairo/domain";
import type { GoogleDriveConnectionRepository, GoogleDriveCredentialVault, GoogleDriveOAuthIntent, GoogleDriveProviderConnection } from "./google-drive-content-assets";

export class PgEncryptedContentAssetCredentialVault implements GoogleDriveCredentialVault {
  private readonly key: Buffer;
  constructor(private readonly pool: Pool, encodedKey: string, private readonly now: () => Date = () => new Date()) { this.key = decodeKey(encodedKey); }

  async store(workspaceId: string, brandId: string, credentialRef: string, plaintext: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad(workspaceId, brandId, credentialRef)));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const at = this.now().toISOString();
    await this.pool.query(
      `insert into content_asset_credentials(credential_ref,workspace_id,brand_id,provider,ciphertext,iv,auth_tag,created_at,updated_at,revoked_at)
       values($1,$2,$3,'google-drive',$4,$5,$6,$7,$7,null)
       on conflict(credential_ref) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,updated_at=excluded.updated_at,revoked_at=null
       where content_asset_credentials.workspace_id=excluded.workspace_id and content_asset_credentials.brand_id=excluded.brand_id`,
      [credentialRef, workspaceId, brandId, encrypted.toString("base64"), iv.toString("base64"), tag.toString("base64"), at],
    );
  }

  async resolve(credentialRef: string) {
    const result = await this.pool.query(`select workspace_id,brand_id,ciphertext,iv,auth_tag from content_asset_credentials where credential_ref=$1 and provider='google-drive' and revoked_at is null`, [credentialRef]);
    const row = result.rows[0];
    if (!row) throw new Error("Content Asset credential is unavailable");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(row.iv, "base64"));
      decipher.setAAD(Buffer.from(aad(row.workspace_id, row.brand_id, credentialRef)));
      decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch { throw new Error("Content Asset credential could not be decrypted"); }
  }

  async revoke(credentialRef: string) {
    const at = this.now().toISOString();
    await this.pool.query(`update content_asset_credentials set revoked_at=coalesce(revoked_at,$2),updated_at=$2 where credential_ref=$1 and provider='google-drive'`, [credentialRef, at]);
  }
}

export class PgGoogleDriveConnectionRepository implements GoogleDriveConnectionRepository {
  constructor(private readonly pool: Pool) {}

  async createIntent(intent: GoogleDriveOAuthIntent) {
    await this.pool.query(
      `insert into content_asset_oauth_intents(id,workspace_id,brand_id,library_id,account_id,provider,state_hash,expires_at,created_at)
       values($1,$2,$3,$4,$5,'google-drive',$6,$7,$8)`,
      [intent.id,intent.workspaceId,intent.brandId,intent.libraryId,intent.accountId,intent.stateHash,intent.expiresAt,intent.createdAt],
    );
  }

  async consumeIntent(accountId: string, stateHash: string, at: string) {
    const result = await this.pool.query(
      `update content_asset_oauth_intents set consumed_at=$3
       where account_id=$1 and state_hash=$2 and provider='google-drive' and consumed_at is null and expires_at >= $3
       returning *`,
      [accountId,stateHash,at],
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async getConnection(accountId: string, brandId: string, libraryId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId, libraryId);
      const result = await client.query(
        `select * from content_asset_provider_connections where workspace_id=$1 and brand_id=$2 and library_id=$3 and provider='google-drive' and revoked_at is null`,
        [workspaceId,brandId,libraryId],
      );
      return result.rows[0] ? mapConnection(result.rows[0]) : null;
    } finally { client.release(); }
  }

  async saveConnection(accountId: string, connection: GoogleDriveProviderConnection) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, connection.brandId, connection.libraryId);
      if (workspaceId !== connection.workspaceId) throw new ResourceNotFoundError("Content Asset Library not found");
      await client.query("begin");
      try {
        const old = await client.query(`select credential_ref from content_asset_provider_connections where workspace_id=$1 and brand_id=$2 and library_id=$3`, [workspaceId,connection.brandId,connection.libraryId]);
        const result = await client.query(
          `insert into content_asset_provider_connections(id,workspace_id,brand_id,library_id,provider,credential_ref,granted_scopes,connected_at,last_verified_at,revoked_at)
           values($1,$2,$3,$4,'google-drive',$5,$6::jsonb,$7,$8,null)
           on conflict(library_id) do update set id=excluded.id,credential_ref=excluded.credential_ref,granted_scopes=excluded.granted_scopes,connected_at=excluded.connected_at,last_verified_at=excluded.last_verified_at,revoked_at=null
           where content_asset_provider_connections.workspace_id=excluded.workspace_id and content_asset_provider_connections.brand_id=excluded.brand_id and content_asset_provider_connections.provider='google-drive'
           returning *`,
          [connection.id,workspaceId,connection.brandId,connection.libraryId,connection.credentialRef,JSON.stringify(connection.grantedScopes),connection.connectedAt,connection.lastVerifiedAt],
        );
        if (!result.rows[0]) throw new ResourceNotFoundError("Content Asset Library not found");
        await client.query("commit");
        const previousCredentialRefs = old.rows.map((row) => row.credential_ref).filter((value): value is string => typeof value === "string" && !!value.trim());
        return { connection: mapConnection(result.rows[0]), previousCredentialRefs };
      } catch (error) { await rollback(client); throw error; }
    } finally { client.release(); }
  }

  async markNeedsAttention(accountId: string, brandId: string, libraryId: string, at: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId, libraryId);
      await client.query(`update content_asset_provider_connections set last_verified_at=$4 where workspace_id=$1 and brand_id=$2 and library_id=$3 and provider='google-drive' and revoked_at is null`, [workspaceId,brandId,libraryId,at]);
    } finally { client.release(); }
  }

  async revokeConnection(accountId: string, brandId: string, libraryId: string, at: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId, libraryId);
      await client.query(`update content_asset_provider_connections set revoked_at=coalesce(revoked_at,$4),last_verified_at=$4 where workspace_id=$1 and brand_id=$2 and library_id=$3 and provider='google-drive'`, [workspaceId,brandId,libraryId,at]);
    } finally { client.release(); }
  }
}

async function scope(client: PoolClient, accountId: string, brandId: string, libraryId: string) {
  const result = await client.query(
    `select b.workspace_id from brands b
     join workspace_memberships m on m.workspace_id=b.workspace_id
     join content_asset_libraries l on l.workspace_id=b.workspace_id and l.brand_id=b.id
     where m.account_id=$1 and m.active=true and b.id=$2 and l.id=$3`,
    [accountId,brandId,libraryId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("Content Asset Library not found");
  return result.rows[0].workspace_id as string;
}
function mapIntent(row: any): GoogleDriveOAuthIntent { return { id:row.id,workspaceId:row.workspace_id,brandId:row.brand_id,libraryId:row.library_id,accountId:row.account_id,provider:"google-drive",stateHash:row.state_hash,expiresAt:iso(row.expires_at),createdAt:iso(row.created_at),...(row.consumed_at?{consumedAt:iso(row.consumed_at)}:{}) }; }
function mapConnection(row: any): GoogleDriveProviderConnection { return { id:row.id,workspaceId:row.workspace_id,brandId:row.brand_id,libraryId:row.library_id,provider:"google-drive",credentialRef:row.credential_ref,grantedScopes:Array.isArray(row.granted_scopes)?row.granted_scopes:[],connectedAt:iso(row.connected_at),lastVerifiedAt:iso(row.last_verified_at),...(row.revoked_at?{revokedAt:iso(row.revoked_at)}:{}) }; }
function decodeKey(value: string) { const key = Buffer.from(value.trim(), "base64"); if (key.length !== 32) throw new Error("CONTENT_ASSET_CREDENTIAL_ENCRYPTION_KEY must be base64 for exactly 32 bytes"); return key; }
function aad(workspaceId: string, brandId: string, credentialRef: string) { return `${workspaceId}\u0000${brandId}\u0000${credentialRef}`; }
function iso(value: Date|string) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
async function rollback(client: PoolClient) { try { await client.query("rollback"); } catch {} }
