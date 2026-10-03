# Kairo Context.dev POC — live evidence update

**Run:** context-dev-poc-2026-10-03, version 2
**Branch:** https://github.com/ksazid/kairo2/tree/eval/context-dev-three-brand
**Objective:** Compare Context.dev evidence for Nike, Dishoom and Linear without changing production.
**Baseline commit:** a8a563afe1aa1ff5c166a2e1ac0d8f34f87fb25b

## Live collection

Twelve successful calls completed: one brand profile, one style guide, one bounded crawl and one ten-result search per brand. The Context connector does not expose account credit usage. Using published request rates and successful crawled pages, estimated spend is 71 credits (30 brand + 30 style guide + 8 successful crawl pages + 3 searches), under the 78-credit ceiling. This is an estimate; confirm actual usage in the Context dashboard.

| Brand | Brand profile cache age | Crawl pages | Search results | Style guide |
|---|---:|---:|---:|---|
| Nike | 15 h | 2 | 10 | #000000 accent, white background, Helvetica Now Text headings |
| Dishoom | 86 days | 1 | 10 | #e1a894 accent, #151515 background, Cheltenham headings |
| Linear | 9 h | 5 | 10 | #7170ff accent, #08090a background, Inter Variable headings |

Style guide requests reported cache misses. Crawl counts are usable returned pages, below the five-page limit for Nike and Dishoom. Search results include third-party sources; they need Kairo's evidence checks before they inform opportunities.

**Data-quality issue:** Dishoom's brand profile classifies it partly as “Restaurant Tech & Management” and “Direct-to-Consumer Brands.” The description identifies it as a restaurant group, so those industry labels need verification and must not flow into Brand Brain as confirmed facts.

**Freshness issue:** Brand profile age differs from about 15 hours to 86 days. Keep cache age visible and force-refresh or reject stale profiles when freshness matters.

## Paired evaluation status

Kairo's actual PublicBrandReferenceHttpReader returned unavailable for all three homepages in this isolated runtime. This diagnostic is not a complete onboarding run and does not establish a production fetching defect.

Brand Brain and Hunter comparisons did not run. The isolated runtime has no Kairo model, Exa or deployed API credentials, and the approved plan sets model calls to zero. **Quality improvement is unmeasured; this POC is not complete and no adoption conclusion is supported.**

Production code, data, provider registration and deployment were unchanged. The evaluation branch is not merged or certified.

## Artifacts and checks

- Full bounded live evidence, including source URLs, request IDs, cache ages and page excerpts: evaluation/context-dev/live-results.json
- Plan, runner, tests, lineage and evaluation rubric: evaluation/context-dev/
- Deterministic collector tests: 10 passed on the baseline commit.
- PES v2 validation: passed after this evidence update.
- No retries, monitors, batch jobs or model calls.

## Next

Run the same existing onboarding reader in an isolated Kairo runtime with working public-web egress; retain selected page URLs and provenance. Then run identical Brand Brain inputs and Hunter plans on both arms, with a declared bounded model/retrieval budget, and blind-review field support, relevance, actionability, unsupported claims, duplication, cost and latency.
