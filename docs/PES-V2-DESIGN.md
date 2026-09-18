# PES v2 Design

## Design goal

PES v2 improves product-engineering outcomes without turning every task into a graph workflow or multi-agent swarm.

The governing rule is: **add architecture only when it removes a measured bottleneck or material risk**.

## What PES v1 already gets right

PES v1 already provides typed approvals, decision blocking, canonical slice lifecycle, implementation permission levels, risk-based controls, exact-SHA certification, release/rollback contracts, post-release review, deterministic preflight, progressive operating modes and optional risk-triggered delivery graphs.

PES v2 preserves these rather than replacing them.

## What v2 adds

### 1. Native ratchet execution

Loop Engineering becomes an internal execution primitive:

```text
inspect → propose one motivated change → apply → evaluate → keep | revert → record → repeat
```

A task should use this only when the output has a meaningful evaluator. A fluent agent opinion is not an evaluator.

### 2. Durable product graph memory

The minimum useful node types are:

- Objective
- Decision
- Artifact
- Evidence
- Evaluation
- AgentRun
- Version
- Claim
- Source
- Task
- Commit
- Metric

The minimum useful relation types are defined in `src/core.mjs`.

The graph stores explicit relationships and provenance; it does not replace Git, the PRD/TRD, ADRs, tests or release records.

### 3. Bounded context construction

Workers receive a task-specific neighborhood rather than complete history. Context is constrained by hops, node count and accepted state. This reduces token growth and stale-context contamination.

### 4. Work lineage

Failed and superseded attempts remain addressable. Git commit lineage answers what changed; product graph lineage answers why it changed, what evidence supported it and which objective it served.

### 5. Explicit run budgets

Every autonomous run has limits for model calls, sub-agents, concurrency, tools, tokens, cost, wall-clock time, retries and graph writes. Budget exhaustion must return partial work and unresolved issues, never pretend completion.

## Five-plane architecture

### Control plane

Owns objectives, scope, permissions, plans, budgets, stop rules and human approval boundaries.

### Execution plane

Runs tools, code changes, tests and optional isolated workers.

### Artifact plane

Stores versioned plans, diffs, screenshots, reports, metrics and evaluation outputs.

### Graph plane

Stores typed relationships between objectives, decisions, evidence, artifacts, runs, commits and evaluations.

### Evaluation plane

Runs deterministic checks first, then only the model-backed or human evaluation justified by risk.

## Architecture selection

| Situation | Start with |
| --- | --- |
| Simple low-risk task | Direct execution |
| Verifiable iterative output | Ratchet loop |
| Stable stages | Chain |
| Clear categories | Router |
| Independent units | Parallel workers |
| Variable decomposition | Orchestrator-workers |
| Alternative attempts must survive | DAG lineage |
| Facts/decisions must survive sessions | Product graph |
| Large parallel workload with known reducer | Dynamic workflow |

## Cost policy

Graph storage is cheap; model calls are not. PES v2 therefore defaults to versioned JSON and one worker. Standard/Enterprise modes may enable richer review or parallelism only when expected defect/rework reduction exceeds coordination cost.

## Human authority

Graph memory can record approval; it cannot manufacture approval. Agents cannot self-authorize scope, policy, certification, release, production enablement, security-risk acceptance, merge or production deployment.

## Definition of done

An important output is done only when it can be traced through:

```text
Objective → Plan/Task → Artifact/Commit → Evidence → Evaluation → Decision → Version/Lineage
```

and all required PES gates are satisfied.
