import { ConcurrencyConflictError, DomainValidationError } from "./index";
import type { ContentAssetKind, ContentAssetProvider } from "./content-asset-library";

export type ContentChannel = "linkedin" | "instagram" | "facebook" | "manual";
export type ContentActor = "user" | "ai";
export type ContentAction = "initial-draft" | "alternative" | "simplify" | "expand" | "adjust-depth" | "strengthen-opening" | "regenerate-section" | "manual-edit" | "asset-selection";

export interface CampaignLineage {
  workspaceId: string; brandId: string; ideaId: string; researchId: string; angleId: string;
  angleStatus: "candidate" | "selected"; supportingClaimIds: string[];
}
export interface Campaign { id: string; workspaceId: string; brandId: string; ideaId: string; researchId: string; angleId: string; name: string; objective: string; supportingClaimIds: string[]; status: "draft"; createdAt: string }
export interface ContentAsset { id: string; workspaceId: string; brandId: string; campaignId: string; channel: ContentChannel; format: string; audience: string; topic: string; hookType: string; cta: string; supportingClaimIds: string[]; currentVersion: number; status: "draft"; createdAt: string }
export interface ContentVersionProvenance { runtime: string; provider?: string; model?: string; skillVersion?: string; inputTokens?: number; outputTokens?: number; costUsd?: number; latencyMs: number }
export interface ContentLibraryAssetReference {
  libraryId: string;
  libraryAssetId: string;
  libraryName: string;
  provider: ContentAssetProvider;
  externalId: string;
  name: string;
  kind: ContentAssetKind;
  mimeType: string;
  providerRef?: string;
  previewRef?: string;
  indexedAt: string;
}
export interface ContentVersion { id: string; workspaceId: string; brandId: string; campaignId: string; assetId: string; version: number; parentVersionId: string | null; content: string; supportingClaimIds: string[]; actor: ContentActor; action: ContentAction; createdAt: string; libraryAssetRefs?: ContentLibraryAssetReference[]; provenance?: ContentVersionProvenance }

export function createCampaign(input: { id: string; name: string; objective: string; lineage: CampaignLineage; createdAt: string }): Campaign {
  if (input.lineage.angleStatus !== "selected") throw new DomainValidationError("Campaign requires a selected Angle");
  return { id: text(input.id, "id", 200), workspaceId: text(input.lineage.workspaceId, "workspaceId", 200), brandId: text(input.lineage.brandId, "brandId", 200), ideaId: text(input.lineage.ideaId, "ideaId", 200), researchId: text(input.lineage.researchId, "researchId", 200), angleId: text(input.lineage.angleId, "angleId", 200), name: text(input.name, "name", 300), objective: text(input.objective, "objective", 1_000), supportingClaimIds: uniqueIds(input.lineage.supportingClaimIds, "supportingClaimIds"), status: "draft", createdAt: timestamp(input.createdAt, "createdAt") };
}

export function createContentAsset(input: { id: string; campaign: Campaign; channel: ContentChannel; format: string; audience: string; topic: string; hookType: string; cta: string; createdAt: string }): ContentAsset {
  if (!["linkedin", "instagram", "facebook", "manual"].includes(input.channel)) throw new DomainValidationError("channel is not supported");
  return { id: text(input.id, "id", 200), workspaceId: input.campaign.workspaceId, brandId: input.campaign.brandId, campaignId: input.campaign.id, channel: input.channel, format: text(input.format, "format", 120), audience: text(input.audience, "audience", 500), topic: text(input.topic, "topic", 500), hookType: text(input.hookType, "hookType", 120), cta: text(input.cta, "cta", 500), supportingClaimIds: [...input.campaign.supportingClaimIds], currentVersion: 0, status: "draft", createdAt: timestamp(input.createdAt, "createdAt") };
}

