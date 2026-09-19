import type { Pool, PoolClient } from "pg";

export class PgIdeaDevelopmentLock {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async run<T>(brandId: string, ideaId: string, work: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const key = `kairo:idea-development:${brandId}:${ideaId}`;
    let locked = false;
    try {
      await client.query("select pg_advisory_lock(hashtext($1))", [key]);
      locked = true;
      return await work();
    } finally {
      if (locked) await unlock(client, key);
      client.release();
    }
  }
}

async function unlock(client: PoolClient, key: string): Promise<void> {
  try {
    await client.query("select pg_advisory_unlock(hashtext($1))", [key]);
  } catch {
    // Releasing the connection also releases a session advisory lock.
  }
}
