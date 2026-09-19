import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AccountDto,
  BrandBrainFieldDto,
  BrandBrainSection,
  BrandDto,
  CreateWorkspaceWithBrandRequest,
  CreateWorkspaceWithBrandResponse,
  ExternalIdentity,
  KnowledgeSourceDto,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  PutBrandBrainFieldRequest,
  WorkspaceDto,
} from "@kairo/contracts";
import {
  ConcurrencyConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type KairoRepository,
  type PreparedKnowledgeSourceInput,
  type RecordInferredBrandBrainFieldInput,
} from "@kairo/domain";

export class PgKairoRepository implements KairoRepository {
  constructor(private readonly pool: Pool) {}

  async deleteBrand(accountId: string, brandId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const result = await client.query(`delete from brands where id=$1 and workspace_id=$2`, [brandId, workspaceId]);
      if (!result.rowCount) throw new ResourceNotFoundError("Brand not found");
      await client.query("commit");
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async resolveAccount(identity: ExternalIdentity): Promise<AccountDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const identityLockKey = JSON.stringify([identity.provider, identity.subject]);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identityLockKey]);
      const existing = await client.query<AccountRow>(
        `select a.id, a.email, a.display_name from external_identities ei join accounts a on a.id = ei.account_id where ei.provider = $1 and ei.subject = $2`,
        [identity.provider, identity.subject],
      );
      const row = existing.rows[0];
      if (row) { await client.query("commit"); return toAccount(row); }
      const accountId = randomUUID();
      await client.query(`insert into accounts (id, email, display_name) values ($1, $2, $3)`, [accountId, identity.email ?? null, identity.displayName ?? null]);
      await client.query(`insert into external_identities (id, account_id, provider, subject) values ($1, $2, $3, $4)`, [randomUUID(), accountId, identity.provider, identity.subject]);
      await client.query("commit");
      return { id: accountId, ...(identity.email ? { email: identity.email } : {}), ...(identity.displayName ? { displayName: identity.displayName } : {}) };
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async createWorkspaceWithBrand(accountId: string, input: CreateWorkspaceWithBrandRequest): Promise<CreateWorkspaceWithBrandResponse> {
    const client = await this.pool.connect();
    const workspaceId = randomUUID();
    const brandId = randomUUID();
    try {
      await client.query("begin");
      await client.query(`insert into workspaces (id, name) values ($1, $2)`, [workspaceId, input.workspaceName]);
      await client.query(`insert into workspace_memberships (workspace_id, account_id, role, active) values ($1, $2, 'owner', true)`, [workspaceId, accountId]);
      await client.query(`insert into brands (id, workspace_id, name, public_source_url, public_profile_url) values ($1, $2, $3, $4, $5)`, [brandId, workspaceId, input.brandName, input.publicSourceUrl ?? null, input.publicProfileUrl ?? null]);
      await client.query(`insert into audit_events (id, workspace_id, account_id, event_type, subject_id) values ($1, $2, $3, 'workspace_brand.created', $4)`, [randomUUID(), workspaceId, accountId, brandId]);
      await client.query("commit");
      return { workspace: { id: workspaceId, name: input.workspaceName, role: "owner" }, brand: { id: brandId, workspaceId, name: input.brandName, ...(input.publicSourceUrl ? { publicSourceUrl: input.publicSourceUrl } : {}), ...(input.publicProfileUrl ? { publicProfileUrl: input.publicProfileUrl } : {}) } };
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async listWorkspacesForAccount(accountId: string): Promise<WorkspaceDto[]> {
    const result = await this.pool.query<{ id: string; name: string; role: "owner" | "member" }>(
      `select w.id, w.name, m.role from workspace_memberships m join workspaces w on w.id = m.workspace_id where m.account_id = $1 and m.active = true order by w.created_at, w.id`, [accountId]);
    return result.rows;
  }

  async hasWorkspaceAccess(accountId: string, workspaceId: string): Promise<boolean> {
    const result = await this.pool.query<{ allowed: boolean }>(`select exists(select 1 from workspace_memberships where account_id = $1 and workspace_id = $2 and active = true) as allowed`, [accountId, workspaceId]);
    return result.rows[0]?.allowed === true;
  }

  async listBrandsForAccount(accountId: string, workspaceId: string): Promise<BrandDto[]> {
    const result = await this.pool.query<BrandRow>(`select b.id, b.workspace_id, b.name, b.public_source_url, b.public_profile_url from brands b join workspace_memberships m on m.workspace_id = b.workspace_id where m.account_id = $1 and m.active = true and b.workspace_id = $2 order by b.created_at, b.id`, [accountId, workspaceId]);
    return result.rows.map(toBrand);
  }

  async getBrandForAccount(accountId: string, brandId: string): Promise<BrandDto | null> {
    const result = await this.pool.query<BrandRow>(`select b.id, b.workspace_id, b.name, b.public_source_url, b.public_profile_url from brands b join workspace_memberships m on m.workspace_id = b.workspace_id where m.account_id = $1 and m.active = true and b.id = $2`, [accountId, brandId]);
    return result.rows[0] ? toBrand(result.rows[0]) : null;
  }

  async listBrandBrainFields(accountId: string, brandId: string): Promise<BrandBrainFieldDto[]> {
    const result = await this.pool.query<BrainRow>(
      `select f.id, f.workspace_id, f.brand_id, f.section, f.field_key, f.value, f.state, f.version,
              f.confirmed_by_account_id, f.updated_at,
              coalesce(array_agg(fs.source_id order by fs.source_id) filter (where fs.source_id is not null), '{}'::text[]) as source_ids
         from brand_brain_fields f
         join workspace_memberships m on m.workspace_id = f.workspace_id
         left join brand_brain_field_sources fs on fs.field_id = f.id
        where m.account_id = $1 and m.active = true and f.brand_id = $2
        group by f.id, f.workspace_id, f.brand_id, f.section, f.field_key, f.value, f.state, f.version, f.confirmed_by_account_id, f.updated_at
        order by f.section, f.field_key`,
      [accountId, brandId],
    );
    if (!result.rows.length && !(await this.getBrandForAccount(accountId, brandId))) throw new ResourceNotFoundError("Brand not found");
    return result.rows.map(toBrainField);
  }

  async putConfirmedBrandBrainField(accountId: string, brandId: string, fieldKey: string, input: PutBrandBrainFieldRequest): Promise<BrandBrainFieldDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const existing = await client.query<{ id: string; version: number }>(`select id, version from brand_brain_fields where brand_id = $1 and field_key = $2 for update`, [brandId, fieldKey]);
      const row = existing.rows[0];
      assertExpectedVersion(row?.version, input.expectedVersion);
      const fieldId = row?.id ?? randomUUID();
      const version = (row?.version ?? 0) + 1;
      if (row) {
        await client.query(`update brand_brain_fields set section=$1, value=$2, state='confirmed', version=$3, confirmed_by_account_id=$4, updated_at=now() where id=$5`, [input.section, input.value, version, accountId, fieldId]);
      } else {
        await client.query(`insert into brand_brain_fields (id, workspace_id, brand_id, section, field_key, value, state, version, confirmed_by_account_id) values ($1,$2,$3,$4,$5,$6,'confirmed',1,$7)`, [fieldId, workspaceId, brandId, input.section, fieldKey, input.value, accountId]);
      }
      await client.query(`delete from brand_brain_field_sources where field_id = $1`, [fieldId]);
      await audit(client, workspaceId, accountId, "brand_brain.confirmed", fieldId);
      const field = await fetchBrainField(client, accountId, brandId, fieldId);
      await client.query("commit");
      if (!field) throw new Error("Confirmed Brand Brain field was not persisted");
      return field;
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async recordInferredBrandBrainField(accountId: string, brandId: string, input: RecordInferredBrandBrainFieldInput): Promise<BrandBrainFieldDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const validSources = await client.query<{ id: string }>(`select id from knowledge_sources where workspace_id=$1 and brand_id=$2 and status='active' and id = any($3::text[])`, [workspaceId, brandId, input.sourceIds]);
      if (validSources.rows.length !== input.sourceIds.length) throw new ResourceNotFoundError("Knowledge source not found");
      const existing = await client.query<{ id: string; version: number; state: string }>(`select id, version, state from brand_brain_fields where brand_id=$1 and field_key=$2 for update`, [brandId, input.fieldKey]);
      const row = existing.rows[0];
      assertExpectedVersion(row?.version, input.expectedVersion);
      if (row?.state === "confirmed") {
        const field = await fetchBrainField(client, accountId, brandId, row.id);
        await client.query("commit");
        if (!field) throw new Error("Confirmed Brand Brain field disappeared");
        return field;
      }
      const fieldId = row?.id ?? randomUUID();
      const version = (row?.version ?? 0) + 1;
      if (row) {
        await client.query(`update brand_brain_fields set section=$1, value=$2, state='inferred', version=$3, confirmed_by_account_id=null, updated_at=now() where id=$4`, [input.section, input.value, version, fieldId]);
      } else {
        await client.query(`insert into brand_brain_fields (id, workspace_id, brand_id, section, field_key, value, state, version) values ($1,$2,$3,$4,$5,$6,'inferred',1)`, [fieldId, workspaceId, brandId, input.section, input.fieldKey, input.value]);
      }
      await client.query(`delete from brand_brain_field_sources where field_id=$1`, [fieldId]);
      await client.query(`insert into brand_brain_field_sources (workspace_id, brand_id, field_id, source_id) select $1,$2,$3,u.source_id from unnest($4::text[]) as u(source_id)`, [workspaceId, brandId, fieldId, input.sourceIds]);
      const field = await fetchBrainField(client, accountId, brandId, fieldId);
      await client.query("commit");
      if (!field) throw new Error("Inferred Brand Brain field was not persisted");
      return field;
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async listKnowledgeSources(accountId: string, brandId: string): Promise<KnowledgeSourceDto[]> {
    const result = await this.pool.query<SourceRow>(
      `select s.id, s.workspace_id, s.brand_id, s.source_type, s.status, s.title, s.source_url, s.content_type, s.size_bytes, s.content_hash,
              (s.raw_content is not null or s.object_key is not null) as has_private_content, s.created_at, s.updated_at, s.removed_at
         from knowledge_sources s join workspace_memberships m on m.workspace_id=s.workspace_id
        where m.account_id=$1 and m.active=true and s.brand_id=$2 order by s.created_at, s.id`, [accountId, brandId]);
    if (!result.rows.length && !(await this.getBrandForAccount(accountId, brandId))) throw new ResourceNotFoundError("Brand not found");
    return result.rows.map(toSource);
  }

  async listActiveKnowledgeExtractsForBrandBrain(accountId: string, brandId: string) {
    const result = await this.pool.query<{ id: string; title: string | null; source_url: string | null; raw_content: string; content_type: string | null; updated_at: Date | string }>(
      `select s.id, s.title, s.source_url, left(s.raw_content, 20000) as raw_content, s.content_type, s.updated_at
         from knowledge_sources s
         join workspace_memberships m on m.workspace_id=s.workspace_id
        where m.account_id=$1 and m.active=true and s.brand_id=$2 and s.status='active' and s.raw_content is not null
        order by s.updated_at desc, s.id
        limit 5`,
      [accountId, brandId],
    );
    if (!result.rows.length && !(await this.getBrandForAccount(accountId, brandId))) throw new ResourceNotFoundError("Brand not found");
    return result.rows.map((row) => ({ sourceId: row.id, ...(row.title ? { title: row.title } : {}), ...(row.source_url ? { sourceUrl: row.source_url } : {}), excerpt: row.raw_content, ...(row.content_type ? { contentType: row.content_type } : {}), updatedAt: iso(row.updated_at) }));
  }

  async createKnowledgeSource(accountId: string, brandId: string, input: PreparedKnowledgeSourceInput): Promise<KnowledgeSourceDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const sourceId = randomUUID();
      await client.query(
        `insert into knowledge_sources (id,workspace_id,brand_id,source_type,status,title,source_url,raw_content,content_type,size_bytes,content_hash,created_by_account_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [sourceId, workspaceId, brandId, input.type, input.status, input.title ?? null, input.sourceUrl ?? null, input.rawContent ?? null, input.contentType ?? null, input.sizeBytes ?? null, input.contentHash ?? null, accountId],
      );
      await audit(client, workspaceId, accountId, "knowledge_source.created", sourceId);
      const source = await fetchSource(client, accountId, brandId, sourceId);
      await client.query("commit");
      if (!source) throw new Error("Knowledge source was not persisted");
      return source;
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async setKnowledgeSourceStatus(accountId: string, brandId: string, sourceId: string, status: "active" | "disabled"): Promise<KnowledgeSourceDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const current = await client.query<{ status: KnowledgeSourceStatus }>(
        `select s.status from knowledge_sources s join workspace_memberships m on m.workspace_id=s.workspace_id where m.account_id=$1 and m.active=true and s.workspace_id=$2 and s.brand_id=$3 and s.id=$4 for update of s`,
        [accountId, workspaceId, brandId, sourceId],
      );
      const existing = current.rows[0]?.status;
      if (!existing || existing === "removed") throw new ResourceNotFoundError("Knowledge source not found");
      if (existing === "quarantined" || existing === "failed" || existing === "replaced") throw new DomainValidationError(`Knowledge source in ${existing} state cannot be ${status === "active" ? "enabled" : "disabled"}`);
      if (existing !== status) {
        await client.query(`update knowledge_sources set status=$1, updated_at=now() where id=$2`, [status, sourceId]);
        await audit(client, workspaceId, accountId, `knowledge_source.${status === "active" ? "enabled" : "disabled"}`, sourceId);
      }
      const source = await fetchSource(client, accountId, brandId, sourceId);
      await client.query("commit");
      if (!source) throw new Error("Knowledge source disappeared after status change");
      return source;
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }

  async removeKnowledgeSource(accountId: string, brandId: string, sourceId: string): Promise<KnowledgeSourceDto> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = await requireBrandWorkspace(client, accountId, brandId);
      const current = await client.query<{ id: string; status: KnowledgeSourceStatus }>(
        `select s.id, s.status from knowledge_sources s join workspace_memberships m on m.workspace_id=s.workspace_id where m.account_id=$1 and m.active=true and s.workspace_id=$2 and s.brand_id=$3 and s.id=$4 for update of s`,
        [accountId, workspaceId, brandId, sourceId],
      );
      if (!current.rows[0] || current.rows[0].status === "removed") throw new ResourceNotFoundError("Knowledge source not found");
      const affected = await client.query<{ field_id: string }>(`select distinct field_id from brand_brain_field_sources where workspace_id=$1 and brand_id=$2 and source_id=$3`, [workspaceId, brandId, sourceId]);
      const affectedFieldIds = affected.rows.map((row) => row.field_id);
      await client.query(`delete from knowledge_source_derivations where workspace_id=$1 and brand_id=$2 and source_id=$3`, [workspaceId, brandId, sourceId]);
      await client.query(`delete from brand_brain_field_sources where workspace_id=$1 and brand_id=$2 and source_id=$3`, [workspaceId, brandId, sourceId]);
      if (affectedFieldIds.length) {
        await client.query(
          `update brand_brain_fields f set state='stale', version=version+1, updated_at=now()
            where f.id = any($1::text[]) and f.state='inferred'
              and not exists (select 1 from brand_brain_field_sources fs where fs.field_id=f.id)`,
          [affectedFieldIds],
        );
      }
      await client.query(
        `update knowledge_sources set status='removed', title=null, source_url=null, raw_content=null, content_type=null, size_bytes=null, content_hash=null, object_key=null, removed_at=now(), updated_at=now() where id=$1`,
        [sourceId],
      );
      await audit(client, workspaceId, accountId, "knowledge_source.removed", sourceId);
      const source = await fetchSource(client, accountId, brandId, sourceId);
      await client.query("commit");
      if (!source) throw new Error("Knowledge source tombstone was not persisted");
      return source;
    } catch (error) { await safeRollback(client); throw error; } finally { client.release(); }
  }
}

type AccountRow = { id: string; email: string | null; display_name: string | null };
type BrandRow = { id: string; workspace_id: string; name: string; public_source_url: string | null; public_profile_url: string | null };
type BrainRow = {
  id: string; workspace_id: string; brand_id: string; section: BrandBrainSection; field_key: string; value: string;
  state: "inferred" | "confirmed" | "stale"; version: number; confirmed_by_account_id: string | null;
  updated_at: Date | string; source_ids: string[];
};
type SourceRow = {
  id: string; workspace_id: string; brand_id: string; source_type: KnowledgeSourceType; status: KnowledgeSourceStatus;
  title: string | null; source_url: string | null; content_type: string | null; size_bytes: string | number | null;
  content_hash: string | null; has_private_content: boolean; created_at: Date | string; updated_at: Date | string; removed_at: Date | string | null;
};

function toAccount(row: AccountRow): AccountDto { return { id: row.id, ...(row.email ? { email: row.email } : {}), ...(row.display_name ? { displayName: row.display_name } : {}) }; }
function toBrand(row: BrandRow): BrandDto { return { id: row.id, workspaceId: row.workspace_id, name: row.name, ...(row.public_source_url ? { publicSourceUrl: row.public_source_url } : {}), ...(row.public_profile_url ? { publicProfileUrl: row.public_profile_url } : {}) }; }
function toBrainField(row: BrainRow): BrandBrainFieldDto {
  return { id: row.id, workspaceId: row.workspace_id, brandId: row.brand_id, section: row.section, fieldKey: row.field_key, value: row.value, state: row.state, sourceIds: row.source_ids ?? [], version: row.version, updatedAt: iso(row.updated_at), ...(row.confirmed_by_account_id ? { confirmedByAccountId: row.confirmed_by_account_id } : {}) };
}
function toSource(row: SourceRow): KnowledgeSourceDto {
  const size = row.size_bytes === null ? undefined : Number(row.size_bytes);
  return { id: row.id, workspaceId: row.workspace_id, brandId: row.brand_id, type: row.source_type, status: row.status, ...(row.title ? { title: row.title } : {}), ...(row.source_url ? { sourceUrl: row.source_url } : {}), ...(row.content_type ? { contentType: row.content_type } : {}), ...(size !== undefined ? { sizeBytes: size } : {}), ...(row.content_hash ? { contentHash: row.content_hash } : {}), hasPrivateContent: row.has_private_content, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.removed_at ? { removedAt: iso(row.removed_at) } : {}) };
}
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

async function requireBrandWorkspace(client: PoolClient, accountId: string, brandId: string): Promise<string> {
  const result = await client.query<{ workspace_id: string }>(`select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id where m.account_id=$1 and m.active=true and b.id=$2`, [accountId, brandId]);
  const workspaceId = result.rows[0]?.workspace_id;
  if (!workspaceId) throw new ResourceNotFoundError("Brand not found");
  return workspaceId;
}

async function fetchBrainField(client: PoolClient, accountId: string, brandId: string, fieldId: string): Promise<BrandBrainFieldDto | null> {
  const result = await client.query<BrainRow>(
    `select f.id, f.workspace_id, f.brand_id, f.section, f.field_key, f.value, f.state, f.version, f.confirmed_by_account_id, f.updated_at,
            coalesce(array_agg(fs.source_id order by fs.source_id) filter (where fs.source_id is not null), '{}'::text[]) as source_ids
       from brand_brain_fields f join workspace_memberships m on m.workspace_id=f.workspace_id left join brand_brain_field_sources fs on fs.field_id=f.id
      where m.account_id=$1 and m.active=true and f.brand_id=$2 and f.id=$3
      group by f.id, f.workspace_id, f.brand_id, f.section, f.field_key, f.value, f.state, f.version, f.confirmed_by_account_id, f.updated_at`,
    [accountId, brandId, fieldId],
  );
  return result.rows[0] ? toBrainField(result.rows[0]) : null;
}

async function fetchSource(client: PoolClient, accountId: string, brandId: string, sourceId: string): Promise<KnowledgeSourceDto | null> {
  const result = await client.query<SourceRow>(
    `select s.id, s.workspace_id, s.brand_id, s.source_type, s.status, s.title, s.source_url, s.content_type, s.size_bytes, s.content_hash,
            (s.raw_content is not null or s.object_key is not null) as has_private_content, s.created_at, s.updated_at, s.removed_at
       from knowledge_sources s join workspace_memberships m on m.workspace_id=s.workspace_id
      where m.account_id=$1 and m.active=true and s.brand_id=$2 and s.id=$3`, [accountId, brandId, sourceId]);
  return result.rows[0] ? toSource(result.rows[0]) : null;
}

function assertExpectedVersion(actual: number | undefined, expected: number | undefined): void {
  if (expected !== undefined && actual !== expected) throw new ConcurrencyConflictError("Brand Brain field changed; reload and retry");
}

async function audit(client: PoolClient, workspaceId: string, accountId: string, eventType: string, subjectId: string): Promise<void> {
  await client.query(`insert into audit_events (id, workspace_id, account_id, event_type, subject_id) values ($1,$2,$3,$4,$5)`, [randomUUID(), workspaceId, accountId, eventType, subjectId]);
}

async function safeRollback(client: PoolClient): Promise<void> { try { await client.query("rollback"); } catch { /* preserve original error */ } }
