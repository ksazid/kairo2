# Hunter Intelligence V2 + Ethical Engagement Intelligence (EEI)

Status: **Proposed production architecture**
Scope approval: **Human-approved for specification only**
Runtime status: **Disabled / no production behaviour changed**
Target repository: `ksazid/kairo2`
Baseline: `main` as inspected 2026-09-20

## 1. Objective

Evolve Kairo Hunter from evidence-backed search + deterministic ranking into a production-grade **Opportunity Intelligence Engine** that:

1. understands the Brand and its changing preferences;
2. retrieves broadly from multiple public-signal generators;
3. clusters signals into trends instead of treating URLs as opportunities;
4. predicts usefulness for the specific Brand;
5. deliberately balances relevance, diversity and exploration;
6. explains every recommendation with provenance;
7. learns from explicit user feedback and downstream publishing outcomes;
8. optimizes for **user value**, not screen time or addictive engagement.

EEI is the final control/reranking layer. It prevents the recommendation system from optimizing toward manipulative attention patterns.

## 2. North-star metrics

### Primary
`Useful Opportunity Rate = useful opportunities / meaningfully shown opportunities`

A useful opportunity is one that reaches at least one strong user-value state:
- saved;
- developed;
- generated;
- approved;
- published.

### Strong downstream metric
`Opportunity Performance Lift = performance of Hunter-originated published content / appropriate Brand historical baseline`

### Guardrail metrics
- duplicate rate;
- evidence completeness;
- source diversity;
- topic diversity;
- freshness;
- confidence calibration;
- dismissal reason distribution;
- save-to-develop conversion;
- develop-to-publish conversion;
- performance lift by channel/format/topic;
- recommendation saturation;
- manipulation-risk rejection rate;
- provider degradation rate;
- cost per useful opportunity.

Do **not** optimize Hunter for Discover clicks, session length, infinite scrolling, notification opens or raw time-in-product.

---

## 3. Existing implementation retained

The current implementation already provides a strong foundation and should be evolved rather than rewritten.

### Existing files / capabilities

- `apps/worker/src/hunter.ts`
  - multi-source query planning;
  - Agent Reach/public discovery;
  - evidence enrichment;
  - LLM judgment;
  - candidate persistence;
  - degraded-provider handling.

- `apps/worker/src/hunter-quality.ts`
  - deterministic post-model quality boundary;
  - exclusion handling;
  - similarity rejection;
  - fixed scoring adjustments;
  - source/topic diversity caps.

- `packages/domain/src/discovery.ts`
  - deterministic opportunity score;
  - duplicate checks;
  - status transitions.

- `packages/domain/src/discovery-service.ts`
  - signal persistence;
  - candidate qualification;
  - opportunity creation.

- `packages/domain/src/brand-intelligence.ts`
- `packages/domain/src/brand-intelligence-snapshot.ts`
- `packages/domain/src/brand-discovery-plan.ts`
  - Brand intelligence;
  - Topic Graph / discovery intent;
  - plan/snapshot lineage.

- `apps/api/src/agent-reach-exa-backend.ts`
- `apps/worker/src/discovery-provider.ts`
  - existing Agent Reach + Exa integration.

- `packages/domain/src/learning.ts`
- `packages/domain/src/learning-service.ts`
  - accepted learnings;
  - performance patterns;
  - experiments;
  - human authority on learning acceptance.

- `apps/api/migrations/0033_opportunity_feedback_closed_loop.sql`
  - early explicit feedback.

- `apps/api/migrations/0036_hunter_run_records.sql`
  - auditable Hunter run lineage.

These remain authoritative until superseded by versioned V2 contracts.

---

## 4. Target architecture

