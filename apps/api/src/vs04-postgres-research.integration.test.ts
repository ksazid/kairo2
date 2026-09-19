import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ResourceNotFoundError } from "@kairo/domain";
import { createIdea, createResearchDossier, type Angle } from "@kairo/domain/research";
import { PgKairoRepository } from "./postgres-store";
import { PgResearchRepository } from "./research-postgres-store";

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("PostgreSQL VS-04 Research and Angles repository", () => {
  const pool = new Pool({ connectionString });
  const core = new PgKairoRepository(pool);
  const repository = new PgResearchRepository(pool);

  beforeAll(async () => {
    for (const file of ["0001_identity_workspace_brand.sql", "0002_brand_brain_knowledge.sql", "0003_hunter_discover.sql", "0004_research_angles.sql"]) {
      await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
  });

  beforeEach(async () => {
    await pool.query("truncate angles, claim_evidence, claims, evidence_references, research_dossiers, ideas, brand_opportunity_signals, brand_opportunities, public_signals, knowledge_source_derivations, brand_brain_field_sources, brand_brain_fields, knowledge_sources, audit_events, brands, workspace_memberships, workspaces, external_identities, accounts cascade");
  });

  afterAll(async () => { await pool.end(); });

  async function owner(subject: string) {
    const account = await core.resolveAccount({ provider: "https://issuer.test", subject });
    const created = await core.createWorkspaceWithBrand(account.id, { workspaceName: `${subject} Studio`, brandName: `${subject} Brand` });
    return { account, ...created };
  }

  it("persists lineage and hides guessed cross-Brand Idea IDs", async () => {
    const alice = await owner("alice");
    const bob = await owner("bob");
    const idea = createIdea({ id: "idea-1", workspaceId: alice.workspace.id, brandId: alice.brand.id, title: "Customer question", premise: "Explain it clearly", source: { type: "user" }, createdAt: "2026-08-13T08:00:00.000Z" });

    await repository.createIdea(alice.account.id, idea);
    expect((await repository.getIdea(alice.account.id, alice.brand.id, idea.id))?.source).toEqual({ type: "user" });
    await expect(repository.getIdea(bob.account.id, alice.brand.id, idea.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("persists evidence/Claim lineage and selects one Angle with optimistic versions", async () => {
    const alice = await owner("alice");
    const idea = createIdea({ id: "idea-1", workspaceId: alice.workspace.id, brandId: alice.brand.id, title: "Evidence", premise: "Use supported facts", source: { type: "user" }, createdAt: "2026-08-13T08:00:00.000Z" });
    await repository.createIdea(alice.account.id, idea);
    const dossier = createResearchDossier({
      id: "research-1", workspaceId: alice.workspace.id, brandId: alice.brand.id, ideaId: idea.id,
      summary: "Supported summary", evidence: [{ id: "evidence-1", sourceUrl: "https://example.com/report", sourceTitle: "Report", retrievedAt: "2026-08-13T08:00:00.000Z" }],
      claims: [{ id: "claim-1", text: "The report records a change.", classification: "fact", confidence: 0.9, evidenceStrength: "strong", verificationState: "supported", freshness: "fresh", evidenceIds: ["evidence-1"], firstPersonAuthorization: "not-applicable" }],
      unresolvedUncertainties: ["Long-term impact is unknown."], createdAt: "2026-08-13T08:05:00.000Z",
    });
    await repository.saveResearchDossier(alice.account.id, dossier);

    const base = { workspaceId: alice.workspace.id, brandId: alice.brand.id, ideaId: idea.id, audience: "Founders", objective: "Education", hookDirection: "Lead with evidence", expectedValue: "Clarity", effort: "low" as const, recommendedFormat: "text", recommendedChannel: "linkedin", supportingClaimIds: ["claim-1"], status: "candidate" as const, version: 1 };
    const angles: Angle[] = [
      { ...base, id: "angle-1", title: "Evidence first", framing: "Explain the finding" },
      { ...base, id: "angle-2", title: "Uncertainty first", framing: "Explain what remains unknown" },
    ];
    await repository.saveCandidateAngles(alice.account.id, angles);
    const edited = await repository.editAngleFraming(alice.account.id, alice.brand.id, idea.id, "angle-1", "Explain the verified finding first", 1);
    expect(edited).toMatchObject({ framing: "Explain the verified finding first", version: 2 });
    await expect(repository.editAngleFraming(alice.account.id, alice.brand.id, idea.id, "angle-1", "Stale overwrite", 1)).rejects.toThrow(/version/i);
    const selected = await repository.selectAngle(alice.account.id, alice.brand.id, idea.id, "angle-2", 1);
    expect(selected.filter((angle) => angle.status === "selected").map((angle) => angle.id)).toEqual(["angle-2"]);
    await expect(repository.selectAngle(alice.account.id, alice.brand.id, idea.id, "angle-1", 1)).rejects.toThrow(/version/i);
  });

  it("keeps a fresh Idea idempotent under concurrent Research and Angle persistence", async () => {
    const alice=await owner("concurrent-alice"),idea=createIdea({id:"fresh-concurrent-idea",workspaceId:alice.workspace.id,brandId:alice.brand.id,title:"Fresh concurrent research",premise:"Persist one bounded result",source:{type:"user"},createdAt:"2026-08-22T06:00:00.000Z"});
    await repository.createIdea(alice.account.id,idea);
    const dossier=(suffix:string)=>createResearchDossier({id:`research-${suffix}`,workspaceId:alice.workspace.id,brandId:alice.brand.id,ideaId:idea.id,summary:`Supported summary ${suffix}`,evidence:[{id:`evidence-${suffix}`,sourceUrl:`https://example.com/${suffix}`,sourceTitle:`Source ${suffix}`,retrievedAt:"2026-08-22T06:01:00.000Z"}],claims:[{id:`claim-${suffix}`,text:`Supported claim ${suffix}.`,classification:"fact",confidence:.9,evidenceStrength:"strong",verificationState:"supported",freshness:"fresh",evidenceIds:[`evidence-${suffix}`],firstPersonAuthorization:"not-applicable"}],unresolvedUncertainties:["The bounded test does not establish causation."],createdAt:"2026-08-22T06:02:00.000Z"});
    await Promise.all([repository.saveResearchDossier(alice.account.id,dossier("a")),repository.saveResearchDossier(alice.account.id,dossier("b"))]);
    const persisted=await repository.getIdeaBundle(alice.account.id,alice.brand.id,idea.id);
    expect(persisted?.research).not.toBeNull();
    expect((await pool.query(`select count(*)::int count from research_dossiers where idea_id=$1`,[idea.id])).rows[0]?.count).toBe(1);
    const claimId=persisted!.research!.claims[0]!.id,base={workspaceId:alice.workspace.id,brandId:alice.brand.id,ideaId:idea.id,audience:"Owners",objective:"Education",hookDirection:"Evidence first",expectedValue:"Clarity",effort:"low"as const,recommendedFormat:"carousel",recommendedChannel:"instagram",supportingClaimIds:[claimId],status:"candidate"as const,version:1};
    const angles=(suffix:string):Angle[]=>[{...base,id:`angle-${suffix}-1`,title:`Angle ${suffix} one`,framing:"First bounded frame"},{...base,id:`angle-${suffix}-2`,title:`Angle ${suffix} two`,framing:"Second bounded frame"}];
    await Promise.all([repository.saveCandidateAngles(alice.account.id,angles("a")),repository.saveCandidateAngles(alice.account.id,angles("b"))]);
    const rows=await pool.query(`select id from angles where idea_id=$1 order by id`,[idea.id]);
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map(row=>String(row.id).split("-")[1])).size).toBe(1);
  });
});
