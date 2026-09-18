# Product Engineering Starter v2 (PES v2)

PES v2 is a **graph-aware product engineering governance system**. It preserves PES governance—typed approvals, vertical slices, deterministic gates, exact-SHA certification, rollback and human release authority—while making execution, evidence lineage and durable product memory first-class.

## Core model

```text
Governance
   ↓
Ranked Bounded Context → Plan → Execute → Evaluate → Keep / Revise / Revert
          ↑                                      ↓
          └──────── Product Graph Memory ← Artifacts / Evidence / Lineage
                                                 ↓
                                      Graph-aware PES Gates
                                                 ↓
                                      Exact-SHA Certification
                                                 ↓
                                           Human Approval

Optional optimization only after proof:
Single worker baseline ⇄ Measured multi-agent candidate → benchmark gate → explicit enablement
```

PES v2 does **not** make graph databases or multi-agent swarms mandatory. The default remains the cheapest architecture that can safely satisfy the task.

## What changes from PES v1

- Loop Engineering is absorbed as native **Ratchet Execution**.
- Decisions, artifacts, evidence, evaluations and agent runs become durable graph-addressable state.
- Graph writes are append-oriented and provenance-bearing rather than silent in-place rewrites.
- Corrections create immutable supersession chains.
- Context is ranked from bounded relevant state instead of replaying whole histories.
- Verified/recent state is preferred while material contradictions remain visible.
- Superseded seeds resolve to current state before retrieval.
- Context packs are token-bounded and content-hashed so unchanged work can be detected.
- Governance gates verify lifecycle order, approvals, permissions, linked evidence, context freshness, contradictions, protected paths and delivery-graph readiness.
- Certification binds the exact commit SHA to context, gate result, graph-linked artifacts/evidence/evaluations, candidate hash and human approval.
- Failed attempts remain useful lineage.
- Cost, token, concurrency, retry, wall-clock and graph-write budgets are explicit.
- Multi-agent execution is benchmark-gated, isolated, reducer-driven and **disabled by default**.
- Human authority over scope, policy, certification, release and production enablement is unchanged.

## Five planes

1. **Control** — objectives, scope, permissions, plans, budgets and stop rules.
2. **Execution** — tools, code changes, tests and isolated workers.
3. **Artifact** — immutable/versioned plans, diffs, screenshots, reports and metrics.
4. **Graph** — decisions, claims, evidence, relations, task dependencies and lineage.
5. **Evaluation** — deterministic checks, rubrics, specialist review and human gates.

## Quick start

Requires Node.js 24+.

```bash
npm test
npm run preflight
npm run pes:validate
npm run graph:validate
```

Build ranked bounded context:

```bash
npm run context:build -- OBJ-007
```

Evaluate a PES lifecycle transition:

```bash
npm run gate:evaluate -- certification path/to/gate-input.json
```

Build and verify certification bundles:

```bash
npm run cert -- candidate certification-input.json
npm run cert -- finalize candidate.json approval.json <exact-commit-sha>
npm run cert -- verify certified.json [exact-commit-sha]
npm run cert -- store certified.json
```

Assess—not automatically enable—a multi-agent plan:

```bash
npm run multi-agent -- assess plan.json benchmark.json
npm run multi-agent -- record plan.json benchmark.json BENCH-001
```

Inspect durable graph memory:

```bash
npm run graph:memory -- current OBJ-006
npm run graph:memory -- lineage OBJ-007
npm run graph:memory -- provenance OBJ-007
```

## Current implementation status

- **VS-01 Foundation** ✅ — core domain model, budgets, graph invariants and CI.
- **VS-02 Ratchet Engine** ✅ — durable attempts, evaluator contracts, artifact versions, reversible execution and recovery.
- **VS-03 Graph Memory** ✅ — append-oriented state, provenance, correction/supersession, cross-session lineage queries and Ratchet publication.
- **VS-04 Context Builder** ✅ — relevance ranking, recency, verified-state preference, contradiction inclusion, token-aware serialization and context hashing.
- **VS-05 PES Gate Integration** ✅ — deterministic lifecycle/approval/evidence/risk/protected-path gates and delivery-graph triggers.
- **VS-06 Certification** ✅ — exact-SHA candidate bundles, graph-linked traceability, human hash-bound approval, immutable certification store and historical verification.
- **VS-07 Measured Multi-Agent Execution** — deterministic dependency waves, isolation/reducer contracts, write-conflict serialization, budget gates and single-vs-multi benchmark qualification.

### Default activation posture

PES v2 remains in **Lite / single-worker mode**:

- `multiAgent.enabled = false`
- `maxSubAgents = 0`
- `maxConcurrentWorkers = 1`

So VS-07 adds **no normal multi-agent runtime cost**. A real product workload must first demonstrate measurable value, then budgets and the feature must be explicitly enabled through normal PES governance.

See `docs/PES-V2-DESIGN.md`, `docs/VS-02-RATCHET-ENGINE.md`, `docs/VS-03-GRAPH-MEMORY.md`, `docs/VS-04-CONTEXT-BUILDER.md`, `docs/VS-05-PES-GATE-INTEGRATION.md`, `docs/VS-06-CERTIFICATION.md`, `docs/VS-07-MEASURED-MULTI-AGENT.md` and `docs/MIGRATION-FROM-V1.md`.
