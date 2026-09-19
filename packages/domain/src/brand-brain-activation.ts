import type { BrandBrainFieldDto, BrandDnaReadinessGap, BrandDnaReadinessResponse, KnowledgeSourceDto } from "@kairo/contracts";
import { evaluateBrandDnaReadiness, type BrandDnaReadinessOptions } from "./brand-dna-readiness";

export type BrandBrainValueOrigin = "user-confirmed" | "source-backed" | "ai-inferred";
export type BrandBrainConfidenceLevel = "high" | "medium" | "low";
export type BrandBrainActivationStatus = "ready-for-hunter" | "needs-review" | "needs-enrichment";

export interface BrandBrainFieldActivation {
  fieldKey: string;
  origin: BrandBrainValueOrigin;
  confidence: { score: number; level: BrandBrainConfidenceLevel };
  sourceIds: string[];
  critical: boolean;
  weak: boolean;
  updatedAt: string;
}

export interface BrandBrainSourceRecommendation {
  gap: BrandDnaReadinessGap | "review";
  type: "website" | "public-link" | "confirm-field";
  fieldKey?: string;
  label: string;
  reason: string;
}

export interface BrandBrainActivationSnapshot {
  status: BrandBrainActivationStatus;
  hunterReady: boolean;
  readiness: BrandDnaReadinessResponse;
  completeness: {
    score: number;
    knownGroups: number;
    totalGroups: number;
  };
  fields: BrandBrainFieldActivation[];
  weakFields: string[];
  recommendedSources: BrandBrainSourceRecommendation[];
  evidenceSourceCount: number;
  updatedAt: string | null;
}

const GROUP_KEYS: Record<BrandDnaReadinessGap, readonly string[]> = {
  business: ["identity.description", "identity.category", "identity.sector", "identity.subsector"],
  offerings: ["identity.products-services", "identity.offers"],
  audience: ["audience.primary"],
  positioning: ["positioning.value-proposition", "positioning.differentiation", "positioning.market-position"],
  topics: ["content.core-topics", "content.preferred-topics", "content.pillars", "content.related-topics"],
  boundaries: ["boundaries.excluded-topics", "boundaries.prohibited-subjects", "boundaries.claims-to-avoid"],
  geography: ["identity.geography"],
};

const CANONICAL_CONFIRM_FIELD: Partial<Record<BrandDnaReadinessGap, string>> = {
  business: "identity.description",
  offerings: "identity.products-services",
  audience: "audience.primary",
  positioning: "positioning.value-proposition",
  topics: "content.pillars",
  boundaries: "boundaries.excluded-topics",
  geography: "identity.geography",
};

const CRITICAL_KEYS = new Set(Object.values(GROUP_KEYS).flat());

export function createBrandBrainActivationSnapshot(
  fields: readonly BrandBrainFieldDto[],
  sources: readonly KnowledgeSourceDto[] = [],
  options: BrandDnaReadinessOptions = {},
): BrandBrainActivationSnapshot {
  const readiness = evaluateBrandDnaReadiness(fields, options);
  const fieldActivation = newestByField(fields).map(activateField);
  const requiredGroups = (Object.keys(GROUP_KEYS) as BrandDnaReadinessGap[]).filter((gap) => gap !== "geography" || options.geographyRequired);
  const reviewGroups = requiredGroups.filter((gap) => {
    if (readiness.gaps.includes(gap)) return false;
    const members = fieldActivation.filter((field) => GROUP_KEYS[gap].includes(field.fieldKey));
    return members.length > 0 && !members.some((field) => !field.weak);
  });
  const hunterReady = readiness.status === "ready" && reviewGroups.length === 0;
  const status: BrandBrainActivationStatus = readiness.gaps.length
    ? "needs-enrichment"
    : hunterReady
      ? "ready-for-hunter"
      : "needs-review";
  const totalGroups = options.geographyRequired ? 7 : 6;
  const knownGroups = Math.max(0, totalGroups - readiness.gaps.length);
  const weakFields = [...new Set([
    ...readiness.gaps.map((gap) => CANONICAL_CONFIRM_FIELD[gap] ?? GROUP_KEYS[gap][0]).filter((value): value is string => Boolean(value)),
    ...reviewGroups.map((gap) => CANONICAL_CONFIRM_FIELD[gap] ?? GROUP_KEYS[gap][0]).filter((value): value is string => Boolean(value)),
  ])];
  const recommendedSources = recommendations(readiness.gaps, reviewGroups);
  const evidenceSourceCount = new Set([
    ...sources.filter((source) => source.status === "active").map((source) => source.id),
    ...fields.flatMap((field) => field.sourceIds),
  ]).size;
  const updatedAt = fields.map((field) => field.updatedAt).sort().at(-1) ?? null;

  return {
    status,
    hunterReady,
    readiness,
    completeness: { score: readiness.score, knownGroups, totalGroups },
    fields: fieldActivation,
    weakFields,
    recommendedSources,
    evidenceSourceCount,
    updatedAt,
  };
}

