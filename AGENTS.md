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

## Execution routing and cost discipline

Use the cheapest reliable execution environment for each task.

- **CHAT**: planning, architecture decisions, status, analysis, reviewing failures, choosing the next slice.
- **CODEX**: implementation, refactoring, repository searches, tests and approved code changes.
- **CI / PLAYWRIGHT**: build, typecheck, unit/integration/E2E tests, PES validation, regression checks and repeatable browser journeys.
- **WORK**: authenticated browser operations, visual UI inspection, dashboard operations, browser-only debugging and final visual QA that cannot be performed deterministically.

Rules:

- Never use Work for a task that Chat, Codex, CI, Playwright, GitHub Actions or a deterministic script can reliably perform.
- Retrieve bounded project context first; do not rediscover the entire repository by default.
- Prefer deterministic verification before model-backed review.
- Do not repeat a browser journey manually after it is covered by a reliable automated test unless investigating a failure or performing required visual QA.
- Work one approved slice at a time.
- Persist authoritative decisions, evidence and status in repository state rather than depending on chat history.
- Keep model/tool calls proportional to task risk and complexity.

## Required end-of-task routing

Every completed or blocked Kairo task must end with:

### NEXT EXECUTION ROUTE
**Next:** <specific next action>

**Run in:** CHAT / WORK / CODEX / CI-PLAYWRIGHT

**Reason:** <one short sentence>

**Use this prompt:** <exact copy-paste instruction for the next environment>

**Approval:** REQUIRED / NOT REQUIRED

When multiple stages are required, use the shortest reliable path, normally:

CHAT → CODEX → CI/PLAYWRIGHT → WORK only if needed → CHAT
