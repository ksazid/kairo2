# VS-04 — Ranked Bounded Context Builder

## Goal

Give each worker the smallest useful slice of approved product state instead of replaying whole histories.

## What it does

The context builder starts from one or more graph seed IDs and produces a deterministic task-specific context pack.

It adds five controls:

1. **Relevance ranking** — closer nodes and stronger relation types rank first.
2. **Verified-state preference** — verified/approved state outranks failed or superseded alternatives at the same distance.
3. **Recency preference** — newer relevant state receives a small deterministic ranking boost.
4. **Contradiction inclusion** — conflicting claims are surfaced together when they fit the context budget.
5. **Token-aware serialization + hashing** — lower-ranked nodes are omitted until the serialized pack fits the declared token budget; the resulting pack receives a stable SHA-256 context hash.

## Supersession handling

Seeds are resolved through immutable `SUPERSEDES` chains before retrieval. If a seed has an unresolved supersession fork, context construction fails instead of guessing which branch is authoritative.

## Ranking model

The score is deterministic and local. It uses:

- seed priority;
- graph hop distance;
- relation weight;
- node status;
- node type;
- relative recency.

No model call is used for ranking.

## Token budget

`context.maxTokens` is independent from but cannot exceed the run-level `budgets.maxTokens` value.

The builder ranks first, selects up to `maxNodes`, then removes the lowest-ranked non-seed nodes until the complete serialized payload fits `maxTokens`.

Required seeds are never silently removed. If the required seed set itself cannot fit, the builder fails explicitly.

## Contradictions

`CONTRADICTS` edges are included in the returned metadata whenever both endpoints are selected. Contradictory neighbors receive priority so workers see material disagreement instead of receiving a falsely clean single-view context.

## Context hash

The hash covers:

- graph revision;
- requested and resolved seeds;
- supersession resolution;
- selected nodes and edges;
- ranking metadata;
- contradictions;
- omitted node IDs;
- the active context policy.

The same graph state, seeds and policy produce the same hash. A changed relevant context produces a different hash and can invalidate cached work.

## CLI

```bash
npm run context:build -- OBJ-004
```

Compare with a previously saved context hash:

```bash
npm run context:build -- OBJ-004 --prior-hash <sha256>
```

The output contains `unchanged: true` only when the newly constructed pack matches the supplied hash.

## Cost posture

VS-04 adds:

- no graph database;
- no model calls;
- no sub-agents;
- no background service.

It is deterministic repository-side logic intended to reduce downstream model context size and repeated reasoning.

## Exit criteria

VS-04 is complete when:

- relevant verified/recent nodes rank above low-value alternatives;
- contradictions are surfaced together when budget permits;
- superseded seeds resolve deterministically;
- complete serialized context remains within the configured token budget;
- context hashing detects unchanged and changed relevant state;
- `npm run preflight` passes on the exact PR head.
