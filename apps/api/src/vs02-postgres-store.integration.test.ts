import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ResourceNotFoundError } from "@kairo/domain";
import { PgKairoRepository } from "./postgres-store";

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("PostgreSQL VS-02 Brand Brain and Knowledge repository", () => {
  const pool = new Pool({ connectionString });
  const repository = new PgKairoRepository(pool);

  beforeAll(async () => {
    for (const file of ["0001_identity_workspace_brand.sql", "0002_brand_brain_knowledge.sql"]) {
      await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
  });

  beforeEach(async () => {
    await pool.query("truncate knowledge_source_derivations, brand_brain_field_sources, brand_brain_fields, knowledge_sources, audit_events, brands, workspace_memberships, workspaces, external_identities, accounts cascade");
  });

  afterAll(async () => { await pool.end(); });

  async function owner(subject = "alice") {
    const account = await repository.resolveAccount({ provider: "https://issuer.test", subject });
    const created = await repository.createWorkspaceWithBrand(account.id, { workspaceName: `${subject} Studio`, brandName: `${subject} Brand` });
    return { account, ...created };
  }

  it("scopes Brand Brain and Knowledge reads to active Workspace membership", async () => {
    const alice = await owner("alice");
    const bob = await owner("bob");
    await repository.putConfirmedBrandBrainField(alice.account.id, alice.brand.id, "voice.tone", { section: "voice", value: "Clear" });
    await repository.createKnowledgeSource(alice.account.id, alice.brand.id, { type: "note", status: "active", title: "Private", rawContent: "Secret positioning" });

    await expect(repository.listBrandBrainFields(bob.account.id, alice.brand.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(repository.listKnowledgeSources(bob.account.id, alice.brand.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(await repository.listBrandBrainFields(alice.account.id, alice.brand.id)).toHaveLength(1);
    expect(await repository.listKnowledgeSources(alice.account.id, alice.brand.id)).toHaveLength(1);
  });

  it("applies DEC-006 atomically and leaves a content-free source tombstone", async () => {
    const { account, brand } = await owner();
    const source = await repository.createKnowledgeSource(account.id, brand.id, { type: "note", status: "active", title: "Audience research", rawContent: "Audience is SaaS founders" });
    const inferred = await repository.recordInferredBrandBrainField(account.id, brand.id, { section: "audience", fieldKey: "audience.primary", value: "SaaS founders", sourceIds: [source.id] });
    const confirmed = await repository.putConfirmedBrandBrainField(account.id, brand.id, "voice.tone", { section: "voice", value: "Technical" });
    await pool.query(`insert into knowledge_source_derivations (id,workspace_id,brand_id,source_id,derivation_type,locator) values ('derivation-1',$1,$2,$3,'chunk','chunk:1')`, [brand.workspaceId, brand.id, source.id]);

    const removed = await repository.removeKnowledgeSource(account.id, brand.id, source.id);
    expect(removed).toMatchObject({ status: "removed", hasPrivateContent: false });
    expect(removed).not.toHaveProperty("title");

    const persistedSource = await pool.query<{ title: string | null; source_url: string | null; raw_content: string | null; content_hash: string | null; object_key: string | null }>(`select title,source_url,raw_content,content_hash,object_key from knowledge_sources where id=$1`, [source.id]);
    expect(persistedSource.rows[0]).toEqual({ title: null, source_url: null, raw_content: null, content_hash: null, object_key: null });
    const derivations = await pool.query<{ count: string }>(`select count(*)::text as count from knowledge_source_derivations where source_id=$1`, [source.id]);
    expect(derivations.rows[0]?.count).toBe("0");

    const fields = await repository.listBrandBrainFields(account.id, brand.id);
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: inferred.id, state: "stale", sourceIds: [] }),
      expect.objectContaining({ id: confirmed.id, state: "confirmed", value: "Technical", sourceIds: [] }),
    ]));
    const audit = await pool.query<{ event_type: string }>(`select event_type from audit_events where subject_id=$1 order by created_at`, [source.id]);
    expect(audit.rows.map((row) => row.event_type)).toEqual(["knowledge_source.created", "knowledge_source.removed"]);
  });

  it("never downgrades a user-confirmed field when a later inference targets the same key", async () => {
    const { account, brand } = await owner();
    const source = await repository.createKnowledgeSource(account.id, brand.id, { type: "note", status: "active", rawContent: "Tone should be playful" });
    const confirmed = await repository.putConfirmedBrandBrainField(account.id, brand.id, "voice.tone", { section: "voice", value: "Technical" });
    const result = await repository.recordInferredBrandBrainField(account.id, brand.id, { section: "voice", fieldKey: "voice.tone", value: "Playful", sourceIds: [source.id], expectedVersion: confirmed.version });
    expect(result).toMatchObject({ state: "confirmed", value: "Technical", version: confirmed.version });
  });

  it("keeps document metadata quarantined and blocks activation before a clean scan path exists", async () => {
    const { account, brand } = await owner();
    const source = await repository.createKnowledgeSource(account.id, brand.id, { type: "document", status: "quarantined", title: "Guide", contentType: "application/pdf", sizeBytes: 1024, contentHash: "d".repeat(64) });
    expect(source.status).toBe("quarantined");
    await expect(repository.setKnowledgeSourceStatus(account.id, brand.id, source.id, "active")).rejects.toThrow(/quarantined/);
  });
});
