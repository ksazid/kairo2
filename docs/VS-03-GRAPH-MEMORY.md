# VS-03 — Durable Graph Memory

## Goal

Make product-development state durable, append-oriented, provenance-bearing and queryable across sessions without introducing a graph database.

## Storage model

PES v2 continues to use `state/graph.json`. The file now carries:

- `revision` — optimistic concurrency version.
- `nodes` and `edges` — immutable graph objects.
- `events` — append-oriented write history.
- `memoryProvenance` — event, actor, run and source metadata attached to every recorded object.

A dedicated graph database is still not required.

## Write rules

1. Existing node and edge IDs may be reasserted only when their semantic content is identical.
2. A conflicting object with the same ID is rejected instead of silently overwriting history.
3. Corrections create a new object and a `SUPERSEDES` edge; the original remains addressable.
4. Superseding a stale version is rejected by the safe helper.
5. Every accepted write records actor, reason, revision and timestamp.
6. A run can cap graph writes using the PES complexity budget.
7. The JSON store uses atomic replacement plus a lock file and supports expected-revision checks.

## Queries

`JsonGraphMemoryStore` and `scripts/graph-memory.mjs` support:

- current version resolution through supersession chains;
- provenance lookup for a node or edge;
- bounded lineage reconstruction;
- accepted-artifact explanation including producer, evaluator, objective and failed attempts;
- publication of finalized Ratchet attempts into durable graph memory.

Examples:

```bash
npm run graph:validate
npm run graph:memory -- current OBJ-003
npm run graph:memory -- lineage OBJ-003
npm run graph:memory -- provenance OBJ-003
npm run graph:memory -- explain ART-ATT-02
npm run graph:memory -- publish-attempt RUN-1 ATT-2
```

## Correction semantics

PES does not mutate an incorrect historical object in place.

```text
DEC-002 --SUPERSEDES--> DEC-001
```

`DEC-001` remains queryable. `resolveCurrentNode(DEC-001)` returns `DEC-002`. If multiple replacements independently supersede the same current node, resolution returns a conflict rather than guessing.

## Ratchet integration

VS-02 already produces `AgentRun`, `Artifact`, `Evaluation`, `PRODUCED`, `EVALUATES` and `PARENT_OF` graph updates. VS-03 adds the durable publication layer. Repeated publication of identical finalized attempts is idempotent; conflicting rewrites are blocked.

## Exit criteria

VS-03 is complete when:

- append-only and provenance invariants are machine-validated;
- stale writes are detected;
- supersession preserves historical state;
- a stored graph can reconstruct why an accepted artifact exists;
- failed attempts remain visible in that explanation;
- `npm run preflight` passes on the exact PR head.
