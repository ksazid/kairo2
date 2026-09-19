import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ResourceNotFoundError } from "@kairo/domain";
import { DiscoveryService } from "@kairo/domain/discovery-service";
import { preparePublicSignal } from "@kairo/domain/discovery";
import { PgDiscoveryRepository } from "./discovery-postgres-store";
import { PgKairoRepository } from "./postgres-store";

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("PostgreSQL VS-03 Hunter and Discover repository", () => {
  const pool = new Pool({ connectionString });
  const core = new PgKairoRepository(pool);
  const repository = new PgDiscoveryRepository(pool);
  const service = new DiscoveryService(repository);

  beforeAll(async () => {
    for (const file of ["0001_identity_workspace_brand.sql", "0002_brand_brain_knowledge.sql", "0003_hunter_discover.sql"]) {
      await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
  });

  beforeEach(async () => {
    await pool.query(
      "truncate brand_opportunity_signals, brand_opportunities, public_signals, knowledge_source_derivations, brand_brain_field_sources, brand_brain_fields, knowledge_sources, audit_events, brands, workspace_memberships, workspaces, external_identities, accounts cascade",
    );
  });

  afterAll(async () => { await pool.end(); });

  async function owner(subject: string) {
    const account = await core.resolveAccount({ provider: "https://issuer.test", subject });
    const created = await core.createWorkspaceWithBrand(account.id, { workspaceName: `${subject} Studio`, brandName: `${subject} Brand` });
    return { account, ...created };
  }

  const scores = { relevance: 0.9, evidence: 0.8, novelty: 0.8, timeliness: 0.8, brandAuthority: 0.7, audienceFit: 0.9 };

  it("reuses one global public Signal across isolated Brand Opportunities", async () => {
    const alice = await owner("alice");
    const bob = await owner("bob");
    const commonSignal = {
      title: "Agent runtimes become persistent",
      sourceUrl: "https://example.com/persistent-agents?utm_source=test",
      platform: "web",
      retrievedAt: "2026-08-13T00:00:00.000Z",
      provider: "fixture",
      contentHash: "a".repeat(64),
    };

    await service.recordCandidate(alice.account.id, alice.brand.id, {
      signal: commonSignal,
      title: "Persistent agents for SaaS architecture",
      rationale: "Relevant to technical founders",
      whyNow: "Runtime behavior is changing",
      developmentDirection: "Architecture tradeoffs for founders",
      brandContextVersion: "alice@1",
      scores,
    });
    await service.recordCandidate(bob.account.id, bob.brand.id, {
      signal: commonSignal,
      title: "Persistent agents for product teams",
      rationale: "Relevant to product teams",
      whyNow: "New workflows are possible",
      developmentDirection: "Beginner product implications",
      brandContextVersion: "bob@1",
      scores,
    });

    const signalCount = await pool.query<{ count: string }>("select count(*)::text as count from public_signals");
    expect(signalCount.rows[0]?.count).toBe("1");
    expect(await repository.listBrandOpportunities(alice.account.id, alice.brand.id)).toHaveLength(1);
    expect(await repository.listBrandOpportunities(bob.account.id, bob.brand.id)).toHaveLength(1);
    await expect(repository.listBrandOpportunities(bob.account.id, alice.brand.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("deduplicates concurrent public Signal ingestion deterministically", async () => {
    const prepared = preparePublicSignal({
      title: "Same public evidence",
      sourceUrl: "https://example.com/same?utm_campaign=one",
      platform: "web",
      retrievedAt: "2026-08-13T00:00:00.000Z",
      provider: "fixture",
      contentHash: "b".repeat(64),
    });
    const [first, second] = await Promise.all([
      repository.upsertPublicSignal(prepared),
      repository.upsertPublicSignal(prepared),
    ]);
    expect(first.id).toBe(second.id);
    const count = await pool.query<{ count: string }>("select count(*)::text as count from public_signals");
    expect(count.rows[0]?.count).toBe("1");
  });

  it("persists bounded Opportunity actions with audit provenance", async () => {
    const alice = await owner("alice");
    const created = await service.recordCandidate(alice.account.id, alice.brand.id, {
      signal: {
        title: "Strong evidence",
        sourceUrl: "https://example.com/strong",
        platform: "web",
        retrievedAt: "2026-08-13T00:00:00.000Z",
        provider: "fixture",
      },
      title: "Strong opportunity",
      rationale: "High fit",
      whyNow: "Current evidence",
      developmentDirection: "Technical founder explanation",
      brandContextVersion: "alice@1",
      scores,
    });
    const id = created.opportunity!.id;
    expect((await service.act(alice.account.id, alice.brand.id, id, "save")).status).toBe("saved");
    expect((await service.act(alice.account.id, alice.brand.id, id, "develop")).status).toBe("developing");
    const audit = await pool.query<{ event_type: string }>("select event_type from audit_events where subject_id=$1 order by created_at", [id]);
    expect(audit.rows.map((row) => row.event_type)).toEqual(["opportunity.created", "opportunity.saved", "opportunity.developing"]);
  });
});
