# VS-07 — Measured Multi-Agent Execution

## Goal

Make multi-agent execution an **optional optimization with proof**, not a default architecture choice.

PES v2 may consider multiple workers only when the work is genuinely parallel, workers are isolated, a reducer is declared, budgets permit the fan-out and measured results beat the single-worker baseline without unacceptable quality, failure-rate or cost regression.

## Default posture

Multi-agent execution is **available for assessment but disabled by default**.

In the repository's default `lite` mode:

- `maxSubAgents = 0`;
- `maxConcurrentWorkers = 1`;
- `multiAgent.enabled = false`.

Therefore this slice does not increase normal PES runtime cost.

## Plan contract

A candidate multi-agent plan must declare:

- plan ID and objective ID;
- risk level;
- reducer strategy and output contract;
- worker task IDs and specialist roles;
- dependency edges;
- isolated execution mode (`worktree`, `sandbox` or `container`);
- explicit read/write sets;
- estimated model calls, tokens and financial cost.

The plan must be acyclic and within the declared task limit.

## Parallel topology

PES builds deterministic execution waves from dependencies.

Tasks are placed in the same wave only when:

- their dependencies are already complete;
- worker count remains inside the policy cap;
- their declared write sets do not overlap when concurrent-write rejection is enabled.

If two tasks write the same path, PES serializes them instead of assuming isolation removes the merge risk.

## Reducer requirement

Fan-out without a reducer is rejected.

The reducer must define how worker outputs become one accepted product artifact. This prevents a swarm from producing activity without a deterministic synthesis contract.

## Benchmark contract

Before activation, PES requires measured samples for both:

- single-worker baseline;
- multi-agent candidate.

Each sample records:

- quality;
- coverage;
- wall-clock minutes;
- cost;
- failure rate.

The default policy requires at least three samples per mode.

## Default acceptance thresholds

Multi-agent execution fails qualification if:

- quality regresses at all;
- failure rate increases;
- cost increases by more than 50%;
- no declared measurable benefit is achieved.

At least one of these benefits must be demonstrated:

- wall-clock time improves by at least 20%;
- coverage improves by at least 10%;
- measured quality improves.

These thresholds are policy, not hidden model judgment.

## Budget gate

Even a passing benchmark cannot authorize a plan that exceeds the active PES run budget for:

- sub-agents;
- concurrent workers;
- model calls;
- tokens;
- financial cost.

This means a benchmark can make a plan **activation-ready** while the current operating mode still refuses execution.

## Risk posture

The default policy allows only `low` and `medium` risk plans to qualify. `high` risk work remains single-worker / explicitly governed unless policy is changed through the normal PES approval path.

## Activation states

PES reports three distinct states:

1. **Eligible** — plan structure, risk, budget and benchmark all satisfy the policy.
2. **Activation-ready** — measured evidence is sufficient to justify the architecture.
3. **Authorized** — activation-ready **and** the PES configuration has explicitly enabled multi-agent execution.

A passing benchmark does not silently enable the feature.

## Commands

Assess a plan against measured benchmark data:

```bash
npm run multi-agent -- assess plan.json benchmark.json
```

Record an assessment in the append-only benchmark store:

```bash
npm run multi-agent -- record plan.json benchmark.json BENCH-001
```

## Benchmark persistence

Recorded benchmark decisions are stored in `state/execution-benchmarks.json` with:

- benchmark ID;
- plan ID;
- objective ID;
- plan hash;
- benchmark hash;
- eligibility / activation-ready / authorization result;
- aggregate metrics and blockers;
- timestamp.

The store rejects duplicate benchmark IDs and uses atomic locked writes.

## Cost impact

With the default configuration: **no additional agent cost**.

Cost increases only if all of the following happen later:

1. a real product workload is benchmarked;
2. the benchmark passes;
3. PES budgets are raised from Lite limits;
4. multi-agent execution is explicitly enabled.

## Exit criteria

The implementation is complete when tests prove that:

1. cyclic or non-isolated plans are rejected;
2. fan-out without a reducer is rejected;
3. dependency waves are deterministic;
4. concurrent write overlaps are serialized;
5. benchmarks require repeated samples;
6. faster execution cannot compensate for quality regression;
7. no measured benefit means no activation;
8. PES budgets can veto a passing benchmark;
9. high-risk plans remain ineligible by default;
10. a passing benchmark can become activation-ready while execution remains disabled;
11. explicit enablement is still required for authorization;
12. benchmark history is append-only.

## Current activation decision

The framework is implemented, but **multi-agent execution remains OFF**. No product-specific benchmark has yet been recorded in this repository, so PES v2 must continue using the single-worker path by default.