type VersionBase = { id: string; asset: ContentAsset; content: string; supportingClaimIds: string[]; actor: ContentActor; action: ContentAction; createdAt: string; libraryAssetRefs?: ContentLibraryAssetReference[]; provenance?: ContentVersionProvenance };
export function createInitialContentVersion(input: VersionBase): ContentVersion {
  if (input.asset.currentVersion !== 0) throw new ConcurrencyConflictError("Content Asset already has a version");
  return version(input, 1, null);
}
export function appendContentVersion(input: VersionBase & { parent: ContentVersion; expectedVersion: number }): ContentVersion {
  if (input.asset.currentVersion !== input.expectedVersion || input.parent.version !== input.expectedVersion) throw new ConcurrencyConflictError("Content Version is stale");
  if (input.parent.assetId !== input.asset.id || input.parent.campaignId !== input.asset.campaignId || input.parent.brandId !== input.asset.brandId) throw new DomainValidationError("Parent Content Version is outside the Content Asset scope");
  return version({ ...input, libraryAssetRefs: input.libraryAssetRefs ?? input.parent.libraryAssetRefs ?? [] }, input.expectedVersion + 1, input.parent.id);
}
function version(input: VersionBase, number: number, parentVersionId: string | null): ContentVersion {
  const claims = uniqueIds(input.supportingClaimIds, "supportingClaimIds");
  const allowed = new Set(input.asset.supportingClaimIds);
  if (allowed.size && claims.some((id) => !allowed.has(id))) throw new DomainValidationError("Content references an unsupported supporting Claim");
  if (!allowed.size && claims.length) throw new DomainValidationError("Content references an unsupported supporting Claim");
  const libraryAssetRefs = normalizeLibraryAssetRefs(input.libraryAssetRefs ?? []);
  return { id: text(input.id, "id", 200), workspaceId: input.asset.workspaceId, brandId: input.asset.brandId, campaignId: input.asset.campaignId, assetId: input.asset.id, version: number, parentVersionId, content: text(input.content, "content", 50_000), supportingClaimIds: claims, actor: enumValue(input.actor, ["user", "ai"], "actor"), action: enumValue(input.action, ["initial-draft", "alternative", "simplify", "expand", "adjust-depth", "strengthen-opening", "regenerate-section", "manual-edit", "asset-selection"], "action"), createdAt: timestamp(input.createdAt, "createdAt"), libraryAssetRefs, ...(input.provenance ? { provenance: normalizeProvenance(input.provenance) } : {}) };
}
export function normalizeLibraryAssetRefs(value: ContentLibraryAssetReference[]): ContentLibraryAssetReference[] {
  if (!Array.isArray(value)) throw new DomainValidationError("libraryAssetRefs must be a list");
  if (value.length > 12) throw new DomainValidationError("A Content Version can reference at most 12 production assets");
  const ids = value.map((item) => text(item?.libraryAssetId, "libraryAssetRefs.libraryAssetId", 600));
  if (new Set(ids).size !== ids.length) throw new DomainValidationError("Production asset references must not contain duplicates");
  return value.map((item) => ({
    libraryId: text(item.libraryId, "libraryAssetRefs.libraryId", 300),
    libraryAssetId: text(item.libraryAssetId, "libraryAssetRefs.libraryAssetId", 600),
    libraryName: text(item.libraryName, "libraryAssetRefs.libraryName", 120),
    provider: enumValue(item.provider, ["google-drive", "manual"], "libraryAssetRefs.provider"),
    externalId: text(item.externalId, "libraryAssetRefs.externalId", 600),
    name: text(item.name, "libraryAssetRefs.name", 500),
    kind: enumValue(item.kind, ["image", "video", "document", "other"], "libraryAssetRefs.kind"),
    mimeType: text(item.mimeType, "libraryAssetRefs.mimeType", 300),
    ...(item.providerRef ? { providerRef: safeReference(item.providerRef, "libraryAssetRefs.providerRef") } : {}),
    ...(item.previewRef ? { previewRef: safeReference(item.previewRef, "libraryAssetRefs.previewRef") } : {}),
    indexedAt: timestamp(item.indexedAt, "libraryAssetRefs.indexedAt"),
  }));
}
function normalizeProvenance(value: ContentVersionProvenance): ContentVersionProvenance { return { runtime: text(value.runtime, "provenance.runtime", 120), ...(value.provider ? { provider: text(value.provider, "provenance.provider", 120) } : {}), ...(value.model ? { model: text(value.model, "provenance.model", 160) } : {}), ...(value.skillVersion ? { skillVersion: text(value.skillVersion, "provenance.skillVersion", 200) } : {}), ...(value.inputTokens !== undefined ? { inputTokens: nonNegative(value.inputTokens, "provenance.inputTokens") } : {}), ...(value.outputTokens !== undefined ? { outputTokens: nonNegative(value.outputTokens, "provenance.outputTokens") } : {}), ...(value.costUsd !== undefined ? { costUsd: nonNegative(value.costUsd, "provenance.costUsd") } : {}), latencyMs: nonNegative(value.latencyMs, "provenance.latencyMs") }; }
function safeReference(value: unknown, field: string): string { const normalized = text(value, field, 2_000); try { const url = new URL(normalized); if (url.protocol !== "https:") throw new Error("unsafe"); return url.toString(); } catch { throw new DomainValidationError(`${field} must be an HTTPS URL`); } }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`); const normalized = value.trim(); if (normalized.length > max) throw new DomainValidationError(`${field} is too long`); return normalized; }
function timestamp(value: unknown, field: string): string { const normalized = text(value, field, 80); if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(`${field} must be a valid timestamp`); return normalized; }
function uniqueIds(value: unknown, field: string): string[] { if (!Array.isArray(value)) throw new DomainValidationError(`${field} must be a list`); const values = value.map((item) => text(item, field, 200)); if (new Set(values).size !== values.length) throw new DomainValidationError(`${field} must not contain duplicates`); return values; }
function enumValue<const T extends string>(value: unknown, values: readonly T[], field: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new DomainValidationError(`${field} is not supported`); return value as T; }
function nonNegative(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new DomainValidationError(`${field} must be non-negative`); return value; }
