# VS-03 Hermes Runtime Spike

Status: **CONDITIONAL PASS — promote reasoning-only adapter, not default Hermes tool surface**

Evaluated upstream: `NousResearch/hermes-agent@d2c6af3aa258c47d64c41a56fe9ff61815334e17`
Observed: 2026-08-13
Slice: VS-03 — Hunter and Discover

## Decision for VS-03

Hermes may be promoted behind Kairo's `AgentRuntimePort` **only as a reasoning runtime with no Hermes-native tools enabled**.

VS-03 must not run Hermes with the upstream `hermes-api-server`, `hermes-cli`, `hermes-acp`, `terminal`, `file`, `browser`, `skills`, `memory`, `code_execution`, `delegation`, `cronjob`, messaging, Home Assistant or other broad upstream toolsets.

Public acquisition remains a separate Kairo path:

`Kairo Hunter -> ToolGateway -> DiscoverySourceProvider -> Agent Reach / safer provider -> normalized public evidence -> Hermes reasoning-only invocation -> Kairo schema/policy validation -> authoritative Kairo state`

This preserves DEC-005 and avoids the unsafe architecture `Hermes -> unrestricted shell -> Agent Reach`.

## Evidence

### Tool surface

At the pinned revision, upstream `toolsets.py` defines the API-server composite as a broad toolset including terminal/process, read/write/patch/search files, browser automation, skills management, memory, code execution/delegation, cron jobs and other integrations. That default surface is unsuitable for Kairo Brand intelligence.

The same pinned revision exposes explicit toolset filtering through `model_tools.get_tool_definitions(enabled_toolsets, disabled_toolsets, ...)`. When `enabled_toolsets` is not `None`, it resolves only the explicitly named toolsets, then applies registry availability filtering. An explicit empty enabled-toolset list therefore yields no upstream tools. Plugin-provided toolsets also flow through the same allow-list path at this revision rather than bypassing it.

**Kairo rule:** use an explicit empty allow-list for the VS-03 Hermes adapter. Never rely on an implicit/default tool surface or a deny-list.

### Secrets

Hermes resolves model-provider credentials inside its runtime process. Kairo must not place provider API keys in agent prompts, task payloads, Brand context, PostgreSQL records or browser code. The Kairo -> Hermes transport may use a service-auth credential, but that credential is transport-only and never becomes model context.

The Hermes process owns any provider credential it needs; Kairo's invocation contract sends only scoped task/context, model policy and output schema metadata.

### Tenant/session isolation

Kairo remains authoritative for Workspace/Brand membership. Hermes receives a bounded invocation envelope only after Kairo has resolved the Brand and assembled approved context. The Hermes adapter does not receive database credentials and cannot independently fetch Brand state.

Each invocation must use a Kairo-generated correlation/invocation id. VS-03 does not rely on Hermes persistent memory for Brand state. No Hermes memory tool/provider is enabled for the reasoning-only profile.

### Structured output

Hermes output is never directly authoritative. The adapter requires a declared Kairo output schema/version. Returned text must parse into the expected JSON shape and pass Kairo validation before it can influence an Opportunity. Malformed or schema-invalid output is a failed invocation and falls back/retries according to Kairo policy; it is never stored as authoritative domain state.

### Timeout/cancellation

Kairo owns the outer timeout/cancellation boundary. A Hermes request exceeding the invocation budget is aborted by the adapter and recorded as a failed attempt. No background continuation is permitted to mutate Kairo state after cancellation because Hermes has no state-write tool or database credential.

### Provider/model metadata

The adapter records provider/model identifiers returned by the runtime where available, plus Kairo runtime version, latency and Kairo-computed/returned usage metadata. It never records secrets. Missing cost metadata must be represented as unknown rather than fabricated.

### Disable/fallback

Hermes is replaceable. `DirectModelRuntime` remains the required fallback implementation of `AgentRuntimePort`. Disabling Hermes changes routing/configuration only; Hunter domain logic and authoritative PostgreSQL state remain unchanged.

## Security findings

1. **Default API-server profile is too broad for Kairo.** Treat running the upstream default profile as a policy violation.
2. **Deny-listing is insufficient.** Kairo uses an explicit empty Hermes tool allow-list for VS-03.
3. **No Hermes persistent memory for Brand state.** Brand memory remains Kairo-owned and Brand-scoped.
4. **No direct provider/social/discovery secrets in prompts.** Secrets remain runtime/tool-adapter internals.
5. **No direct Hermes -> Agent Reach shell path.** Agent Reach is invoked only by the Kairo-owned discovery provider boundary.

## Promotion conditions

Hermes is promoted for VS-03 only if the concrete adapter tests prove:

- explicit `enabled_toolsets=[]` (or an equivalent runtime-enforced zero-tool configuration) is applied on every invocation;
- transport fails closed when runtime configuration cannot prove the zero-tool profile;
- database/social/discovery credentials are absent from the process invocation payload;
- schema-invalid output is rejected;
- timeout/cancellation prevents late Kairo state writes;
- Brand scope is assembled before invocation and is not resolved by Hermes;
- DirectModelRuntime can be selected without Hunter-domain changes.

Until those tests exist and pass, this document authorizes only the adapter implementation, not an unrestricted Hermes deployment.

## Verdict

**CONDITIONAL PASS** for a Kairo-owned, reasoning-only Hermes adapter.

**FAIL** for using the upstream default Hermes API-server/CLI tool surface as Kairo's runtime.
