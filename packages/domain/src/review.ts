import { DomainValidationError } from "./index";

export type ReviewStatus = "review" | "revision-required" | "passed" | "archived";
export type TruthFindingCode = "unsupported-factual-claim" | "fabricated-first-person" | "stale-evidence" | "missing-attribution" | "prohibited-brand-language";
export interface ContentScope { workspaceId: string; brandId: string; campaignId: string; assetId: string; versionId: string; version: number }
export interface ClaimUse { claimId: string; factual: boolean; supported: boolean; fresh: boolean; firstPerson: boolean; brandAuthorized: boolean; attributionRequired: boolean; attributionPresent: boolean }
export interface TruthFinding { code: TruthFindingCode; severity: "hard-fail"; claimId?: string; message: string }
export interface TruthGateResult extends ContentScope { passed: boolean; findings: TruthFinding[] }
export interface CriticFinding { code: string; severity: "advisory" | "revision"; message: string }
export interface CriticResult { passed: boolean; score: number; findings: CriticFinding[] }
export interface ContentReview extends ContentScope { id: string; status: ReviewStatus; truth: TruthGateResult; revisionCycle: number; requestedAt: string; completedAt?: string; critic?: CriticResult }
export interface ApprovalDestination { channel: "linkedin" | "instagram" | "facebook" | "manual"; accountRef: string }
export interface ContentApproval extends ContentScope { id: string; reviewId: string; approverAccountId: string; destination: ApprovalDestination; approvedAt: string }

export function evaluateTruthGate(input: ContentScope & { claimUses: ClaimUse[]; prohibitedBrandLanguage: string[] }): TruthGateResult {
  const scope = normalizeScope(input);
  if (!Array.isArray(input.claimUses) || !Array.isArray(input.prohibitedBrandLanguage)) throw new DomainValidationError("Truth Gate inputs must be lists");
  const findings: TruthFinding[] = [];
  for (const use of input.claimUses) {
    const claimId = text(use.claimId, "claimId", 200);
    if (use.factual && !use.supported) findings.push({ code: "unsupported-factual-claim", severity: "hard-fail", claimId, message: "Factual claim lacks approved evidence" });
    if (use.firstPerson && !use.brandAuthorized) findings.push({ code: "fabricated-first-person", severity: "hard-fail", claimId, message: "First-person experience is not Brand-authorized" });
    if (!use.fresh) findings.push({ code: "stale-evidence", severity: "hard-fail", claimId, message: "Claim evidence is outside freshness policy" });
    if (use.attributionRequired && !use.attributionPresent) findings.push({ code: "missing-attribution", severity: "hard-fail", claimId, message: "Required attribution is missing" });
  }
  for (const phrase of input.prohibitedBrandLanguage) findings.push({ code: "prohibited-brand-language", severity: "hard-fail", message: `Prohibited Brand language detected: ${text(phrase, "prohibitedBrandLanguage", 200)}` });
  return { ...scope, passed: findings.length === 0, findings };
}

export function requestContentReview(input: { id: string; truth: TruthGateResult; requestedAt: string } & ContentScope): ContentReview {
  const scope = normalizeScope(input);
  if (!input.truth.passed || input.truth.findings.length) throw new DomainValidationError("Content cannot enter Review until the Truth Gate passes");
  assertSameScope(scope, input.truth);
  return { id: text(input.id, "id", 200), ...scope, status: "review", truth: structuredClone(input.truth), revisionCycle: 0, requestedAt: timestamp(input.requestedAt, "requestedAt") };
}

export function completeContentReview(input: { review: ContentReview; critic: CriticResult; revisionCycle: number; completedAt: string }): ContentReview {
  if (input.review.status !== "review") throw new DomainValidationError("Only content in Review can be completed");
  if (!Number.isInteger(input.revisionCycle) || input.revisionCycle < 0 || input.revisionCycle > 2) throw new DomainValidationError("Revision cycles must be between zero and two");
  if (!Number.isFinite(input.critic.score) || input.critic.score < 0 || input.critic.score > 100) throw new DomainValidationError("Critic score must be between zero and 100");
  const findings = input.critic.findings.map((finding) => ({ code: text(finding.code, "finding.code", 120), severity: enumValue(finding.severity, ["advisory", "revision"], "finding.severity"), message: text(finding.message, "finding.message", 2_000) }));
  const critic = { passed: input.critic.passed, score: input.critic.score, findings };
  return { ...input.review, status: critic.passed ? "passed" : "revision-required", revisionCycle: input.revisionCycle, critic, completedAt: timestamp(input.completedAt, "completedAt") };
}

export function selectJudgedCandidate(input: { candidateVersionIds: string[]; validVersionIds: string[]; selectedVersionId: string }): string {
  const candidates = new Set(input.candidateVersionIds.map((id) => text(id, "candidateVersionId", 200)));
  const valid = new Set(input.validVersionIds.map((id) => text(id, "validVersionId", 200)));
  const selected = text(input.selectedVersionId, "selectedVersionId", 200);
  if (!candidates.has(selected) || !valid.has(selected)) throw new DomainValidationError("Judge must select a valid candidate");
  return selected;
}

export function approveContentVersion(input: { id: string; review: ContentReview; currentVersionId: string; approverAccountId: string; destination: ApprovalDestination; approvedAt: string }): ContentApproval {
  if (input.review.status !== "passed" || !input.review.critic?.passed || !input.review.truth.passed) throw new DomainValidationError("Only passed reviewed content can be approved");
  if (text(input.currentVersionId, "currentVersionId", 200) !== input.review.versionId) throw new DomainValidationError("Approval requires the current version");
  return { id: text(input.id, "id", 200), workspaceId: input.review.workspaceId, brandId: input.review.brandId, campaignId: input.review.campaignId, assetId: input.review.assetId, versionId: input.review.versionId, version: input.review.version, reviewId: input.review.id, approverAccountId: text(input.approverAccountId, "approverAccountId", 200), destination: { channel: enumValue(input.destination.channel, ["linkedin", "instagram", "facebook", "manual"], "destination.channel"), accountRef: text(input.destination.accountRef, "destination.accountRef", 300) }, approvedAt: timestamp(input.approvedAt, "approvedAt") };
}

function normalizeScope(input: ContentScope): ContentScope { return { workspaceId: text(input.workspaceId, "workspaceId", 200), brandId: text(input.brandId, "brandId", 200), campaignId: text(input.campaignId, "campaignId", 200), assetId: text(input.assetId, "assetId", 200), versionId: text(input.versionId, "versionId", 200), version: positiveInteger(input.version, "version") }; }
function assertSameScope(a: ContentScope, b: ContentScope): void { if (a.workspaceId !== b.workspaceId || a.brandId !== b.brandId || a.campaignId !== b.campaignId || a.assetId !== b.assetId || a.versionId !== b.versionId || a.version !== b.version) throw new DomainValidationError("Review scope does not match Truth Gate scope"); }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`); const normalized = value.trim(); if (normalized.length > max) throw new DomainValidationError(`${field} is too long`); return normalized; }
function timestamp(value: unknown, field: string): string { const normalized = text(value, field, 80); if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(`${field} must be a valid timestamp`); return normalized; }
function positiveInteger(value: unknown, field: string): number { if (!Number.isInteger(value) || (value as number) < 1) throw new DomainValidationError(`${field} must be a positive integer`); return value as number; }
function enumValue<const T extends string>(value: unknown, values: readonly T[], field: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new DomainValidationError(`${field} is not supported`); return value as T; }
