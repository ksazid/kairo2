import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const approvedMigrations = new Set([
  "0022_marketing_shadow_evidence_authorizations.sql",
  "0030_home_media_inputs.sql",
  "0031_brand_intelligence_topic_graph.sql",
  "0032_hunter_opportunity_details.sql",
  "0033_opportunity_feedback_closed_loop.sql",
  "0034_brand_delete_cascade.sql",
  "0037_opportunity_concept_mockups.sql",
  "0038_opportunity_concept_mockup_assets.sql",
]);
const approvedRanges = new Set([
  "0023_meta_multichannel_connections.sql..0028_performance_pattern_memory.sql",
  "0029_brand_presenters.sql..0030_home_media_inputs.sql",
  "0034_brand_delete_cascade.sql..0036_hunter_run_records.sql",
  "0039_hunter_feedback_v2.sql..0043_hunter_eei_metrics.sql",
]);
const approvedMarketingAuthorization = "vs23-qualification-20260820-d";
const approvedMarketingEvidenceExport = "vs23-qualification-20260820-d";
const approvedMarketingQualityAuthorization = "vs65-quality-evaluation-20260820-b";
const approvedClosedLoopSmoke = "vs104-closed-loop-production-smoke-20260826";
const requestedMigration = process.env.KAIRO_STARTUP_MIGRATION?.trim();
const requestedRange = process.env.KAIRO_STARTUP_MIGRATION_RANGE?.trim();
const requestedMarketingAuthorization = process.env.KAIRO_STARTUP_MARKETING_SHADOW_AUTHORIZATION?.trim();
const requestedMarketingEvidenceExport = process.env.KAIRO_STARTUP_MARKETING_SHADOW_EVIDENCE_EXPORT?.trim();
const requestedMarketingQualityAuthorization = process.env.KAIRO_STARTUP_MARKETING_SHADOW_QUALITY_AUTHORIZATION?.trim();
const requestedClosedLoopSmoke = process.env.KAIRO_STARTUP_CLOSED_LOOP_SMOKE?.trim();
const instagramPublisherEnabled = process.env.KAIRO_INSTAGRAM_PUBLISHER_ENABLED?.trim() === "true";

const startupActionCount = [
  requestedMigration,
  requestedRange,
  requestedMarketingAuthorization,
  requestedMarketingEvidenceExport,
  requestedMarketingQualityAuthorization,
  requestedClosedLoopSmoke,
].filter(Boolean).length;
if (startupActionCount > 1) {
  throw new Error("Configure only one startup action: exact migration, migration range, Marketing Lab authorization, Marketing Lab evidence export, Marketing Lab quality authorization, or closed-loop production smoke");
}

const startupActionRequested = startupActionCount === 1;
if (startupActionRequested && process.env.RENDER === "true") {
  const releaseSha = process.env.KAIRO_RELEASE_SHA?.trim();
  const renderSha = process.env.RENDER_GIT_COMMIT?.trim();
  if (!releaseSha || !/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error("KAIRO_RELEASE_SHA must be an exact lowercase 40-character SHA");
  if (!renderSha || !/^[0-9a-f]{40}$/.test(renderSha)) throw new Error("RENDER_GIT_COMMIT must be an exact lowercase 40-character SHA");
  if (releaseSha !== renderSha) throw new Error("Startup action release SHA does not match RENDER_GIT_COMMIT");
}

async function runStartupScript(scriptUrl, label) {
  const scriptPath = fileURLToPath(scriptUrl);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${label} terminated by signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) throw new Error(`${label} failed with exit code ${exitCode}`);
}

function runBackgroundScript(scriptUrl, label) {
  const scriptPath = fileURLToPath(scriptUrl);
  const child = spawn(process.execPath, [scriptPath], { stdio: "inherit", env: process.env });
  child.once("error", (error) => {
    console.error(`${label} failed to start: ${error instanceof Error ? error.name : "unknown-error"}`);
  });
  child.once("exit", (code, signal) => {
    if (signal) console.error(`${label} terminated by signal ${signal}`);
    else if ((code ?? 1) !== 0) console.error(`${label} failed with exit code ${code ?? 1}`);
  });
}

