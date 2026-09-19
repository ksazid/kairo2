import { DomainValidationError, ResourceNotFoundError } from "./index";

export type IdeaStatus = "new" | "researching" | "research-ready" | "angles-ready";
export type ClaimClassification = "fact" | "brand-opinion" | "uncertain-inference";
export type EvidenceStrength = "weak" | "moderate" | "strong";
export type VerificationState = "supported" | "contradicted" | "unresolved";
export type Freshness = "fresh" | "aging" | "stale" | "unknown";
export type FirstPersonAuthorization = "not-applicable" | "authorized" | "not-authorized";
export type AngleStatus = "candidate" | "selected";

export type IdeaSource =
  | { type: "opportunity"; opportunityId: string }
  | { type: "user" };

export interface Idea {
  id: string;
  workspaceId: string;
  brandId: string;
  title: string;
  premise: string;
  source: IdeaSource;
  status: IdeaStatus;
  createdAt: string;
}

export interface EvidenceReference {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  publishedAt?: string;
  retrievedAt: string;
}

export interface Claim {
  id: string;
  text: string;
  classification: ClaimClassification;
  confidence: number;
  evidenceStrength: EvidenceStrength;
  verificationState: VerificationState;
  freshness: Freshness;
  evidenceIds: string[];
  firstPersonAuthorization: FirstPersonAuthorization;
}

export interface ResearchDossier {
  id: string;
  workspaceId: string;
  brandId: string;
  ideaId: string;
  summary: string;
  evidence: EvidenceReference[];
  claims: Claim[];
  unresolvedUncertainties: string[];
  status: "ready";
  createdAt: string;
  runtimeProvenance?: { runtime: string; provider?: string; model?: string; costUsd?: number; latencyMs: number };
}

export interface Angle {
  id: string;
  workspaceId: string;
  brandId: string;
  ideaId: string;
  title: string;
  framing: string;
  audience: string;
  objective: string;
  hookDirection: string;
  expectedValue: string;
  effort: "low" | "medium" | "high";
  recommendedFormat: string;
  recommendedChannel: string;
  supportingClaimIds: string[];
  status: AngleStatus;
  version: number;
  runtimeProvenance?: { runtime: string; provider?: string; model?: string; costUsd?: number; latencyMs: number };
}

export interface CreateIdeaInput {
  id: string;
  workspaceId: string;
  brandId: string;
  title: string;
  premise: string;
  source: IdeaSource;
  createdAt: string;
}

export interface CreateResearchDossierInput {
  id: string;
  workspaceId: string;
  brandId: string;
  ideaId: string;
  summary: string;
  evidence: EvidenceReference[];
  claims: Claim[];
  unresolvedUncertainties: string[];
  createdAt: string;
  runtimeProvenance?: ResearchDossier["runtimeProvenance"];
}

export function createIdea(input: CreateIdeaInput): Idea {
  const source = normalizeIdeaSource(input.source);
  return {
    id: requiredId(input.id, "id"),
    workspaceId: requiredId(input.workspaceId, "workspaceId"),
    brandId: requiredId(input.brandId, "brandId"),
    title: requiredText(input.title, "title", 300),
    premise: requiredText(input.premise, "premise", 2_000),
    source,
    status: "new",
    createdAt: timestamp(input.createdAt, "createdAt"),
  };
}

function normalizeRuntimeProvenance(input: NonNullable<ResearchDossier["runtimeProvenance"]>): NonNullable<ResearchDossier["runtimeProvenance"]> {
  return {
    runtime: requiredText(input.runtime, "runtimeProvenance.runtime", 120),
    ...(input.provider ? { provider: requiredText(input.provider, "runtimeProvenance.provider", 120) } : {}),
    ...(input.model ? { model: requiredText(input.model, "runtimeProvenance.model", 160) } : {}),
    ...(input.costUsd !== undefined ? { costUsd: boundedScore(input.costUsd, "runtimeProvenance.costUsd") } : {}),
    latencyMs: Number.isFinite(input.latencyMs) && input.latencyMs >= 0 ? input.latencyMs : 0,
  };
}

export function createResearchDossier(input: CreateResearchDossierInput): ResearchDossier {
  const evidence = input.evidence.map(normalizeEvidence);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  if (evidenceIds.size !== evidence.length) throw new DomainValidationError("Evidence IDs must be unique");

  const claims = input.claims.map((claim) => normalizeClaim(claim, evidenceIds));
  const claimIds = new Set(claims.map((item) => item.id));
  if (claimIds.size !== claims.length) throw new DomainValidationError("Claim IDs must be unique");

  return {
    id: requiredId(input.id, "id"),
    workspaceId: requiredId(input.workspaceId, "workspaceId"),
    brandId: requiredId(input.brandId, "brandId"),
    ideaId: requiredId(input.ideaId, "ideaId"),
    summary: requiredText(input.summary, "summary", 10_000),
    evidence,
    claims,
    unresolvedUncertainties: uniqueTexts(input.unresolvedUncertainties, "unresolvedUncertainties", 2_000),
    status: "ready",
    createdAt: timestamp(input.createdAt, "createdAt"),
    ...(input.runtimeProvenance ? { runtimeProvenance: normalizeRuntimeProvenance(input.runtimeProvenance) } : {}),
  };
}

