---
name: kairo-execution
description: Route and execute Kairo engineering tasks with PES v2, bounded context, deterministic verification, Playwright regression coverage, and minimal Work usage. Use for any Kairo/Kairo2 implementation, debugging, validation, status-to-execution handoff, or browser QA task.
---

# Kairo execution

Use this skill for Kairo engineering work. Do not restate the full PES contract; `AGENTS.md` remains authoritative.

## Start

1. Read `AGENTS.md`.
2. Identify the smallest approved slice.
3. Route the task with `npm run agent:route -- --task <task>`.
4. If implementation needs product context, use `npm run agent:brief -- <seed ids>` rather than replaying chat history or scanning the whole repository.
5. Make the smallest reversible change.

## Route choices

Use task names from `.engineering/agent-routing.json`.

- Planning/status/architecture stays in Chat.
- Implementation/refactor/repo search goes to Codex.
- Build, tests, PES validation and repeatable browser journeys go to CI/Playwright.
- Work is allowed only for authenticated browser operations, visual QA, or browser debugging after deterministic failure evidence exists.

Do not escalate to Work because a task is inconvenient. Escalate only when its required interaction cannot be represented reliably in code, CI, Playwright, an API, or a deterministic script.

## Reasoning/model class

Treat `modelClass` and `reasoningEffort` from the routing result as capability classes, not hard-coded provider model names.

- `none`: deterministic software only.
- `general + low/medium`: routine status, planning, and simple analysis.
- `coding + low/medium`: repository search and implementation.
- `reasoning + high`: architecture, release-risk decisions, or evidence-backed hard debugging.
- `vision-reasoning`: final visual QA where deterministic assertions are insufficient.

Do not use high reasoning for routine edits, searches, builds, or passing regression checks.

## Verify

Run deterministic checks before model-backed review.

- `npm run agent:verify` for repository/PES verification.
- `npm run e2e:kairo` or the Kairo UI E2E GitHub workflow for repeatable browser journeys.
- Read failure-only evidence when a gate fails; do not reread unrelated logs or repository areas.

External publishing providers are not to be faked as proof of successful production dispatch. Browser E2E may validate the publishing-command handoff; provider/worker integration owns dispatch verification.

## Finish

Record evidence in the repository when the task requires durable proof.

Every completed or blocked task must end with the `NEXT EXECUTION ROUTE` format defined by `AGENTS.md`. Generate/check the route with `npm run agent:route` when the next environment is not obvious.

Never treat chat history as authoritative Kairo memory.
