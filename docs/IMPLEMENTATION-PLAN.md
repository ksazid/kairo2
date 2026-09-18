# PES v2 Implementation Plan

## VS-01 — Foundation ✅

Core types, graph invariants, complexity budget, bounded context builder, ratchet decision, tests and CI.

## VS-02 — Ratchet Engine ✅

Durable attempt records, evaluator contracts, versioned artifacts, reversible workspace adapters, keep/revert semantics, interruption recovery and failed lineage.

## VS-03 — Graph Memory ✅

Append-oriented graph writes, write provenance, optimistic revisions, atomic persistence, immutable correction/supersession, lineage reconstruction, accepted-artifact explanation and Ratchet publication.

## VS-04 — Context Builder ✅

Relevance ranking, recency, verified-state preference, contradiction inclusion, token-aware serialization, supersession resolution and context hashing.

## VS-05 — PES Gate Integration ✅

Graph-aware typed approvals, lifecycle transitions, implementation permissions, risk controls, protected paths, linked evidence, context freshness and delivery-graph triggers.

## VS-06 — Certification ✅

Exact-SHA certification candidates, self-contained context/gate snapshots, graph-linked artifact/evidence/evaluation traces, risk-sensitive evidence floors, human hash-bound certification approval, immutable certification hashes and append-only storage.

## VS-07 — Measured Multi-Agent Execution

**Implemented in this slice:** deterministic dependency waves, mandatory reducer and worker isolation contracts, concurrent-write conflict serialization, plan resource estimates, risk eligibility, repeated single-vs-multi benchmarks, quality/failure/cost guardrails, budget vetoes and append-only benchmark history.

**Activation posture:** multi-agent execution remains disabled in default Lite mode. A benchmark may show that a plan is activation-ready, but authorization still requires explicit enablement and sufficient PES budgets.

**Exit:** exact-head preflight passes and tests prove that multi-agent execution cannot be justified by speed alone when quality regresses, cannot exceed PES budgets, cannot run high-risk work by default and cannot become authorized merely because the capability exists.

## Core roadmap completion

With VS-07 merged, the PES v2 core implementation roadmap is complete:

```text
Governance
→ Ratchet Execution
→ Durable Graph Memory
→ Ranked Bounded Context
→ Graph-aware Gates
→ Exact-SHA Certification
→ Optional Measured Multi-Agent Optimization
```

The next phase is **outcome validation**, not automatic architectural expansion: run PES v2 against real product-development workloads and compare accepted-output quality, rework, regression rate, delivery latency and cost against the PES v1 / single-worker baseline.