```text
Brand Intelligence
      +
Brand Preference State
      +
Current User Intent
      |
      v
Candidate Generators
      |
      v
Broad Retrieval (100-500 signals)
      |
      v
Normalization + Provenance
      |
      v
Semantic Retrieval / Pre-Ranking
      |
      v
Trend + Story Clustering
      |
      v
Signal / Trend Intelligence
      |
      v
Deep Analysis (bounded top set)
      |
      v
Opportunity Synthesis
      |
      v
Value Ranking
      |
      v
EEI Re-Ranking
      |
      v
5-10 Opportunity Intelligence Objects
      |
      v
Home / Discover / Grid / Preview / Generator
      |
      v
Feedback + Publish + Insights
      |
      v
Learner
      |
      +----> Brand Preference State
```

### Core invariant

**Signal != Trend != Opportunity**

- **Signal**: one source-level observation.
- **Trend**: a cluster of related, independently observed signals.
- **Opportunity**: Kairo's Brand-specific interpretation and actionable content move.

One opportunity may be supported by many signals across different sources/platforms.

---

## 5. Candidate generators

Hunter V2 must retrieve from several independent strategies. Each generator contributes a candidate pool; no single source owns the final ranking.

### Required generators

1. **Brand Core**
   - direct Brand topics;
   - products/services;
   - authority areas;
   - explicit discovery-plan topics.

2. **Audience Problem**
   - questions, objections, complaints, repeated concerns;
   - vocabulary used by the target audience.

3. **Category / Competitor**
   - industry movement;
   - category shifts;
   - public competitor/category activity without copying.

4. **Rising / Breaking**
   - recent acceleration;
   - emerging discussions;
   - new announcements.

5. **Outlier**
   - content performing unusually well relative to creator/category baseline.

6. **Adjacent Exploration**
   - semantically related but not identical to Brand-core topics;
   - bounded by EEI exploration budget.

7. **Evergreen**
   - recurrent questions;
   - durable education opportunities.

8. **Authority**
   - primary sources;
   - official sources;
   - industry research;
   - high-signal expert material.

9. **Cross-Platform Confirmation**
   - candidate subjects independently appearing in several source classes.

### Retrieval implementation

V2 should combine:
- lexical query search;
- semantic vector retrieval;
- Topic Graph retrieval;
- time-window retrieval;
- source-specific retrieval;
- accepted-learning retrieval;
- hard-negative avoidance.

---

## 6. Brand Preference State

Create a persistent Brand-scoped recommendation state.

### Canonical contract

```ts
interface BrandPreferenceState {
  schemaVersion: "1";
  workspaceId: string;
  brandId: string;
  snapshotVersion: string;

  longTerm: {
    topicWeights: PreferenceWeight[];
    audienceWeights: PreferenceWeight[];
    formatWeights: PreferenceWeight[];
    channelWeights: PreferenceWeight[];
    mechanismWeights: PreferenceWeight[];
  };

  shortTerm: {
    activeTopics: PreferenceWeight[];
    activeCampaignIds: string[];
    currentGoal?: string;
    currentChannel?: string;
    updatedAt: string;
  };

  negatives: {
    topics: NegativePreference[];
    audiences: NegativePreference[];
    mechanisms: NegativePreference[];
    sourceClasses: NegativePreference[];
  };

  performanceMemory: PerformancePreference[];
  explorationBudget: number; // 0..1
  updatedAt: string;
}
```

### Inputs

Long-term:
- Brand DNA;
- Topic Graph;
- discovery plan;
- accepted performance learnings;
- publishing history.

Short-term:
- current creation intent;
- latest saved/developed opportunities;
- campaign context;
- recent positive/negative explicit feedback.

### Important rule

A short-term preference must decay unless reinforced. A single click/save must never permanently redefine Brand identity.

---

## 7. Embeddings and semantic retrieval

### Recommended V2 implementation

- PostgreSQL / Neon remains the system of record.
- Enable `pgvector`.
- Use hosted embeddings first.
- Keep embedding provider behind a port so it can be changed without domain changes.

### Provider order

1. Hosted Voyage embedding API initially.
2. OpenAI embeddings as low-cost alternative.
3. BGE-M3 self-hosted only when usage justifies compute/operations.

### Planned port

```ts
interface EmbeddingPort {
  embedDocuments(inputs: EmbeddingInput[]): Promise<EmbeddingVector[]>;
  embedQuery(input: EmbeddingInput): Promise<EmbeddingVector>;
}
```

