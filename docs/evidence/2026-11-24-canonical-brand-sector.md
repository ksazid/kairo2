# Canonical Brand sector reliability

- Objective: prevent a generic onboarding Category from bypassing Hunter's domain safeguards.
- Authoring run: Codex, 2026-11-24, `fix/canonical-brand-sector`, implementation version 1.
- Base: `976e717f8e7097a33ba97276de39bdfc1d903252` (PR #105).
- Scope: persisted Brand sector selection, readiness, shared Hunter routing, regression evidence.
- Budget: one implementation slice; deterministic local tests and existing CI; no paid model calls, production data changes, publishing, gate changes or certification.

## Typed execution plan

1. `classify`: derive a bounded sector suggestion from active identity, offerings and core-topic evidence; keep conflicting or ambiguous evidence blocked.
2. `persist`: store a validated canonical sector in the existing versioned Brand Brain field store; preserve owner confirmation and source lineage.
3. `route`: require classification readiness and pass the stored ID to source planning and Hunter quality checks.
4. `review`: expose a labelled sector selector and a clear readiness correction action.
5. `verify`: test generic-category motorcycle onboarding, conflict/missing/stale states, wrong-domain rejection and valid source-to-preview flow; run existing deterministic and CI/security gates.

## Acceptance rubric

- A generic website Category with sourced Duke 390/motorcycle focus suggests and persists `motorcycles`.
- Missing, unsupported, stale or conflicting sector context cannot start Hunter.
- Explicit owner selection remains versioned and reviewable; generic selection cannot bypass clear conflicting domain evidence.
- Planning and quality checks use the same canonical ID.
- Cycling-only sources persist zero motorcycle opportunities; valid motorcycle evidence reaches preview with provenance.
- Existing tenant, concurrency, source, CI and security boundaries remain enforced.

## Validation results

Local verification on 2026-11-24:

- `npm run preflight`: passed (PES validation, 95 root tests, workspace typechecks, 1,135 runtime tests and all production builds).
- `npm run graph:validate`: passed, revision 38. Existing graph/certification state was not changed or recertified.
- New API regression: 4/4 passed. Uses real onboarding, activation, Hunter orchestration, quality filtering and Discovery persistence with controlled source-shaped evidence and a deliberately overconfident model fixture. MTB/e-bike-only sources produce zero opportunities; the valid motorcycle item retains source linkage and a text concept preview.
- Domain classification tests: 18/18 passed, including every specialist pack, ambiguous bike wording, explicit General, conflicting/stale/unsupported classifications, disabled or unrelated provenance, and reclassification.
- Hunter focused tests: 31/31 passed, including six e-bike/MTB spellings and existing valid motorcycle comparisons.
- UI Playwright: 8/8 passed, including sector review, versioned enum submission, reload, Hunter refresh and content preview. These UI journeys use the existing stub API; API regression above exercises the actual classification/quality path.
- `git diff --check`: passed.

The workspace's default font configuration made Chromium render text with zero height, including on a standalone HTML heading. Local browser checks used an isolated `FONTCONFIG_FILE` pointing at installed TrueType fonts. Application typography and CI configuration were not changed to mask that environment issue.

Limits: 41 existing database integration tests require an external database and were skipped. No paid live model call, production Hunter rerun, deployment or publication has been performed. Passing the defined regression matrix does not establish 100% accuracy on unknown future content. Existing brands without a stored sector require one explicit selection in Brand DNA; unsupported sectors require an explicit General selection.

GitHub CI/security results are recorded against the proposed commit in its pull request. No gate bypass or new certification is implied by these local results.
