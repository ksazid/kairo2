# VS-02 — Ratchet Engine

## Goal

Make Loop Engineering a native PES execution primitive with durable attempts, explicit evaluator contracts, versioned candidate artifacts, reversible workspaces, keep/revert semantics and recovery after interruption.

## Execution contract

```text
approved objective
→ checkpoint current accepted state
→ start one motivated attempt
→ produce versioned candidate artifact
→ evaluate against declared metric + rubric + evidence floor
→ keep only if the declared metric improves
→ otherwise restore checkpoint
→ persist attempt, evaluation and lineage either way
→ repeat within budget / attempt limit
```

## Safety rules

- Only one attempt may be active in a run.
- A kept attempt requires a candidate artifact and an accepted checkpoint.
- A reverted attempt remains addressable as failed lineage.
- Interrupted attempts are restored to their pre-attempt checkpoint; PES never auto-keeps an incomplete attempt.
- Evaluators must declare metric, direction, rubric and minimum evidence.
- Run usage is checked against the PES complexity budget.
- Git worktree execution is isolated; reset/clean operations are scoped to the attempt worktree.

## Storage

`JsonRatchetRunStore` persists complete run state using an atomic temp-file + rename update. `state/ratchet-runs.json` is the default repository-local store shape.

## Workspace adapters

- `FileSnapshotWorkspaceAdapter` — reversible snapshots for a declared set of mutable files.
- `GitWorktreeAdapter` — isolated Git worktree preparation, checkpoint, restore, keep and disposal.

## Graph publication

A finalized attempt can be serialized into PES graph nodes/edges:

- attempt → `AgentRun`
- candidate → `Artifact`
- result → `Evaluation`
- parent attempt → `PARENT_OF`
- attempt → artifact → `PRODUCED`
- evaluation → artifact → `EVALUATES`

Failed attempts are published with failed status rather than deleted.

## Exit criteria

VS-02 is complete when automated tests prove:

1. Multiple attempts retain only measured improvement.
2. Regressions remain stored as failed lineage.
3. Evaluations cannot pass without required evidence.
4. Interrupted attempts restore their checkpoint.
5. Run state survives save/reload.
6. File snapshots are reversible.
7. Git worktree operations are isolated and reversible.
8. Finalized attempts emit graph-valid lineage.

Run:

```bash
npm run preflight
npm run ratchet:fixture
```