### Vector entities

Embeddings should be stored for:
- public signals;
- trend clusters;
- opportunities;
- Brand topics;
- accepted learnings;
- published content mechanisms.

No user-sensitive trait inference is permitted.

---

## 8. Trend Intelligence

Freshness alone is not a trend.

### Canonical contract

```ts
type TrendStage =
  | "emerging"
  | "rising"
  | "accelerating"
  | "mature"
  | "saturated"
  | "declining"
  | "evergreen";

interface TrendIntelligence {
  trendId: string;
  topic: string;
  stage: TrendStage;

  velocity: number;
  acceleration: number;
  crossSourceSpread: number;
  crossPlatformSpread: number;
  creatorOutlier: number;
  categoryOutlier: number;
  saturation: number;
  freshness: number;

  evidenceConfidence: number;
  firstObservedAt: string;
  lastObservedAt: string;
  supportingSignalIds: string[];
}
```

### Deterministic first implementation

V2 should initially calculate trend features from observable inputs:
- signal count by time bucket;
- source/publisher independence;
- first/last observation;
- content age;
- available engagement velocity;
- creator-relative baseline;
- category-relative baseline;
- duplicate-normalized frequency.

No ML is required for the first release.

---

## 9. Outlier intelligence

Do not equate raw popularity with opportunity.

### Required measures

```text
CreatorRelativeOutlier = observed performance / creator historical baseline

CategoryRelativeOutlier = observed performance / comparable-category baseline

Velocity = engagement signal / content age

Acceleration = recent velocity / earlier velocity
```

If public engagement metrics are unavailable, mark the feature as unknown rather than fabricating a score.

---

## 10. Content Mechanism extraction

Hunter must understand **why** an observed piece of content appears to work without copying it.

### Canonical mechanism

```ts
interface ContentMechanism {
  hookType?: string;
  promise?: string;
  structure?: string;
  emotion?: string[];
  proofType?: string[];
  visualMechanism?: string[];
  ctaType?: string;
  format?: string;
  confidence: number;
}
```

Examples:
- curiosity gap;
- transformation;
- counter-intuitive claim;
- diagnostic checklist;
- tutorial;
- comparison;
- story/reveal;
- proof/demo;
- social proof.

Mechanisms may influence ranking and generation, but source wording/content must not be copied.

---

## 11. Evidence Confidence

Evidence strength must be separate from relevance and popularity.

### Components

Positive:
- primary-source evidence;
- independent corroboration;
- cross-source support;
- cross-platform support;
- source completeness;
- author/publisher identity;
- publication timestamp;
- content hash/provenance;
- direct fetched evidence.

Penalties:
- single-source dependency;
- circular reporting;
- weak provenance;
- conflicting evidence;
- stale evidence;
- unavailable source;
- unverifiable engagement claim.

### Output

Expose a calibrated label:
- **High**
- **Medium**
- **Emerging**

and preserve the numeric internal confidence.

---

## 12. Opportunity Intelligence Object

This becomes the single source of truth for all recommendation UI.

### Canonical contract

```ts
interface OpportunityIntelligence {
  schemaVersion: "2";

  id: string;
  workspaceId: string;
  brandId: string;

  title: string;
  sanitizedSummary: string;
  whyNow: string;
  brandReason: string;
  audienceReason: string;

  trend?: TrendIntelligenceSummary;
  mechanism?: ContentMechanism;

  proposedAngle: string;
  hook?: string;
  targetAudience?: string;
  objective?: string;
  recommendedFormat?: string;
  recommendedChannel?: string;

  evidence: {
    signalIds: string[];
    sourceCount: number;
    independentPublisherCount: number;
    sourceClasses: string[];
    confidence: number;
    confidenceLabel: "High" | "Medium" | "Emerging";
  };

  scores: OpportunityValueScores;
  explanation: RecommendationExplanation;

  provenance: {
    snapshotVersion: string;
    planVersion: string;
    hunterRunId: string;
    rankingVersion: string;
    eeiVersion: string;
  };

  createdAt: string;
}
```

