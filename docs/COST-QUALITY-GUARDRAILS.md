# Cost and Quality Guardrails

## Goal

Improve total product-delivery quality and rework cost, not maximize agent activity.

## Default cost posture

- Versioned JSON before a graph database.
- One worker before multiple workers.
- Deterministic checks before model review.
- Bounded context before full-history replay.
- One evaluator only when an evaluator can change the decision.
- No swarm without a known reducer and measurable wall-clock benefit.

## Lite

For low-risk work. One worker, ratchet only when output is verifiable, deterministic gates, no sub-agents by default.

## Standard

For medium-risk work. May add one specialist or independent reviewer when justified by impact, repeated failure or cross-module risk.

## Enterprise

For high-risk/regulated/multi-team work. May use isolated parallel specialists, independent review and richer evidence contracts with explicit budgets.

## Outcome metrics

Track:

- accepted-output rate
- rework rate
- regression rate
- recovery rate
- cost per accepted output
- latency to accepted output
- duplicate-work rate
- evidence/provenance coverage
- human override rate
- post-release defect rate

More agents are justified only when one or more important outcome metrics improve without unacceptable regressions elsewhere.

## Stop conditions

Stop autonomous execution when:

- a required human approval is missing;
- a protected surface would be crossed;
- the evaluator cannot distinguish improvement;
- the run budget is exhausted;
- evidence is insufficient;
- repeated attempts fail without new information;
- the requested change conflicts with authoritative product state.

Return best current artifact, completed work, unresolved issues, evidence and the stop reason.
