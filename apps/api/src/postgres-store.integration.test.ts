import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgKairoRepository } from "./postgres-store";

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("PostgreSQL VS-01 repository", () => {
  const pool = new Pool({ connectionString });
  const repository = new PgKairoRepository(pool);

  beforeAll(async () => {
    const migration = await readFile(new URL("../migrations/0001_identity_workspace_brand.sql", import.meta.url), "utf8");
    await pool.query(migration);
  });

  beforeEach(async () => {
    await pool.query("truncate audit_events, brands, workspace_memberships, workspaces, external_identities, accounts cascade");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reuses one account for the same provider subject", async () => {
    const first = await repository.resolveAccount({ provider: "https://issuer.test", subject: "alice", email: "alice@example.com" });
    const second = await repository.resolveAccount({ provider: "https://issuer.test", subject: "alice", email: "alice@example.com" });
    expect(second.id).toBe(first.id);

    const count = await pool.query<{ count: string }>("select count(*)::text as count from accounts");
    expect(count.rows[0]?.count).toBe("1");
  });

  it("serializes concurrent first login for the same external identity", async () => {
    const identity = { provider: "https://issuer.test", subject: "concurrent-user", email: "same@example.com" };
    const [first, second] = await Promise.all([
      repository.resolveAccount(identity),
      repository.resolveAccount(identity),
    ]);

    expect(second.id).toBe(first.id);
    const count = await pool.query<{ count: string }>("select count(*)::text as count from accounts");
    expect(count.rows[0]?.count).toBe("1");
  });

  it("creates Workspace ownership and Brand atomically", async () => {
    const account = await repository.resolveAccount({ provider: "https://issuer.test", subject: "alice" });
    const created = await repository.createWorkspaceWithBrand(account.id, {
      workspaceName: "Studio",
      brandName: "Kairo",
    });

    expect(created.workspace.role).toBe("owner");
    expect(await repository.hasWorkspaceAccess(account.id, created.workspace.id)).toBe(true);
    expect(await repository.getBrandForAccount(account.id, created.brand.id)).toMatchObject({ name: "Kairo" });

    const audit = await pool.query<{ event_type: string }>("select event_type from audit_events where workspace_id = $1", [created.workspace.id]);
    expect(audit.rows).toEqual([{ event_type: "workspace_brand.created" }]);
  });

  it("does not return a foreign Workspace or Brand through tenant-scoped queries", async () => {
    const alice = await repository.resolveAccount({ provider: "https://issuer.test", subject: "alice" });
    const bob = await repository.resolveAccount({ provider: "https://issuer.test", subject: "bob" });
    const created = await repository.createWorkspaceWithBrand(alice.id, { workspaceName: "Studio", brandName: "Private" });

    expect(await repository.hasWorkspaceAccess(bob.id, created.workspace.id)).toBe(false);
    expect(await repository.listBrandsForAccount(bob.id, created.workspace.id)).toEqual([]);
    expect(await repository.getBrandForAccount(bob.id, created.brand.id)).toBeNull();
  });
});
