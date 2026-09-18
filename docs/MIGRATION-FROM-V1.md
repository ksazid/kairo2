# Migration from PES v1

PES v2 is an evolution, not a clean-room replacement of the v1 governance model.

## Keep unchanged in principle

| PES v1 capability | PES v2 treatment |
| --- | --- |
| PRD/TRD authority | Keep |
| Requirement traceability | Keep |
| Vertical slices | Keep |
| Typed approvals | Keep |
| Decision blocking | Keep |
| Implementation permission levels | Keep |
| Risk/impact ownership | Keep |
| Deterministic preflight | Keep |
| Exact-SHA certification | Keep |
| Release + rollback contracts | Keep |
| Human merge/release authority | Keep |
| Lite/Standard/Enterprise modes | Keep |
| Risk-triggered delivery graph | Keep, but feed it graph-aware context |

## Absorb into PES v2

### Loop Engineering

Do not keep it as a separate top-level operating system. Preserve its strongest mechanics inside the **Ratchet Execution** layer: bounded attempts, measured evaluation, keep/revert, run history and stop conditions.

### Delivery graph

Do not confuse the existing delivery graph with product graph memory.

- **Delivery graph** = how specialist workers are routed for a slice.
- **Product graph memory** = durable relationships among objectives, decisions, evidence, artifacts, runs and evaluations.

The delivery graph is optional execution topology. Product graph memory is durable state.

## Add in v2

1. Typed graph nodes and relations.
2. Provenance invariants.
3. Bounded subgraph context builder.
4. Explicit experiment/work lineage.
5. Failed-attempt retention.
6. Per-run complexity budgets.
7. Evaluation records linked to rubrics and artifacts.
8. Context hashes so unchanged work can be skipped safely later.

## Migration sequence

1. **VS-01 Foundation** — schemas, graph invariants, budgets, bounded context, CI.
2. **VS-02 Ratchet Engine** — attempt records, evaluator contract, keep/revise/revert adapters.
3. **VS-03 Graph Memory** — durable decisions, artifacts, evidence and lineage.
4. **VS-04 Context Builder** — relevance, recency, verification and token-aware serialization.
5. **VS-05 PES Gates** — connect graph evidence to lifecycle and approval validation.
6. **VS-06 Certification** — exact-SHA trace bundle linking objective → evidence → evaluation.
7. **VS-07 Multi-agent** — only after benchmarks show value.

## Compatibility rule

Until PES v2 passes feature-parity and outcome benchmarks, PES v1 remains the trusted baseline. Do not replace v1 in active products merely because v2 exists.