### UI invariant

Home, Discover, Grid, Preview and content-generation entry points **must consume this canonical object**.

They may change presentation length/layout, but they must not independently regenerate the recommendation meaning.

This is the application-wide sanitization/single-source-of-truth boundary.

---

## 13. Opportunity Value scoring

The current fixed V1 score remains the fallback until V2 is validated.

### V2 feature groups

```text
Brand Fit
Audience Need
Evidence Strength
Trend Momentum
Originality
Actionability
Expected Brand Performance
Freshness
Authority
Learning Value
```

### Penalties

```text
Duplication
Saturation
Weak Provenance
Manipulation Risk
Brand Boundary Risk
Overexposure
Low Confidence
Recent Rejection Similarity
```

### Initial deterministic score

Weights remain transparent and versioned.

Do not use one universal "viral score".

Eventually weights may become Brand-conditioned after sufficient data exists.

---

## 14. Multi-stage ranking

### Stage A — Retrieval

Target: ~100-500 raw signals.

Use:
- query search;
- vector similarity;
- topic graph;
- time windows;
- generator-specific sources.

Optimize for **recall**.

### Stage B — Pre-rank

Target: reduce to ~30-60.

Cheap deterministic features:
- Brand semantic similarity;
- topic graph fit;
- freshness;
- basic evidence quality;
- source duplication;
- exclusion boundaries;
- hard-negative similarity.

### Stage C — Trend/story clustering

Group semantically equivalent signals.

Output:
- trend clusters;
- corroboration;
- independent publisher/source counts.

### Stage D — Deep intelligence

Bounded top candidates only.

LLM tasks:
- mechanism extraction;
- Brand interpretation;
- content gap analysis;
- actionable angle synthesis;
- evidence-grounded explanation.

LLM does **not** own the persistence threshold.

### Stage E — Value rank

Rank candidate opportunities using deterministic/versioned features plus, later, a learned ranker.

### Stage F — EEI re-rank

Final list must enforce:
- diversity;
- novelty;
- source independence;
- exploration;
- Brand boundaries;
- manipulation-risk rules;
- recommendation saturation limits.

---

## 15. EEI contract

### Objective

Maximize useful outcomes while preserving user agency.

### Allowed optimisation targets
- Save;
- Develop;
- Generate;
- Approve;
- Publish;
- user-declared relevance;
- Brand-relative performance lift;
- successful completion;
- sustained satisfaction.

### Explicitly prohibited targets
- time-in-app for its own sake;
- infinite-scroll depth;
- compulsive refresh;
- artificial urgency;
- fear/anxiety exploitation;
- hidden opt-outs;
- deceptive re-engagement;
- sensitive-trait targeting;
- rage/outrage amplification as an objective.

### Planned interface

```ts
interface EEIService {
  score(input: EEIInput): Promise<EEIScore>;
  rerank(input: EEIRerankInput): Promise<OpportunityIntelligence[]>;
  explain(input: EEIExplainInput): RecommendationExplanation;
  evaluateManipulationRisk(input: OpportunityCandidate): ManipulationRisk;
}
```

---

## 16. Feedback events V2

Current `seen/dismissed` feedback is insufficient.

### Canonical events

```ts
type OpportunityFeedbackAction =
  | "impression"
  | "opened"
  | "saved"
  | "dismissed"
  | "not_relevant"
  | "seen_before"
  | "wrong_audience"
  | "wrong_brand"
  | "wrong_timing"
  | "not_credible"
  | "developed"
  | "generated"
  | "heavily_edited"
  | "approved"
  | "published"
  | "performance_observed";
```

### Signal strength guidance

Strong positive:
- developed;
- published;
- published + positive Brand-relative lift.

Medium positive:
- saved;
- generated;
- approved.

Weak positive:
- opened.

Strong negative:
- not relevant;
- wrong audience;
- wrong brand;
- not credible;
- seen before.

Ambiguous:
- impression;
- saved but never developed;
- heavy rewrite.

