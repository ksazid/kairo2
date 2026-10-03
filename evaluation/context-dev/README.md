# Context.dev three-brand POC

Version 1. Authoring run: `context-dev-poc-2026-10-03`.
Objective and budget are in `plan.json`. Evaluation-only branch; no production registration, database writes, deployment, model calls or recurring monitors.

## Run

Requires Node 24. Credentials remain server-side in `CONTEXT_DEV_API_KEY`; do not paste them into chat or commit them.

```bash
node --test evaluation/context-dev/collect.test.mjs
node evaluation/context-dev/collect.mjs
node --experimental-transform-types evaluation/context-dev/collect.mjs --live
```

The checked-in credential-based runner makes at most 12 sequential Context.dev calls: brand, styleguide, five-page crawl and one ten-result search for each of Nike, Dishoom and Linear. Planned maximum: 78 credits. No retries. A missing API key blocks its API calls. The connected-Context execution produced a bounded evidence summary in `live-results.json`; it omits secrets and keeps source URLs and request IDs. Failed or partial results remain explicit.

## Scope and interpretation

The baseline calls Kairo's actual `PublicBrandReferenceHttpReader` for one homepage per brand. All three returned `unavailable` in the isolated runner. This is a **component diagnostic**, not a complete onboarding baseline. Production onboarding uses `SourceIntelligenceBrandReferenceReader`, its source router, additional page selection and media analyzer. These failures do not establish production failures.

The collector does not generate Brand Brains or run Hunter. The live Context.dev calls likewise did not run either downstream stage, so quality improvement is unmeasured. Full paired evaluation still requires an isolated Kairo runtime:

1. Run the complete existing onboarding reader, retaining its limits and selected URLs, for each brand.
2. Record both a paired same-page comparison and the five-page enrichment arm separately. Normalize provider documents into active source extracts; preserve field-level provenance. Website style observations remain provisional and require owner review.
3. Call the same existing `BrandBrainBuilder` with identical owner context, model, runtime, prompt and token budget on each arm. Validate proposals with its existing allow-list and source checks. Do not replace owner-confirmed fields.
4. Run identical Hunter retrieval plans through the existing shadow runner with identical budgets; compare Exa, Context.dev and combined retrieval separately. Do not call Context.dev results `agent-reach`. Search results retained by this collector are diagnostics, not already-qualified Hunter evidence.
5. Blind-review sector relevance, actionability, specificity, unsupported claims, duplicates, latency and cost. Publish per-brand paired measurements and failures; adopt only after the declared gate passes.

The recorded plan authorizes zero model calls. Declare a bounded budget before that stage; do not claim it ran from retrieval-only results.

## Verified contracts

Checked 2026-10-03 against https://docs.context.dev/openapi.json and official guides:

- https://docs.context.dev/api-reference/brand-intelligence/brand
- https://docs.context.dev/agent-quickstart
- https://www.context.dev/pricing

`POST /brand/retrieve`: `type: by_domain`, domain, `maxAgeMs: 0`; no-match may be HTTP 400 with `NOT_FOUND` or `WEBSITE_NOT_FOUND`.
`GET /web/styleguide`: domain query, response `styleguide` object; website observations are not a formal brand manual.
`POST /web/crawl`: `maxPages`, `maxDepth`, `useMainContentOnly`, per-page `metadata.success` and `markdown`.
`POST /web/search`: `numResults` minimum 10; no scraping/highlights add-ons requested. Free plan permits one concurrent request.

## Current state

Live Context.dev brand, styleguide, crawl and search calls completed on 2026-10-03. The connected tool did not expose per-request credit accounting, so actual credits remain unknown. Brand profiles varied in cache age; styleguide calls returned cache misses. Crawls returned 2 Nike, 1 Dishoom and 5 Linear pages. Kairo's baseline HTTP reader returned `unavailable` for all three in this environment. Brand Brain/Hunter comparison and quality judgment are pending. The POC is not complete or certified.
