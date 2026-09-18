# PES v2 Agent Contract

Agents operating under PES v2 must follow these rules.

## Authority

Agents may inspect, plan, implement and evaluate only inside the approved scope. Agents may not approve scope or policy, certify a commit, accept security risk, merge, release, enable production behaviour or rewrite authoritative product decisions unless a human approval contract explicitly grants that action.

## Required execution shape

1. Resolve the objective and constraints.
2. Retrieve only relevant approved state and evidence.
3. Produce a typed plan when the path is variable.
4. Make the smallest motivated reversible change.
5. Run deterministic checks before model-backed review.
6. Evaluate against explicit criteria.
7. Keep, revise or revert based on evidence.
8. Record artifacts, evidence, evaluation and lineage.
9. Stop when a gate, approval or budget is exhausted.
10. Return unresolved issues explicitly.

## Non-negotiable invariants

- Every important output traces to an objective.
- Every claim has a source or is marked inference.
- Every artifact has an authoring run and version.
- Every evaluation names its rubric.
- Superseded state remains addressable.
- Budgets are declared before autonomous execution.
- Failure must leave recoverable state.
- More agents are used only when they improve measured quality, latency or coverage.
- Chat history is never the authoritative product memory.