Do not treat "no click" as a definitive negative without enough exposure/context.

---

## 17. Learning loop

```text
Opportunity shown
   |
   +--> explicit feedback
   |
   +--> development/generation behaviour
   |
   +--> edits
   |
   +--> approval
   |
   +--> publishing
   |
   +--> insights
   |
   v
Outcome attribution
   |
   v
Candidate learning
   |
   v
Human-approved learning (existing governance)
   |
   v
Brand Preference State
   |
   v
Next retrieval/ranking cycle
```

The existing rule that accepted performance learning requires human authority remains unchanged.

---

## 18. Planned database migrations

These names are reserved **for implementation planning only**. They must not be applied until implementation scope is separately approved.

### `0039_hunter_vector_intelligence.sql`

Expected changes:
- enable `vector` extension;
- add `public_signal_embeddings`;
- add `opportunity_embeddings`;
- add `brand_intelligence_embeddings`;
- embedding provider/model/version metadata;
- HNSW indexes after volume justifies them.

### `0040_hunter_trend_clusters.sql`

Tables:
- `trend_clusters`;
- `trend_cluster_signals`;
- versioned trend feature JSON;
- first/last observed timestamps;
- trend stage;
- confidence.

### `0041_hunter_opportunity_intelligence_v2.sql`

Expected:
- V2 intelligence payload;
- ranking version;
- EEI version;
- trend linkage;
- canonical sanitized copy;
- explanation payload;
- evidence confidence.

Prefer additive migration; do not destroy V1 columns until V2 is certified.

### `0042_hunter_feedback_v2.sql`

Expected:
- append-only feedback events;
- reason code;
- surface;
- position;
- ranking version;
- exposure context;
- content lineage;
- timestamp;
- idempotency key.

### `0043_brand_preference_state.sql`

Expected:
- versioned Brand Preference State snapshots;
- source event range;
- snapshot/version lineage;
- decay/version metadata.

### `0044_hunter_outcome_attribution.sql`

Expected:
- opportunity -> generated content -> published content;
- performance observation linkage;
- baseline used;
- performance-lift features.

All migrations must preserve rollback/recoverability and be independently testable.

---

## 19. Planned domain/services

### New domain modules

`packages/domain/src/opportunity-intelligence.ts`
- V2 contracts;
- validation;
- score/explanation invariants.

`packages/domain/src/brand-preference-state.ts`
- preference projection;
- decay;
- negative memory;
- versioning.

`packages/domain/src/trend-intelligence.ts`
- trend features;
- stage calculation;
- confidence.

`packages/domain/src/eei.ts`
- ethical objective;
- manipulation-risk rules;
- diversity/exploration constraints.

`packages/domain/src/hunter-ranking.ts`
- feature contracts;
- deterministic V2 rank;
- versioned ranking.

### New worker modules

`apps/worker/src/hunter-retrieval.ts`
- candidate generator orchestration.

`apps/worker/src/hunter-semantic-retrieval.ts`
- embedding/vector retrieval.

`apps/worker/src/hunter-clustering.ts`
- story/trend clustering.

`apps/worker/src/hunter-trend-intelligence.ts`
- momentum/outlier features.

`apps/worker/src/hunter-deep-analysis.ts`
- bounded LLM analysis.

`apps/worker/src/hunter-eei-reranker.ts`
- final EEI rerank.

`apps/worker/src/hunter-feedback-projector.ts`
- preference-state inputs.

### Existing modules to evolve, not replace immediately

- `apps/worker/src/hunter.ts`
- `apps/worker/src/hunter-quality.ts`
- `packages/domain/src/discovery.ts`
- `packages/domain/src/discovery-service.ts`

They should act as V1 fallback until V2 shadow evaluation passes.

---

## 20. Provider ports

### Embedding

```ts
interface EmbeddingPort {
  embedQuery(input: EmbeddingInput): Promise<EmbeddingVector>;
  embedDocuments(inputs: EmbeddingInput[]): Promise<EmbeddingVector[]>;
}
```

### Semantic reranker