async function runClosedLoopProductionSmoke() {
  if (requestedClosedLoopSmoke !== approvedClosedLoopSmoke) {
    throw new Error(`Startup closed-loop production smoke is not approved: ${requestedClosedLoopSmoke}`);
  }
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for closed-loop production smoke");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  let inTransaction = false;
  let insertedIdeaId;
  try {
    await client.query("begin");
    inTransaction = true;
    // Build a fully isolated fixture inside the transaction. Production may have zero opportunities.
    const smokeAccountId = randomUUID();
    const smokeWorkspaceId = randomUUID();
    const smokeBrandId = randomUUID();
    const smokeOpportunityId = randomUUID();
    await client.query(
      `insert into accounts(id,email,display_name) values($1,$2,$3)`,
      [smokeAccountId, `closed-loop-smoke-${smokeAccountId}@invalid.local`, "[SMOKE] Closed Loop"],
    );
    await client.query(
      `insert into workspaces(id,name) values($1,$2)`,
      [smokeWorkspaceId, "[SMOKE] Closed Loop Workspace"],
    );
    await client.query(
      `insert into workspace_memberships(workspace_id,account_id,role,active) values($1,$2,'owner',true)`,
      [smokeWorkspaceId, smokeAccountId],
    );
    await client.query(
      `insert into brands(id,workspace_id,name,public_source_url) values($1,$2,$3,$4)`,
      [smokeBrandId, smokeWorkspaceId, "[SMOKE] Closed Loop Brand", "https://example.invalid/smoke"],
    );
    await client.query(
      `insert into brand_opportunities(
         id,workspace_id,brand_id,title,rationale,why_now,development_direction,status,
         relevance,evidence,novelty,timeliness,brand_authority,audience_fit,overall,
         scoring_version,brand_context_version,created_at
       ) values($1,$2,$3,$4,$5,$6,$7,'new',0.9,0.9,0.8,0.9,0.8,0.9,0.86,$8,$9,now())`,
      [
        smokeOpportunityId,
        smokeWorkspaceId,
        smokeBrandId,
        "[SMOKE] Closed Loop Opportunity",
        "Transactional smoke fixture",
        "Transactional smoke fixture",
        "Transactional smoke fixture",
        "smoke",
        "smoke",
      ],
    );
    const row = {
      account_id: smokeAccountId,
      workspace_id: smokeWorkspaceId,
      brand_id: smokeBrandId,
      opportunity_id: smokeOpportunityId,
      title: "[SMOKE] Closed Loop Opportunity",
      rationale: "Transactional smoke fixture",
      why_now: "Transactional smoke fixture",
      development_direction: "Transactional smoke fixture",
      status: "new",
    };

    const feedbackId = randomUUID();
    const firstFeedback = await client.query(
      `insert into opportunity_feedback_events(id,workspace_id,brand_id,opportunity_id,account_id,action)
       values($1,$2,$3,$4,$5,'seen')
       on conflict(workspace_id,brand_id,opportunity_id,account_id,action) do nothing`,
      [feedbackId, row.workspace_id, row.brand_id, row.opportunity_id, row.account_id],
    );
    if (firstFeedback.rowCount !== 1) throw new Error("Closed-loop production smoke could not persist representative Seen feedback");
    const duplicateFeedback = await client.query(
      `insert into opportunity_feedback_events(id,workspace_id,brand_id,opportunity_id,account_id,action)
       values($1,$2,$3,$4,$5,'seen')
       on conflict(workspace_id,brand_id,opportunity_id,account_id,action) do nothing`,
      [randomUUID(), row.workspace_id, row.brand_id, row.opportunity_id, row.account_id],
    );
    if (duplicateFeedback.rowCount !== 0) throw new Error("Closed-loop production smoke idempotency check failed");
    const visibleFeedback = await client.query(
      `select f.action,o.title from opportunity_feedback_events f
         join brand_opportunities o on o.workspace_id=f.workspace_id and o.brand_id=f.brand_id and o.id=f.opportunity_id
        where f.id=$1`,
      [feedbackId],
    );
    if (visibleFeedback.rows[0]?.action !== "seen") throw new Error("Closed-loop production smoke feedback lineage check failed");

    const existingIdea = await client.query(
      `select id from ideas where workspace_id=$1 and brand_id=$2 and source_type='opportunity' and opportunity_id=$3 order by created_at,id limit 1`,
      [row.workspace_id, row.brand_id, row.opportunity_id],
    );
    let ideaId = existingIdea.rows[0]?.id;
    if (!ideaId) {
      ideaId = randomUUID();
      insertedIdeaId = ideaId;
      const premise = `${row.development_direction}\n\nWhy now: ${row.why_now}\n\nContext: ${row.rationale}`.slice(0, 2_000);
      await client.query(
        `insert into ideas(id,workspace_id,brand_id,title,premise,source_type,opportunity_id,status,created_at)
         values($1,$2,$3,$4,$5,'opportunity',$6,'new',now())`,
        [ideaId, row.workspace_id, row.brand_id, `[SMOKE] ${row.title}`.slice(0, 300), premise, row.opportunity_id],
      );
    }
    const lineage = await client.query(
      `select i.id,i.opportunity_id,o.brand_id from ideas i
         join brand_opportunities o on o.workspace_id=i.workspace_id and o.brand_id=i.brand_id and o.id=i.opportunity_id
        where i.id=$1 and i.workspace_id=$2 and i.brand_id=$3`,
      [ideaId, row.workspace_id, row.brand_id],
    );
    if (lineage.rows[0]?.opportunity_id !== row.opportunity_id || lineage.rows[0]?.brand_id !== row.brand_id) {
      throw new Error("Closed-loop production smoke Opportunity-to-Idea lineage check failed");
    }
    await client.query(
      `update brand_opportunities set status='developing',updated_at=now() where workspace_id=$1 and brand_id=$2 and id=$3`,
      [row.workspace_id, row.brand_id, row.opportunity_id],
    );
    const developed = await client.query(
      `select status from brand_opportunities where workspace_id=$1 and brand_id=$2 and id=$3`,
      [row.workspace_id, row.brand_id, row.opportunity_id],
    );
    if (developed.rows[0]?.status !== "developing") throw new Error("Closed-loop production smoke development-state check failed");

    await client.query("rollback");
    inTransaction = false;
    const persistedFeedback = await client.query(`select 1 from opportunity_feedback_events where id=$1`, [feedbackId]);
    if (persistedFeedback.rowCount !== 0) throw new Error("Closed-loop production smoke rollback left feedback behind");
    if (insertedIdeaId) {
      const persistedIdea = await client.query(`select 1 from ideas where id=$1`, [insertedIdeaId]);
      if (persistedIdea.rowCount !== 0) throw new Error("Closed-loop production smoke rollback left an Idea behind");
    }
    const fixture = await client.query(
      `select
         (select count(*) from accounts where id=$1) +
         (select count(*) from workspaces where id=$2) +
         (select count(*) from brands where id=$3) +
         (select count(*) from brand_opportunities where id=$4) as count`,
      [smokeAccountId, smokeWorkspaceId, smokeBrandId, smokeOpportunityId],
    );
    if (Number(fixture.rows[0]?.count ?? 0) !== 0) throw new Error("Closed-loop production smoke rollback left fixture data behind");
    console.log(JSON.stringify({ event: "KAIRO_CLOSED_LOOP_SMOKE_PASSED", feedback: true, idempotency: true, opportunityIdeaLineage: true, rollbackClean: true, fixtureClean: true }));
  } catch (error) {
    if (inTransaction) {
      try { await client.query("rollback"); } catch { /* keep original smoke error */ }
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (requestedMigration) {
  if (!approvedMigrations.has(requestedMigration)) throw new Error(`Startup migration is not approved: ${requestedMigration}`);
  await runStartupScript(new URL("./migrate-exact.mjs", import.meta.url), `exact migration ${requestedMigration}`);
} else if (requestedRange) {
  if (!approvedRanges.has(requestedRange)) throw new Error(`Startup migration range is not approved: ${requestedRange}`);
  await runStartupScript(new URL("./migrate-range.mjs", import.meta.url), `migration range ${requestedRange}`);
} else if (requestedMarketingAuthorization) {
  if (requestedMarketingAuthorization !== approvedMarketingAuthorization) {
    throw new Error(`Startup Marketing Lab authorization is not approved: ${requestedMarketingAuthorization}`);
  }
  await runStartupScript(
    new URL("./authorize-marketing-shadow-evidence.mjs", import.meta.url),
    `Marketing Lab authorization ${requestedMarketingAuthorization}`,
  );
} else if (requestedMarketingEvidenceExport) {
  if (requestedMarketingEvidenceExport !== approvedMarketingEvidenceExport) {
    throw new Error(`Startup Marketing Lab evidence export is not approved: ${requestedMarketingEvidenceExport}`);
  }
  await runStartupScript(
    new URL("./export-marketing-shadow-evidence.mjs", import.meta.url),
    `Marketing Lab evidence export ${requestedMarketingEvidenceExport}`,
  );
} else if (requestedMarketingQualityAuthorization) {
  if (requestedMarketingQualityAuthorization !== approvedMarketingQualityAuthorization) {
    throw new Error(`Startup Marketing Lab quality authorization is not approved: ${requestedMarketingQualityAuthorization}`);
  }
  await runStartupScript(
    new URL("./authorize-marketing-shadow-quality-evaluation.mjs", import.meta.url),
    `Marketing Lab quality evaluation ${requestedMarketingQualityAuthorization}`,
  );
  runBackgroundScript(
    new URL("../apps/api/dist/marketing-shadow-quality-evaluation-worker.js", import.meta.url),
    `Marketing Lab quality evaluation ${requestedMarketingQualityAuthorization}`,
  );
} else if (requestedClosedLoopSmoke) {
  await runClosedLoopProductionSmoke();
}

if (instagramPublisherEnabled) {
  runBackgroundScript(
    new URL("../apps/api/dist/publishing-worker-server.js", import.meta.url),
    "Instagram publisher",
  );
}

await import(new URL("../apps/api/dist/server.js", import.meta.url));
