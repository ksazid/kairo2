import type { BrandBrainFieldDto, BrandDnaReadinessAction, BrandDnaReadinessGap, BrandDnaReadinessResponse } from "@kairo/contracts";

const PLACEHOLDER = /to be confirmed|not yet confirmed|could not be identified|category not yet|connected or readable source evidence|brand's audience|people interested in this brand's products|what the brand offers|brand-relevant topics grounded|business or organization website|products or services described in (?:the|its) public reference|customers seeking .+ products or services|brand story, products or services|no excluded topics identified in the public reference/i;

const FIELD_KEYS = {
  business: ["identity.description", "identity.category", "identity.sector", "identity.subsector"],
  offerings: ["identity.products-services", "identity.offers"],
  audience: ["audience.primary"],
  positioning: ["positioning.value-proposition", "positioning.differentiation", "positioning.market-position"],
  topics: ["content.core-topics", "content.preferred-topics", "content.pillars", "content.related-topics"],
  boundaries: ["boundaries.excluded-topics", "boundaries.prohibited-subjects", "boundaries.claims-to-avoid"],
  geography: ["identity.geography"],
} as const satisfies Record<BrandDnaReadinessGap, readonly string[]>;

export interface BrandDnaReadinessOptions {
  now?: () => Date;
  /** Location is only required when the caller has identified a location-dependent business. */
  geographyRequired?: boolean;
}

export function evaluateBrandDnaReadiness(fields: readonly BrandBrainFieldDto[], options: BrandDnaReadinessOptions = {}): BrandDnaReadinessResponse {
  const usable = new Map<string, BrandBrainFieldDto>();
  for (const field of fields) {
    if (field.state === "stale" || !field.value.trim() || PLACEHOLDER.test(field.value)) continue;
    const current = usable.get(field.fieldKey);
    if (!current || stateRank(field.state) > stateRank(current.state) || (field.state === current.state && field.updatedAt > current.updatedAt)) usable.set(field.fieldKey, field);
  }

  const gaps: BrandDnaReadinessGap[] = [];
  for (const gap of Object.keys(FIELD_KEYS) as BrandDnaReadinessGap[]) {
    if (gap === "geography" && !options.geographyRequired) continue;
    if (!FIELD_KEYS[gap].some((key) => usable.has(key))) gaps.push(gap);
  }

  const total = options.geographyRequired ? 7 : 6;
  const score = Math.round(((total - gaps.length) / total) * 100);
  const relevant = [...usable.values()].filter((field) => FIELD_KEYS[gapForField(field.fieldKey)] !== undefined);
  const evidenceCoverage = relevant.length ? Math.round((relevant.filter((field) => field.sourceIds.length > 0).length / relevant.length) * 100) : 0;
  const confidence = relevant.length ? Math.round((relevant.filter((field) => field.state === "confirmed").length / relevant.length) * 100) : 0;
  const brandIntelligenceScore = Math.round(score * 0.6 + evidenceCoverage * 0.25 + confidence * 0.15);
  const nextAction = nextReadinessAction(gaps, usable);
  return {
    status: gaps.length ? "needs-enrichment" : "ready",
    score,
    brandIntelligenceScore,
    evidenceCoverage,
    confidence,
    gaps,
    ...(nextAction ? { nextAction } : {}),
    evaluatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

function gapForField(fieldKey: string): BrandDnaReadinessGap {
  for (const [gap, keys] of Object.entries(FIELD_KEYS) as Array<[BrandDnaReadinessGap, readonly string[]]>) {
    if (keys.includes(fieldKey)) return gap;
  }
  return "business";
}

function nextReadinessAction(gaps: readonly BrandDnaReadinessGap[], usable: ReadonlyMap<string, BrandBrainFieldDto>): BrandDnaReadinessAction | undefined {
  const gap = gaps[0];
  if (!gap) return undefined;
  if (gap === "offerings") return { type: "add-source", acceptedSource: "website", prompt: "Add your website so Kairo can understand your products or services." };
  if (gap === "business") return { type: "add-source", acceptedSource: "public-link", prompt: "Add a public Brand link so Kairo can identify what your business does." };
  if (gap === "audience") return { type: "confirm-field", fieldKey: "audience.primary", prompt: "Who is the primary customer or audience for this Brand?" };
  if (gap === "positioning") return { type: "confirm-field", fieldKey: "positioning.value-proposition", prompt: "What is the clearest value this Brand provides?" };
  if (gap === "topics") return { type: "confirm-field", fieldKey: "content.core-topics", prompt: "Which topics should Kairo focus on for this Brand?" };
  if (gap === "boundaries") {
    if (usable.has("boundaries.prohibited-subjects") || usable.has("boundaries.claims-to-avoid")) return { type: "confirm-field", fieldKey: "boundaries.excluded-topics", prompt: "Which topics should Kairo avoid?" };
    return { type: "confirm-none", fieldKey: "boundaries.excluded-topics", prompt: "Are there any topics Kairo should avoid? If none, confirm that." };
  }
  return { type: "confirm-field", fieldKey: "identity.geography", prompt: "Which geography does this Brand serve?" };
}

function stateRank(state: BrandBrainFieldDto["state"]): number { return state === "confirmed" ? 2 : state === "inferred" ? 1 : 0; }