```ts
interface SemanticRerankerPort {
  rerank(input: {
    query: string;
    documents: RerankDocument[];
    limit: number;
  }): Promise<RerankResult[]>;
}
```

### Trend/source adapter

Existing public-content ports remain authoritative.

Optional adapters may add richer source metrics, but the domain must tolerate missing engagement metrics.

---

## 21. Initial provider strategy and cost guardrail

Recommended initial dependencies:
- existing Agent Reach + Exa;
- Neon PostgreSQL;
- pgvector;
- hosted Voyage embeddings/reranker while free allowance is available;
- YouTube Data API default quota;
- GDELT/RSS/public feeds;
- existing OpenAI-compatible model runtime for bounded deep analysis.

Avoid initially:
- Pinecone;
- dedicated Qdrant;
- GPU hosting;
- paid enterprise social-listening platform;
- custom neural ranker;
- Exa Deep Search for each opportunity;
- unofficial Google Trends scraping as a hard dependency.

### Cost guardrail

Hunter should log:
- search requests;
- pages fetched;
- embedding tokens;
- rerank tokens;
- LLM input/output tokens;
- total estimated run cost;
- cost per persisted opportunity;
- cost per useful opportunity.

The existing Hunter run-record contract should be versioned to include these metrics rather than silently changing semantics.

---

## 22. Model routing

Do not run an expensive model across the raw corpus.

Recommended flow:

```text
100-500 retrieval candidates
      |
cheap deterministic + semantic filters
      |
30-60 candidates
      |
clustering / rerank
      |
10-20 deep-analysis candidates
      |
5-10 final opportunities
```

The runtime must have:
- explicit token budget;
- explicit tool-call budget;
- fallback model;
- bounded context;
- model version in provenance.

---

## 23. Exploration strategy

Hunter must avoid preference collapse.

Initial deterministic policy:

- 60-75% core high-confidence recommendations;
- 15-25% adjacent opportunities;
- 5-15% bounded exploration.

Exact values are configuration, not hard-coded product truth.

Later, replace static exploration allocation with a contextual-bandit strategy only after enough outcome data exists.

---

## 24. Learned ranker — intentionally deferred

Do not train a ranker in the first V2 slice.

Prerequisites before training:
- sufficient meaningful impressions;
- positive and negative labels;
- enough Brands to avoid pure memorization;
- publish/outcome attribution;
- offline evaluation dataset;
- V1/V2 baseline;
- minimum sample-size policy.

Initial stack:
- deterministic features;
- embeddings;
- semantic reranker;
- bounded LLM reasoning;
- EEI reranking.

Later candidates:
- LightGBM / XGBoost;
- contextual bandit;
- sequence-aware preference model.

---

## 25. Evaluation rubric

Every V2 run must be evaluable offline against a frozen fixture set.

### Required dimensions

1. **Relevance**
2. **Evidence grounding**
3. **Actionability**
4. **Originality**
5. **Freshness/trend correctness**
6. **Diversity**
7. **Brand fit**
8. **Audience fit**
9. **Explanation quality**
10. **Manipulation risk**
11. **Duplicate suppression**
12. **Cost**
13. **Latency**

### Regression gates

V2 must not ship if it:
- produces more duplicate recommendations than V1;
- loses source provenance;
- shows unsupported trend claims;
- lowers Brand relevance;
- increases manipulative recommendation patterns;
- bypasses Brand exclusions;
- breaks V1 fallback;
- exceeds agreed run budget without explicit approval.

---

## 26. Rollout slices

### Slice HI2-01 — Contracts + schemas
Runtime: disabled.

Deliver:
- V2 domain contracts;
- Opportunity Intelligence schema;
- EEI contract;
- feedback V2 event contract;
- Brand Preference State contract;
- deterministic validation tests.

No provider calls.
No UI behavior change.

### Slice HI2-02 — Vector foundation
Runtime: shadow only.

Deliver:
- pgvector;
- embedding port;
- vector persistence;
- backfill for bounded existing corpus;
- semantic similarity diagnostics.

No ranking authority.