function newestByField(fields: readonly BrandBrainFieldDto[]): BrandBrainFieldDto[] {
  const newest = new Map<string, BrandBrainFieldDto>();
  for (const field of fields) {
    const current = newest.get(field.fieldKey);
    if (!current || stateRank(field) > stateRank(current) || (stateRank(field) === stateRank(current) && field.updatedAt > current.updatedAt)) {
      newest.set(field.fieldKey, field);
    }
  }
  return [...newest.values()].sort((a, b) => a.fieldKey.localeCompare(b.fieldKey));
}

function activateField(field: BrandBrainFieldDto): BrandBrainFieldActivation {
  const origin: BrandBrainValueOrigin = field.state === "confirmed"
    ? "user-confirmed"
    : field.sourceIds.length
      ? "source-backed"
      : "ai-inferred";
  const score = field.state === "stale" ? 0.2 : origin === "user-confirmed" ? 1 : origin === "source-backed" ? 0.85 : 0.55;
  const level: BrandBrainConfidenceLevel = score >= 0.8 ? "high" : score >= 0.5 ? "medium" : "low";
  return {
    fieldKey: field.fieldKey,
    origin,
    confidence: { score, level },
    sourceIds: [...new Set(field.sourceIds)],
    critical: CRITICAL_KEYS.has(field.fieldKey),
    weak: field.state === "stale" || level !== "high",
    updatedAt: field.updatedAt,
  };
}

function recommendations(
  gaps: readonly BrandDnaReadinessGap[],
  reviewGroups: readonly BrandDnaReadinessGap[],
): BrandBrainSourceRecommendation[] {
  const output: BrandBrainSourceRecommendation[] = [];
  for (const gap of gaps) {
    if (gap === "business" || gap === "offerings") {
      output.push({ gap, type: "website", label: "Add website", reason: gap === "business" ? "A website can establish what the Brand does." : "A website can verify products, services and offers." });
    } else if (gap === "geography") {
      output.push({ gap, type: "public-link", label: "Add location source", reason: "A public profile or website can verify the Brand's service geography." });
    } else {
      const fieldKey = CANONICAL_CONFIRM_FIELD[gap] ?? GROUP_KEYS[gap][0];
      output.push({ gap, type: "confirm-field", ...(fieldKey ? { fieldKey } : {}), label: `Confirm ${gap}`, reason: `Owner confirmation can resolve the missing ${gap} context.` });
    }
  }
  for (const gap of reviewGroups) {
    const fieldKey = CANONICAL_CONFIRM_FIELD[gap] ?? GROUP_KEYS[gap][0];
    output.push({ gap: "review", type: "confirm-field", ...(fieldKey ? { fieldKey } : {}), label: `Review ${gap}`, reason: `Confirm the ${gap} context before Hunter relies on it.` });
  }
  const seen = new Set<string>();
  return output.filter((item) => {
    const key = `${item.type}:${item.fieldKey ?? item.gap}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function stateRank(field: BrandBrainFieldDto): number {
  return field.state === "confirmed" ? 3 : field.state === "inferred" ? 2 : 1;
}
