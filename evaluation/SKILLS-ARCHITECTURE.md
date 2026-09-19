# Content Intelligence Engine Skill and Agent Architecture

Status: Approved input to TRD
Date: 2026-08-12

## Decision summary

CIE will use an extensible, versioned skill architecture. The system will not freeze one permanent skill implementation for each capability. Skills may vary by Brand and may be added, disabled, replaced, benchmarked or upgraded under policy.

## Skill scopes

CIE supports three conceptual skill scopes:

- Global skills — reusable capabilities available across the product where policy permits.
- Workspace skills — capabilities approved for a specific Workspace.
- Brand skills — Brand-specific capability selections, preferences and overrides.

Safety-critical platform controls are not replaceable Brand skills.

## Capability routing

A capability may have multiple eligible implementations. Examples include hook generation, carousel planning, Instagram adaptation, LinkedIn adaptation, profile analysis, transcription analysis, humanisation and content strategy.

CIE may route a task to a selected implementation based on Brand configuration, compatibility, policy, benchmark evidence, cost and historical performance.

The user may eventually select skills per Brand. CIE may also recommend a skill after sufficient evidence, but automatic switching must follow an explicit policy and remain auditable.

## Candidate skill sources

Candidate sources include:

- CIE-owned skills;
- approved GitHub repositories;
- skills.sh-compatible packages;
- EvoMap-compatible assets;
- private Workspace skills;
- future CIE marketplace packages.

External skills must never be trusted merely because they are installable.

## Priority content-skill candidates

The following are evaluation candidates rather than frozen dependencies:

- Deepika Rao: viral-hook-library;
- Deepika Rao: social-carousel-gen;
- Deepika Rao: instagram-transcriber;
- Deepika Rao: instagram-profile-analyzer;
- sergebulaev/instagram-skills;
- sergebulaev/linkedin-skills;
- Corey Haines marketingskills;
- Roman Knox social-caption skill;
- other future approved channel or strategy skills.

Deepika's packages receive priority evaluation because they are described as part of an operating content engine, but CIE must not depend on packages whose distribution, licence, provenance or security cannot be verified.

## CIE-owned/non-replaceable controls

The following remain CIE platform responsibilities and are not delegated to arbitrary installed skills:

- Workspace and Brand isolation;
- content lineage and provenance;
- Truth / Claims Gate;
- hard policy enforcement;
- publishing authorisation;
- spend and workflow budgets;
- tenant-safe secret handling;
- performance truth and metric provenance;
- Brand Learning policy;
- skill benchmarking and approval;
- cross-Brand privacy policy.

The Critic may use skills internally, but final hard-fail policy is controlled by CIE.

## Skill governance

Each executable external skill should retain metadata such as source, author, licence, upstream URL, pinned revision or package version, capability, permissions, network access, secrets required, risk classification, compatibility, benchmark status, approval status and last review time.

Production behaviour must not change merely because an upstream repository changes. Updates are evaluated and promoted explicitly.

## Benchmarking

CIE should be able to compare multiple implementations of the same capability using controlled evaluation and, where valid, real Brand performance data.

Examples:

- Hook Skill A vs Hook Skill B;
- Carousel Skill A vs Carousel Skill B;
- Instagram adapter A vs B.

Evaluation may include human preference, Brand fit, truthfulness, originality, Critic pass rate, edit distance, cost, latency and downstream performance. Correlation must not be presented as causation.

## Agent runtime direction

Hermes Agent is the preferred reasoning-runtime candidate because it supports specialist agents, skills, provider flexibility and local/open model options. It is not the product's system of record.

CIE owns tenancy, domain state, workflow state, lineage, policy, analytics, billing and authoritative Brand memory.

## Agent control-plane direction

Paperclip is an approved TRD evaluation candidate for coordinating specialist CIE agents, schedules, budgets, approvals, persistent tasks, auditability and runtime skill assignment.

Paperclip is not approved for implementation yet and must not become an irreversible dependency without prototype evidence.

The TRD should preserve a control-plane abstraction so CIE can use a native implementation or another provider if Paperclip proves too heavy, immature or operationally unsuitable.

## Evolution direction

EvoMap Evolver is an optional evolution-provider / R&D candidate for proposing reusable strategies from runtime outcomes. It is not a hard dependency.

CIE's own Brand Learning remains authoritative. Any evolved Gene, Capsule, strategy or skill revision must pass evaluation and policy before production use.

## Technical principle

Agents are used for judgement. Deterministic software is used for guarantees.

Skills are specialised instructions/capabilities. Tools perform controlled external actions. Neither skills nor agents may bypass CIE domain policy.