### Slice HI2-03 — Multi-generator retrieval
Runtime: shadow.

Deliver:
- retrieval generators;
- candidate provenance;
- broader recall;
- retrieval metrics.

Existing Hunter remains user-facing.

### Slice HI2-04 — Trend clustering + intelligence
Runtime: shadow.

Deliver:
- story clustering;
- trend states;
- corroboration;
- source independence;
- deterministic momentum/outlier features.

### Slice HI2-05 — V2 pre-rank + deep analysis
Runtime: shadow.

Deliver:
- pre-ranker;
- semantic reranker;
- bounded deep analysis;
- V2 Opportunity Intelligence objects.

Compare against V1.

### Slice HI2-06 — EEI reranker
Runtime: shadow then limited.

Deliver:
- diversity;
- exploration;
- manipulation-risk policy;
- explanation;
- saturation controls.

### Slice HI2-07 — Feedback V2 + preference state
Runtime: limited.

Deliver:
- append-only feedback;
- preference projection;
- negative memory;
- short-term decay.

### Slice HI2-08 — Outcome attribution
Runtime: limited.

Deliver:
- opportunity -> content -> publish -> performance lineage;
- Brand-relative lift;
- usefulness metrics.

### Slice HI2-09 — User-facing controlled rollout
Requires separate human approval for production enablement.

Deliver:
- selected Brands see V2;
- V1 fallback;
- comparison dashboards;
- rollback switch.

### Slice HI2-10 — Learned ranker exploration
Only after data gate passes.

---

## 27. UI contract

The UI must not display raw model output directly.

Use presenter/sanitizer logic over the canonical Opportunity Intelligence object.

### Display hierarchy

Card:
- concise opportunity;
- one-line reason;
- confidence/trend state;
- recommended format;
- evidence count;
- primary action.

Preview:
- why now;
- Brand fit;
- audience;
- evidence;
- mechanism;
- content gap;
- suggested angle;
- hook;
- provenance.

Developer/raw evidence can live behind an explicit evidence/details view.

This avoids the current repetition/overload problem and ensures the same recommendation meaning across Home, Discover, Grid and Preview.

---

## 28. PES v2 governance

Every implementation slice must:
- have one explicit objective;
- declare budget before execution;
- retain V1 fallback until certification;
- use typed/versioned contracts;
- keep evidence/provenance;
- run deterministic checks before model review;
- record failed attempts;
- remain reversible;
- require human approval for certification/release/production enablement.

This specification itself changes no production behavior.

---

## 29. External research informing this design

Architecture patterns were adapted from publicly documented recommendation-system practices rather than copied implementations.

References:
- Meta / Instagram multi-stage recommendation systems:
  https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/
- Instagram model scaling:
  https://engineering.fb.com/2025/05/21/production-engineering/journey-to-1000-models-scaling-instagrams-recommendation-system/
- Meta explicit feedback / recommendation adaptation:
  https://engineering.fb.com/2026/01/14/ml-applications/adapting-the-facebook-reels-recsys-ai-model-based-on-user-feedback/
- YouTube recommendation satisfaction/quality:
  https://blog.youtube/inside-youtube/on-youtubes-recommendation-system/
- TikTok recommendation diversity:
  https://newsroom.tiktok.com/how-we-recommend-videos
- Pinterest learned retrieval:
  https://medium.com/pinterest-engineering/establishing-a-large-scale-learned-retrieval-system-at-pinterest-eb0eaf7b92c5
- LinkedIn next-generation feed:
  https://www.linkedin.com/blog/engineering/feed/engineering-the-next-generation-of-linkedins-feed
- Spotify contextual bandits:
  https://research.atspotify.com/2025/9/calibrated-recommendations-with-contextual-bandits-on-spotify-homepage

---

## 30. Implementation approval boundary

This document freezes the proposed architecture.

**No database migration, provider addition, production ranking change, UI behavior change or production enablement is authorized by this specification alone.**

The next safe PESv2 step is **HI2-01: Contracts + Schemas**, which is runtime-disabled and reversible.
