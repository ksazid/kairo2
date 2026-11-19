# Owner boundary readiness repair

Author: Codex, run `kairo-single-post-20261119`, version 1.
Source baseline: `b2f74d1c739efb87ac092b1445c6092c9b4ef0f8`.

## Objective and bounded scope

Unblock the real TheDukeMan onboarding → Hunter → preview → one Instagram post journey without bypassing readiness, approval, CI, or security gates. This change only aligns owner boundary field recognition across readiness and activation. No publishing worker, authorization, workflow, or migration change.

Budget: one local install, targeted red/green regression run, one full repository verification, and one PR CI cycle; no paid model or image calls for this repair. Release requires explicit approval.

## Observed evidence

The live UI at kairo-two-plum.vercel.app showed saved riding restrictions as Confirmed while the overview still reported Boundaries: Needs confirmation and disabled Run Discovery. Saving the same restrictions did not resolve the mismatch. The content focus was updated from generic prose to Duke 390 ownership, motorcycle care, bike accessories and responsible riding; Topics then became Ready.

Source inspection showed that Brand DNA recognizes and edits `boundaries.owner-directive`, while both domain readiness and activation omitted that alias. Bootstrap persists owner restrictions under that key. Agent context already includes the boundaries section.

Instagram reconnection completed separately with user approval; the UI showed @_dukeman390 Connected / Can publish. This is connection evidence, not proof of successful publication. No post was published and no new Hunter run completed during this repair. Live UI/API deployment SHAs have not been reconciled.

## Change and acceptance rubric

- Count the existing owner-directive alias in both boundary groups.
- Confirmed nonempty owner restrictions can satisfy readiness when all other groups are complete.
- Keep the restrictions in compact agent context.
- Empty, placeholder, stale, and unsupported inferred restrictions must not activate Hunter.
- Preserve existing CI/security workflows and publishing approvals.

## Validation

- Before fix: targeted suites reproduced three failures covering owner-boundary activation and snapshot propagation.
- After fix: 20 tests passed across readiness, activation, and snapshot suites.
- `npm run agent:verify -- --continue-on-failure`: passed PES validation, root tests, and runtime verification (workspace typechecks, tests, builds).
- `git diff --check`: passed.
- Remote CI/security: pending PR execution; not certified or waived.

## Release and rollback

After approval and required exact-commit gates, deploy the compatible API/domain build, then refresh Brand Brain and verify the saved restriction clears the boundary gap. Perform one bounded real Hunter run, inspect source-backed results, create one single-image preview, approve the exact content/account version, and confirm Instagram post ID/permalink. If additional blockers appear, report them rather than claiming end-to-end success.

Rollback: revert this isolated alias change. No database changes or destructive data operations are involved.
