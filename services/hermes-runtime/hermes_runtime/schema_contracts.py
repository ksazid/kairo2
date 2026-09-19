from __future__ import annotations


_MARKETING_CAROUSEL_V1 = (
    "Required output contract for marketing-carousel-plan@1: return one JSON object with exactly these top-level fields: "
    '"format":"carousel"; "coverHook" as a non-empty string up to 300 characters; '
    '"slides" as an array of 3 to 20 objects, each containing exactly "headline" as a non-empty string up to 240 characters, '
    '"body" as a non-empty string up to 2000 characters, and "supportingClaimIds" as a non-empty array of supplied Claim ids; '
    '"caption" as a non-empty string up to 5000 characters; "cta" as a non-empty string up to 500 characters; '
    'and top-level "supportingClaimIds" as a non-empty array of supplied Claim ids. '
    "The top-level supportingClaimIds must include every requiredClaimId from benchmarkCase, and every slide supportingClaimIds array "
    "must be a subset of the top-level supportingClaimIds. Do not add markdown fences, commentary, or fields outside this contract."
)

_RESEARCH_DOSSIER_V1 = (
    "Required output contract for research-dossier@1: return one JSON object with exactly these top-level fields: "
    '"summary" as a non-empty string; "importantContext", "competingInterpretations", and "unresolvedUncertainties" as arrays of non-empty strings; '
    'and "claims" as a non-empty array. Every claim must contain exactly "text", "classification", "confidence", "evidenceStrength", '
    '"verificationState", "freshness", "evidenceIds", and "firstPersonAuthorization". '
    'classification must be "fact", "brand-opinion", or "uncertain-inference"; confidence must be from 0 to 1; evidenceStrength must be "weak", "moderate", or "strong"; '
    'verificationState must be "supported", "contradicted", or "unresolved"; freshness must be "fresh", "aging", "stale", or "unknown". '
    "Every claim evidenceIds must be a non-empty array containing only evidence ids supplied in task.context.evidence. Never invent an evidence id. "
    'firstPersonAuthorization must be "not-applicable" unless the task context explicitly authorizes a first-person Brand claim. '
    "If supplied evidence cannot support a claim, omit that claim or preserve the uncertainty instead of returning a factual or supported claim without evidence. "
    "Do not add markdown fences, commentary, or fields outside this contract."
)

_STRATEGIST_ANGLES_V1 = (
    "Required output contract for strategist-angles@1: return one JSON object with exactly one top-level field, \"candidates\". "
    "candidates must be an array of 2 to 5 objects. Every candidate must contain exactly \"title\", \"framing\", \"audience\", \"objective\", "
    '"hookDirection", "expectedValue", "effort", "recommendedFormat", "recommendedChannel", and "supportingClaimIds". '
    'All text fields must be non-empty; effort must be "low", "medium", or "high". '
    "Every supportingClaimIds must be a non-empty array containing only Claim ids supplied in task.context.research.claims. Never invent a Claim id. "
    "Candidates must be meaningfully distinct. Do not add markdown fences, commentary, or fields outside this contract."
)


_CONTRACTS = {
    "marketing-carousel-plan@1": _MARKETING_CAROUSEL_V1,
    "research-dossier@1": _RESEARCH_DOSSIER_V1,
    "strategist-angles@1": _STRATEGIST_ANGLES_V1,
}


def schema_contract(name: str, version: str) -> str | None:
    return _CONTRACTS.get(f"{name}@{version}")
