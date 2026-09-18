# VS-06 — Exact-SHA Certification

## Goal

Turn PES certification into a machine-verifiable, immutable bundle that proves exactly **what commit was certified, why it was allowed to enter certification, which product objective it satisfies, what evidence supports it, and which human approved it**.

## Certification flow

```text
Testing
  ↓
PES gate into certification must be allowed
  ↓
Build candidate bundle
  ↓
Bind exact 40-char commit SHA
  ↓
Bind bounded context snapshot + hash
  ↓
Bind gate decision snapshot + hash
  ↓
Bind linked artifacts / evidence / evaluations
  ↓
Check unresolved risk
  ↓
Candidate hash
  ↓
Human certification approval references exact SHA + candidate hash
  ↓
Finalize against the current exact SHA
  ↓
Immutable certified bundle + certified hash
  ↓
Append to certification store
```

## Candidate contents

A certification candidate contains:

- bundle ID;
- slice ID and objective ID;
- risk level;
- exact commit SHA;
- graph revision;
- bounded context snapshot and context hash;
- allowed certification-gate snapshot and gate hash;
- pre-certification approvals;
- linked artifact IDs;
- linked evidence IDs;
- linked evaluation IDs;
- unresolved risks;
- graph trace summary including immutable node hashes;
- candidate hash.

The candidate hash changes if any bound field changes.

## Human certification authority

Final certification requires an approval record with:

- `type = certification`;
- `status = approved`;
- `actorType = human`;
- matching slice ID;
- matching exact commit SHA;
- matching candidate hash;
- approval timestamp.

Finalization also receives the current exact commit SHA and refuses to certify when it differs from the candidate SHA. An agent cannot self-certify or silently transfer an approval to a different SHA.

## Evidence rules

Certification requires at least one linked Artifact and one linked Evaluation. Evidence floors are risk-sensitive:

| Risk | Minimum linked evidence |
| --- | ---: |
| low | 1 |
| medium | 2 |
| high | 3 |

All referenced objects must exist in graph memory, have an accepted status and be connected to the slice objective within the configured trace depth.

## Context and gate binding

The bundle stores the actual bounded-context snapshot and the gate-decision snapshot in addition to their hashes. This allows later verification without replaying a historical chat session.

Candidate creation requires the context to match the current graph revision. Once certified, later graph revisions are allowed because graph memory is append-oriented; verification re-checks the immutable referenced nodes by ID and content hash.

## Risk handling

Unresolved risks at configured blocking levels prevent candidate creation. In the default policy, unresolved `high` and `critical` risks block certification.

## Persistence

Only finalized certified bundles may be written to `state/certifications.json`.

The store is append-only:

- duplicate bundle IDs are rejected;
- the same slice + SHA cannot be certified twice;
- atomic writes are used;
- a lock file prevents concurrent writers from silently overwriting each other.

## Commands

Build a candidate from an input JSON file containing slice, exact `commitSha`, context, gate result, approvals and graph IDs:

```bash
npm run cert -- candidate certification-input.json
```

Finalize after human approval, explicitly passing the exact current commit SHA:

```bash
npm run cert -- finalize candidate.json approval.json <exact-commit-sha>
```

Verify a certified bundle, optionally asserting that it matches a supplied current SHA:

```bash
npm run cert -- verify certified.json [exact-commit-sha]
```

Persist a verified certified bundle:

```bash
npm run cert -- store certified.json
```

## Cost posture

Certification adds no model call, graph database or sub-agent. It is deterministic hashing, graph traversal and policy validation over artifacts that PES has already produced.

## Exit criteria

VS-06 is complete when automated tests prove that:

1. candidate creation requires an exact SHA;
2. stale/contradictory context is rejected;
3. candidate creation requires an allowed PES certification gate;
4. artifacts, evidence and evaluations must be graph-linked to the objective;
5. risk-sensitive evidence floors are enforced;
6. unresolved blocking risk prevents certification;
7. final approval must be human and bind exact SHA + candidate hash;
8. tampering invalidates candidate/certified hashes;
9. later graph revisions do not invalidate a valid historical certification if referenced immutable objects remain unchanged;
10. certification storage is append-only.
