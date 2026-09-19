import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAutomationControl,
  createCostEvent,
  createOperationalFailure,
  createWorkflowBudget,
} from "@kairo/domain/operations";
import { PgKairoRepository } from "./postgres-store";
import { PgOperationsRepository } from "./operations-postgres-store";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("PostgreSQL VS-10 operations", () => {
  const pool = new Pool({ connectionString: url });
  const core = new PgKairoRepository(pool);
  const repo = new PgOperationsRepository(pool);

  beforeAll(async () => {
    for (const [file, marker] of [
      ["0001_identity_workspace_brand.sql", "accounts"],
      ["0010_pilot_operations.sql", "operational_failures"],
    ] as const) {
      const exists = await pool.query<{ name: string | null }>(
        "select to_regclass($1)::text name",
        [`public.${marker}`],
      );
      if (!exists.rows[0]?.name) {
        await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
      }
    }
    const trigger = await pool.query(
      "select 1 from pg_trigger where tgname='trg_intervention_server_time' and not tgisinternal",
    );
    if (!trigger.rows[0]) {
      await pool.query(
        await readFile(new URL("../migrations/0012_operations_authoritative_time.sql", import.meta.url), "utf8"),
      );
    }
  });

  beforeEach(() =>
    pool.query(
      "truncate operator_interventions,workflow_cost_events,workflow_budgets,automation_controls,retry_requests,operational_failures,audit_events,brands,workspace_memberships,workspaces,external_identities,accounts cascade",
    ),
  );

  afterAll(() => pool.end());

  async function fixture() {
    const owner = await core.resolveAccount({ provider: "test", subject: "owner" });
    const member = await core.resolveAccount({ provider: "test", subject: "member" });
    const made = await core.createWorkspaceWithBrand(owner.id, {
      workspaceName: "Studio",
      brandName: "Kairo",
    });
    await pool.query(
      "insert into workspace_memberships(workspace_id,account_id,role,active) values($1,$2,'member',true)",
      [made.workspace.id, member.id],
    );
    return { owner, member, ...made };
  }

  it("keeps diagnostics scoped to the workspace owner", async () => {
    const { owner, member, workspace, brand } = await fixture();
    const failure = createOperationalFailure({
      id: "f1",
      workspaceId: workspace.id,
      brandId: brand.id,
      workflowId: "wf1",
      stage: "research",
      diagnosticCode: "provider-timeout",
      summary: "Research provider timed out.",
      retryDisposition: "manual-review",
      attempt: 1,
      maxAttempts: 3,
      occurredAt: "2026-08-13T16:00:00Z",
      traceId: "trace-1",
    });
    await repo.recordFailure(failure);
    expect(await repo.listFailures(owner.id, brand.id)).toEqual([failure]);
    await expect(repo.listFailures(member.id, brand.id)).rejects.toThrow("Pilot operations not found");
    const cols = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name='operational_failures'",
    );
    expect(cols.rows.map((row) => row.column_name)).not.toContain("raw_content");
  });

  it("rejects retry requests that are not explicitly safe", async () => {
    const { owner, workspace, brand } = await fixture();
    await repo.recordFailure(
      createOperationalFailure({
        id: "f1",
        workspaceId: workspace.id,
        brandId: brand.id,
        workflowId: "wf1",
        stage: "research",
        diagnosticCode: "timeout",
        summary: "Research needs review.",
        retryDisposition: "manual-review",
        attempt: 1,
        maxAttempts: 3,
        occurredAt: "2026-08-13T16:00:00Z",
      }),
    );
    await expect(
      repo.requestRetry(owner.id, brand.id, "f1", "retry-1", "2099-01-01T00:00:00Z"),
    ).rejects.toThrow("Failure is not safe to retry");
    expect((await pool.query("select id from retry_requests")).rowCount).toBe(0);
    expect(await repo.listInterventions(owner.id, brand.id)).toHaveLength(0);
  });

  it("accounts cost once and rejects spend beyond the workflow budget", async () => {
    const { owner, workspace, brand } = await fixture();
    const budget = createWorkflowBudget({
      id: "b1",
      workspaceId: workspace.id,
      brandId: brand.id,
      workflowId: "wf1",
      currency: "USD",
      limitMicros: 2_000_000,
      createdAt: "2026-08-13T16:00:00Z",
    });
    await repo.createBudget(owner.id, budget);
    const cost = createCostEvent({
      id: "c1",
      workspaceId: workspace.id,
      brandId: brand.id,
      workflowId: "wf1",
      kind: "model",
      provider: "gateway",
      currency: "USD",
      costMicros: 750_000,
      occurredAt: "2026-08-13T16:01:00Z",
    });
    expect(await repo.recordCost(cost)).toMatchObject({ spentMicros: 750_000, remainingMicros: 1_250_000 });
    expect(await repo.recordCost(cost)).toMatchObject({ spentMicros: 750_000 });
    await expect(repo.recordCost(createCostEvent({ ...cost, id: "c2", costMicros: 1_500_000 }))).rejects.toThrow(
      "Workflow budget exceeded",
    );
    expect((await pool.query("select id from workflow_cost_events")).rowCount).toBe(1);
  });

  it("uses owner authority, optimistic concurrency, and server-authoritative disable time", async () => {
    const { owner, member, workspace, brand } = await fixture();
    const control = createAutomationControl({
      id: "a1",
      workspaceId: workspace.id,
      brandId: brand.id,
      automationKey: "publishing:linkedin",
      stage: "publishing",
      createdAt: "2026-08-13T16:00:00Z",
    });
    await repo.createAutomationControl(owner.id, control);
    await expect(
      repo.disableAutomation(member.id, brand.id, control.automationKey, 1, "not permitted", "2099-01-01T00:00:00Z"),
    ).rejects.toThrow("Pilot operations not found");
    const disabled = await repo.disableAutomation(
      owner.id,
      brand.id,
      control.automationKey,
      1,
      "Repeated provider failures",
      "2099-01-01T00:00:00Z",
    );
    expect(disabled).toMatchObject({ status: "disabled", version: 2, disabledBy: owner.id });
    const stored = await pool.query<{ disabled_at: Date }>(
      "select disabled_at from automation_controls where id='a1'",
    );
    expect(stored.rows[0]).toBeDefined();
    expect(stored.rows[0]!.disabled_at.getUTCFullYear()).not.toBe(2099);
    const interventions = await repo.listInterventions(owner.id, brand.id);
    expect(interventions).toHaveLength(1);
    expect(new Date(interventions[0]!.at).getUTCFullYear()).not.toBe(2099);
    await expect(
      repo.disableAutomation(owner.id, brand.id, control.automationKey, 1, "stale version", "2099-01-01T00:00:00Z"),
    ).rejects.toThrow("Automation control version conflict");
  });
});
