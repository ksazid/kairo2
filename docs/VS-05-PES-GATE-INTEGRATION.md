# VS-05 — PES Gate Integration

## Goal

Make PES governance enforceable from canonical delivery state plus graph-grounded evidence, rather than relying on an agent or reviewer to remember the rules.

## Decision model

A requested lifecycle transition is evaluated as a deterministic function of:

- current slice state;
- target lifecycle state;
- typed approvals;
- human authority boundaries;
- implementation permission;
- slice risk and trigger signals;
- protected paths touched by the change;
- bounded context hash and graph revision;
- relevant contradictions;
- verified evidence linked to the slice objective;
- delivery-graph readiness when triggered.

The result is either `allowed: true` or a structured blocker list. The gate engine does not mutate the repository, approve its own blockers, or create missing evidence.

## Safety properties

### Lifecycle order

Normal lifecycle states move one step at a time. Exception states such as `blocked`, `deferred` and `rolled-back` remain explicit escape states.

### Approval authority

PES v2 keeps the existing human-only boundary for scope, policy, certification, release and production enablement. An agent-authored approval cannot satisfy a human-required gate. `agentMaySelfApprove=false` also prevents an agent from satisfying other approval requirements on its own.

### Evidence grounding

Evidence IDs must resolve to accepted graph objects and must be connected to the slice objective within the configured hop limit. A fluent review note that is not represented as linked evidence does not satisfy the gate.

Evidence floors are risk-sensitive:

| Risk | Minimum linked evidence when evidence is required |
| --- | ---: |
| low | 1 |
| medium | 2 |
| high | 3 |

### Bounded context

Governed transitions require a hashed context built against the current graph revision and seeded with the slice objective. Stale context is rejected.

Relevant contradictions are allowed during implementation and testing so the team can work through them, but certification/release states block while contradictions remain in the task context.

### Protected paths

Changes to PES policy/configuration, CI workflows, infrastructure, migrations and security surfaces can require additional approval and trigger a delivery graph.

This is intentionally path-prefix based and deterministic. It does not use a model to guess whether a file is sensitive.

### Delivery-graph triggers

A delivery graph is required when one or more configured triggers fire, including:

- high risk;
- cross-module work;
- security-sensitive work;
- repeated failures at or above the configured threshold;
- protected-path changes marked as delivery-graph sensitive.

The trigger can be visible at `ready-for-implementation`, but becomes blocking from `implementing` onward until the delivery graph reports `status: ready`.

## CLI

Evaluate a transition using an explicit input fixture:

```bash
npm run gate:evaluate -- testing path/to/gate-input.json
```

The input may contain:

```json
{
  "slice": {
    "id": "VS-123",
    "objectiveId": "OBJ-123",
    "state": "implementing",
    "riskLevel": "medium",
    "implementationPermission": "runtime-enabled"
  },
  "context": {},
  "approvals": [],
  "evidenceIds": [],
  "changedPaths": [],
  "deliveryGraph": { "status": "ready" }
}
```

When no fixture is supplied, the CLI uses `delivery/current-slice.json` if an active slice exists.

## Cost posture

VS-05 adds no graph database, model call, sub-agent or background service. Gate evaluation is deterministic repository-side logic. The only runtime cost is reading already-produced state and evaluating rules.

## Exit criteria

VS-05 is complete when preflight proves that:

1. invalid lifecycle jumps are blocked;
2. agent approvals cannot cross human authority boundaries;
3. protected paths and risk signals trigger delivery-graph requirements;
4. unlinked evidence cannot satisfy evidence floors;
5. stale bounded context is rejected;
6. relevant contradictions block certification;
7. production release requires release + production-enable approval and production permission.
