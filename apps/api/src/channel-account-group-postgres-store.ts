import type { Pool, PoolClient } from "pg";
import { ResourceNotFoundError } from "@kairo/domain";
import type { ChannelAccountGroup } from "@kairo/domain/channel-account-groups";
import type { ChannelAccountGroupRepository } from "@kairo/domain/channel-account-group-service";

export class PgChannelAccountGroupRepository implements ChannelAccountGroupRepository {
  constructor(private pool: Pool) {}

  async saveChannelAccountGroup(accountId: string, group: ChannelAccountGroup) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, group.brandId);
      if (workspaceId !== group.workspaceId) throw new ResourceNotFoundError("Brand not found");
      const result = await client.query(
        `insert into channel_account_groups(id,workspace_id,brand_id,name,member_account_ids,created_at,updated_at)
         values($1,$2,$3,$4,$5::jsonb,$6,$7)
         on conflict(id) do update set name=excluded.name,member_account_ids=excluded.member_account_ids,updated_at=excluded.updated_at
         where channel_account_groups.workspace_id=excluded.workspace_id and channel_account_groups.brand_id=excluded.brand_id
         returning *`,
        [group.id, group.workspaceId, group.brandId, group.name, JSON.stringify(group.memberAccountIds), group.createdAt, group.updatedAt],
      );
      if (!result.rows[0]) throw new ResourceNotFoundError("Channel Account Group not found");
      return map(result.rows[0]);
    } finally { client.release(); }
  }

  async getChannelAccountGroup(accountId: string, brandId: string, groupId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const result = await client.query(`select * from channel_account_groups where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId, brandId, groupId]);
      return result.rows[0] ? map(result.rows[0]) : null;
    } finally { client.release(); }
  }

  async listChannelAccountGroups(accountId: string, brandId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      const result = await client.query(`select * from channel_account_groups where workspace_id=$1 and brand_id=$2 order by lower(name),id`, [workspaceId, brandId]);
      return result.rows.map(map);
    } finally { client.release(); }
  }

  async deleteChannelAccountGroup(accountId: string, brandId: string, groupId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId);
      await client.query(`delete from channel_account_groups where workspace_id=$1 and brand_id=$2 and id=$3`, [workspaceId, brandId, groupId]);
    } finally { client.release(); }
  }
}

function map(row: any): ChannelAccountGroup {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
    name: row.name,
    memberAccountIds: Array.isArray(row.member_account_ids) ? row.member_account_ids : [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function scope(client: PoolClient, accountId: string, brandId: string) {
  const result = await client.query(
    `select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id where m.account_id=$1 and m.active=true and b.id=$2`,
    [accountId, brandId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("Brand not found");
  return result.rows[0].workspace_id as string;
}

function iso(value: Date | string) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
