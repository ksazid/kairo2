import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { BrandDto, CreateBrandRequest } from "@kairo/contracts";
import { ResourceNotFoundError } from "@kairo/domain";

export interface BrandCreatorPort {
  createBrand(accountId: string, workspaceId: string, input: CreateBrandRequest): Promise<BrandDto>;
}

export class PgBrandCreator implements BrandCreatorPort {
  constructor(private readonly pool: Pool) {}

  async createBrand(accountId: string, workspaceId: string, input: CreateBrandRequest): Promise<BrandDto> {
    const client = await this.pool.connect();
    const brandId = randomUUID();
    try {
      await client.query("begin");
      const membership = await client.query<{ allowed: boolean }>(
        `select exists(
           select 1 from workspace_memberships
            where workspace_id = $1 and account_id = $2 and active = true
         ) as allowed`,
        [workspaceId, accountId],
      );
      if (membership.rows[0]?.allowed !== true) throw new ResourceNotFoundError("Workspace not found");
      await client.query(
        `insert into brands (id, workspace_id, name, public_source_url, public_profile_url) values ($1, $2, $3, $4, $5)`,
        [brandId, workspaceId, input.brandName, input.publicSourceUrl ?? null, input.publicProfileUrl ?? null],
      );
      await client.query(
        `insert into audit_events (id, workspace_id, account_id, event_type, subject_id)
         values ($1, $2, $3, 'brand.created', $4)`,
        [randomUUID(), workspaceId, accountId, brandId],
      );
      await client.query("commit");
      return {
        id: brandId,
        workspaceId,
        name: input.brandName,
        ...(input.publicSourceUrl ? { publicSourceUrl: input.publicSourceUrl } : {}),
        ...(input.publicProfileUrl ? { publicProfileUrl: input.publicProfileUrl } : {}),
      };
    } catch (error) {
      try { await client.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