export function selectAngle<T extends Angle>(angles: readonly T[], angleId: string): T[] {
  const selectedId = requiredId(angleId, "angleId");
  const selected = angles.find((angle) => angle.id === selectedId);
  if (!selected) throw new ResourceNotFoundError("Angle not found");

  for (const angle of angles) {
    if (angle.workspaceId !== selected.workspaceId || angle.brandId !== selected.brandId || angle.ideaId !== selected.ideaId) {
      throw new DomainValidationError("Angles must share one Workspace, Brand and Idea scope");
    }
  }

  return angles.map((angle) => ({
    ...angle,
    status: angle.id === selectedId ? "selected" : "candidate",
    version: angle.version + (angle.status === (angle.id === selectedId ? "selected" : "candidate") ? 0 : 1),
  })) as T[];
}

function normalizeIdeaSource(source: IdeaSource): IdeaSource {
  if (!source || typeof source !== "object") throw new DomainValidationError("Idea source is required");
  if (source.type === "opportunity") {
    return { type: "opportunity", opportunityId: requiredId(source.opportunityId, "opportunityId") };
  }
  if (source.type === "user") return { type: "user" };
  throw new DomainValidationError("Idea source type is not supported");
}

function normalizeEvidence(input: EvidenceReference): EvidenceReference {
  return {
    id: requiredId(input.id, "evidence.id"),
    sourceUrl: publicHttpUrl(input.sourceUrl, "evidence.sourceUrl"),
    sourceTitle: requiredText(input.sourceTitle, "evidence.sourceTitle", 500),
    ...(input.publishedAt ? { publishedAt: timestamp(input.publishedAt, "evidence.publishedAt") } : {}),
    retrievedAt: timestamp(input.retrievedAt, "evidence.retrievedAt"),
  };
}

function normalizeClaim(input: Claim, evidenceIds: ReadonlySet<string>): Claim {
  const classification = enumValue(input.classification, ["fact", "brand-opinion", "uncertain-inference"], "claim.classification");
  const verificationState = enumValue(input.verificationState, ["supported", "contradicted", "unresolved"], "claim.verificationState");
  const claimEvidenceIds = uniqueIds(input.evidenceIds, "claim.evidenceIds");
  if (classification === "fact" && claimEvidenceIds.length === 0) {
    throw new DomainValidationError("A factual Claim requires evidence");
  }
  for (const evidenceId of claimEvidenceIds) {
    if (!evidenceIds.has(evidenceId)) throw new DomainValidationError("Claim references unknown evidence");
  }
  if (verificationState === "supported" && claimEvidenceIds.length === 0) {
    throw new DomainValidationError("A supported Claim requires evidence");
  }
  const firstPersonAuthorization = enumValue(
    input.firstPersonAuthorization,
    ["not-applicable", "authorized", "not-authorized"],
    "claim.firstPersonAuthorization",
  );
  if (firstPersonAuthorization === "not-authorized") {
    throw new DomainValidationError("A first-person Claim requires explicit Brand authorization");
  }
  return {
    id: requiredId(input.id, "claim.id"),
    text: requiredText(input.text, "claim.text", 2_000),
    classification,
    confidence: boundedScore(input.confidence, "claim.confidence"),
    evidenceStrength: enumValue(input.evidenceStrength, ["weak", "moderate", "strong"], "claim.evidenceStrength"),
    verificationState,
    freshness: enumValue(input.freshness, ["fresh", "aging", "stale", "unknown"], "claim.freshness"),
    evidenceIds: claimEvidenceIds,
    firstPersonAuthorization,
  };
}

function requiredId(value: unknown, field: string): string {
  return requiredText(value, field, 200);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(`${field} must be a valid timestamp`);
  return normalized;
}

function boundedScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${field} must be between 0 and 1`);
  }
  return value;
}

function enumValue<const T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new DomainValidationError(`${field} is not supported`);
  return value as T;
}

function uniqueIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new DomainValidationError(`${field} must be a list`);
  const ids = value.map((item) => requiredId(item, field));
  if (new Set(ids).size !== ids.length) throw new DomainValidationError(`${field} must not contain duplicates`);
  return ids;
}

function uniqueTexts(value: unknown, field: string, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new DomainValidationError(`${field} must be a list`);
  const texts = value.map((item) => requiredText(item, field, maxLength));
  if (new Set(texts).size !== texts.length) throw new DomainValidationError(`${field} must not contain duplicates`);
  return texts;
}

function publicHttpUrl(value: unknown, field: string): string {
  const text = requiredText(value, field, 2_048);
  let url: URL;
  try { url = new URL(text); } catch { throw new DomainValidationError(`${field} must be a valid HTTP(S) URL`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new DomainValidationError(`${field} must be a valid HTTP(S) URL`);
  if (url.username || url.password) throw new DomainValidationError(`${field} must not contain credentials`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isUnsafeIpLiteral(host)) {
    throw new DomainValidationError(`${field} must use a public host`);
  }
  return url.toString();
}

function isUnsafeIpLiteral(host: string): boolean {
  if (host.includes(":")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224
  );
}
