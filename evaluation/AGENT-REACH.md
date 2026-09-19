# Agent Reach Evaluation for Kairo

Status: Approved for controlled VS-03 implementation behind Kairo provider boundaries
Decision: DEC-005
Approved by: Sazid Khan
Approved at: 2026-08-12T19:49:00+02:00

## Evaluated upstream

- Repository: `Panniantong/Agent-Reach`
- Package: `agent-reach`
- Observed package version: `1.5.0`
- Licence: MIT
- Evaluated upstream `main` SHA: `93ae1d18c37b707dec053c7c4f9d91cd8ef8943d`
- Language/runtime: Python 3.10+

The upstream revision above is an evaluation fingerprint, not an automatic-update channel. Kairo must explicitly review and pin any promoted revision.

## Kairo role

Agent Reach is approved as a **replaceable public-discovery capability**, not as Kairo's system of record and not as a production publishing connector.

Primary intended use:

- Global Hunter public-signal acquisition.
- Web/RSS/YouTube/GitHub discovery and research.
- Configurable X/Reddit/Instagram/LinkedIn public research where policy, credentials and platform terms permit.
- Fallback/alternative discovery paths when a source-specific provider is unavailable.

Kairo remains authoritative for:

- Workspace and Brand isolation;
- tool permissions and capability routing;
- secrets and credential policy;
- source policy and legal/privacy constraints;
- normalized Signal and evidence contracts;
- provenance and freshness;
- budgets, cancellation and timeouts;
- Truth/Claims policy;
- domain state, content lineage and Brand learning.

## Interaction boundary

Preferred flow:

`Hermes role -> Kairo ToolGateway -> DiscoverySourceProvider -> AgentReachProvider -> approved upstream source`

Hermes must not receive unrestricted shell access to `agent-reach` or arbitrary upstream CLIs. Agent Reach must be invoked through Kairo-owned scoped capabilities with validated structured results.

## Dynamic Skill treatment

Agent Reach is represented in Kairo's governed Skill/Capability system so it can be enabled, disabled, pinned, benchmarked or replaced without changing core Hunter logic.

Conceptual capability examples:

- `public-web-search`
- `public-content-read`
- `youtube-discovery`
- `rss-discovery`
- `github-public-research`
- source-specific social discovery where separately permitted

The Skill describes how an agent should use discovery evidence. `AgentReachProvider` performs controlled external retrieval. These are distinct from Kairo-owned safety controls.

## Promotion spike

Before Agent Reach is promoted for VS-03 runtime use, prove:

1. Exact revision/package pinning and reproducible installation.
2. Provider can return validated structured results rather than unbounded terminal text.
3. Source URL/platform/retrieval time/provider provenance are retained.
4. Timeout and cancellation work under Kairo budgets.
5. No unrestricted shell or arbitrary network capability is exposed to Hermes.
6. Secrets/session material remain outside free-form agent context and logs.
7. Cross-Brand private context is never sent to public discovery tools unless explicit policy permits it.
8. Source-specific policy can disable a backend independently.
9. Agent Reach failure degrades safely to another provider or an explicit unavailable state.
10. Removing Agent Reach does not require rewriting Hunter domain state or persisted Signal contracts.

## Production posture

Agent Reach may be useful for discovery and controlled research, but Kairo should prefer official or specifically approved APIs/providers for authoritative publishing, connected-account operations and performance metrics. Browser-session/cookie-backed upstreams require additional security, privacy and platform-policy review before any production use.
