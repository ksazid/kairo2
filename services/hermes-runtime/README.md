# Kairo Hermes Runtime

This service is Kairo's governed reasoning-runtime boundary around a pinned Hermes Agent release. It is not a general Hermes chat server and it is not an authoritative Kairo datastore.

## Upstream pin

- Repository: `NousResearch/hermes-agent`
- Hermes version: `0.18.2`
- Tag: `v2026.7.7.2`
- Exact commit: `9de9c25f620ff7f1ce0fd5457d596052d5159596`

The dependency is pinned to the exact commit in `pyproject.toml`. Do not update it without a fresh security/runtime review.

## Runtime boundary

```text
Kairo API
  |
  | KAIRO_HERMES_SERVICE_TOKEN
  v
Kairo Hermes Runtime
  |-- Groq        (primary)
  `-- OpenRouter  (fallback in resilient mode only)
```

Kairo sends a bounded role, Brand/Workspace scope, approved context version, task context, output schema and budget. Provider credentials never cross back into Kairo.

The service accepts only `POST /kairo/v1/invoke` and requires:

- bearer service authentication;
- the exact Kairo Hermes policy fingerprint;
- `enabledTools: []`;
- one of `resilient` or `primary-only` routing modes.

The service starts and invokes Hermes with a zero-tool profile, isolated ephemeral Hermes home, no project-context files, no persistent memory, no trajectory saving and no checkpoints. The wrapper disables Hermes' normal persistent file logging before agent construction. Any detected tool, memory or file-log surface fails closed.

## Secret placement

Configure these **only on the Hermes runtime service**:

- `KAIRO_HERMES_SERVICE_TOKEN`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`

Configure these **only on Kairo API**:

- `KAIRO_HERMES_ENDPOINT`
- `KAIRO_HERMES_SERVICE_TOKEN`

`KAIRO_HERMES_SERVICE_TOKEN` is a separate random service-to-service secret. It is not either provider API key. The same value must be configured on Kairo API and the Hermes service.

Never commit any of these values. Never paste them into Brand Brain, prompts, browser configuration, GitHub issues, logs or benchmark evidence.

## Provider configuration

The service also requires explicit non-secret provider policy configuration.

### Primary — Groq

- `HERMES_PRIMARY_PROVIDER=groq`
- `HERMES_PRIMARY_BASE_URL=https://api.groq.com/openai/v1`
- `HERMES_PRIMARY_MODEL=openai/gpt-oss-120b`
- `HERMES_PRIMARY_INPUT_USD_PER_1M_TOKENS`
- `HERMES_PRIMARY_OUTPUT_USD_PER_1M_TOKENS`
- `HERMES_PRIMARY_PRICING_VERSION`

Before allowing Brand-private traffic, enable **Zero Data Retention** for the Groq organization/project in Groq Data Controls. Groq's inference API does not give this wrapper a reliable per-request ZDR switch, so this is an explicit deployment precondition rather than something Kairo pretends to verify in code.

### Fallback — OpenRouter

- `HERMES_FALLBACK_PROVIDER=openrouter`
- `HERMES_FALLBACK_BASE_URL=https://openrouter.ai/api/v1`
- `HERMES_FALLBACK_MODEL=<explicit pinned model>`
- `HERMES_FALLBACK_INPUT_USD_PER_1M_TOKENS`
- `HERMES_FALLBACK_OUTPUT_USD_PER_1M_TOKENS`
- `HERMES_FALLBACK_PRICING_VERSION`

The wrapper enforces OpenRouter's per-request provider preferences:

- Zero Data Retention (`zdr: true`);
- no data-collecting provider endpoints (`data_collection: deny`);
- parameter compatibility (`require_parameters: true`) so JSON-mode support cannot be silently dropped.

If no eligible private endpoint exists, the fallback fails rather than weakening the privacy requirement.

For controlled benchmark evidence, never use a dynamic model router such as `openrouter/free`. Pin one exact provider/model and invoke Hermes through Kairo's `primary-only` mode so baseline and challenger cannot silently execute on different models.

Pricing values are operator-owned evidence, not hard-coded assumptions. Verify the provider's current rate/plan at configuration time. If a selected route is genuinely zero-cost, configure `0` with a dated pricing-version label that identifies the verified provider/model/plan snapshot.

## Routing semantics

### `resilient`

1. Call Groq primary.
2. Fall back to OpenRouter only for an eligible transport/capacity failure such as rate limiting, timeout/connection failure or provider 5xx.
3. Invalid requests, policy failures, schema failures and other non-eligible failures do not silently change provider.
4. OpenRouter fallback still has to satisfy the ZDR/no-collection/parameter-support policy above.

### `primary-only`

Call Groq only. No fallback is attempted. This is the required mode for Native-vs-challenger qualification runs.

## Cost and evidence

Every successful result must provide:

- provider;
- model;
- input token count;
- output token count;
- calculated USD cost using the configured pricing snapshot;
- pricing-version label;
- latency;
- pinned Hermes runtime version.

Missing token usage fails closed. A measured cost above Kairo's invocation budget fails rather than being recorded as an apparently valid run.

## Health

- `GET /health/live` — process is alive.
- `GET /health/ready` — configuration and the zero-tool startup guard completed successfully.

Do not route Kairo traffic until readiness is successful.

## Container

Build from repository root using:

```text
docker build -f services/hermes-runtime/Dockerfile .
```

The runtime image runs as a non-root user with an ephemeral isolated Hermes home and access logging disabled.

## Deployment governance

This repository content prepares the service; it does **not** authorize deployment or secret entry. Deployment requires the normal Kairo exact-SHA certification/release/environment approvals and rollback readiness.

At deployment time:

1. deploy Hermes separately from `kairo-api`;
2. enable Groq ZDR in Data Controls;
3. configure provider keys only on Hermes;
4. verify current provider/model pricing and configure the dated pricing snapshots;
5. verify `/health/ready`;
6. configure only the Hermes endpoint + service token on Kairo API;
7. verify a synthetic, non-publishing model call and its token/cost provenance;
8. only then run governed qualification evidence.
