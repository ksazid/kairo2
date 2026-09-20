import { DomainValidationError } from "./index";
import type { MetricName, NormalizedMetric } from "./analytics";
import type { PerformancePreference } from "./brand-preference-state";

export const HUNTER_OUTCOME_ATTRIBUTION_VERSION = "hunter-outcome-attribution-v1" as const;

export interface OutcomeAttributionLineage {
  workspaceId: string;
  brandId: string;
  opportunityId: string;
  ideaId: string;
  contentId: string;
  publishedPostId: string;
  channel: string;
  publishedAt: string;
  directOpportunityLineage: boolean;
  topic?: string;
  audience?: string;
  mechanismKeys?: string[];
}

export interface OutcomeMetricBaseline {
  workspaceId: string;
  brandId: string;
  name: MetricName;
  value: number;
  sampleCount: number;
  capturedThrough: string;
  scope: "brand-channel" | "brand-format" | "brand-all";
  channel?: string;
  format?: string;
}

export interface OutcomeMetricComparison {
  name: MetricName;
  currentValue: number;
  baselineValue: number;
  baselineSampleCount: number;
  capturedAt: string;
  relativeLift: number;
  normalizedLift: number;
  freshness: number;
  baselineScope: OutcomeMetricBaseline["scope"];
}

export interface OutcomeAttributionResult {
  version: typeof HUNTER_OUTCOME_ATTRIBUTION_VERSION;
  workspaceId: string;
  brandId: string;
  opportunityId: string;
  contentId: string;
  publishedPostId: string;
  directOpportunityLineage: boolean;
  causalClaim: false;
  association: "positive" | "neutral" | "negative" | "insufficient-data";
  brandRelativeLift: number;
  confidence: number;
  metricCoverage: number;
  baselineStrength: number;
  freshness: number;
  comparisons: OutcomeMetricComparison[];
  unknownMetrics: MetricName[];
  performanceMemoryProposals: PerformancePreference[];
  limitations: string[];
}

export interface BuildOutcomeAttributionInput {
  lineage: OutcomeAttributionLineage;
  metrics: readonly NormalizedMetric[];
  baselines: readonly OutcomeMetricBaseline[];
  asOf: string;
  format?: string;
}

const METRIC_WEIGHTS: Readonly<Record<MetricName, number>> = {
  impressions: 0.04,
  reach: 0.08,
  reactions: 0.05,
  likes: 0.05,
  comments: 0.14,
  shares: 0.24,
  saves: 0.28,
  clicks: 0.12,
  videoViews: 0.05,
};

const ALL_METRICS = Object.keys(METRIC_WEIGHTS) as MetricName[];

export function buildHunterOutcomeAttribution(input: BuildOutcomeAttributionInput): OutcomeAttributionResult {
  const lineage = validateLineage(input.lineage);
  const asOfMs = Date.parse(timestamp(input.asOf, "asOf"));
  const publishedAtMs = Date.parse(lineage.publishedAt);
  if (asOfMs < publishedAtMs) throw new DomainValidationError("asOf cannot predate publication");

  const latest = latestMetrics(input.metrics, lineage);
  const comparisons: OutcomeMetricComparison[] = [];
  const unknownMetrics: MetricName[] = [];

  for (const metricName of ALL_METRICS) {
    const metric = latest.get(metricName);
    if (!metric || metric.status !== "available" || metric.value === undefined) {
      unknownMetrics.push(metricName);
      continue;
    }
    const baseline = selectBaseline(
      input.baselines,
      lineage,
      metricName,
      input.format,
    );
    if (!baseline) {
      unknownMetrics.push(metricName);
      continue;
    }

    const ageHours = Math.max(0, (asOfMs - Date.parse(metric.capturedAt)) / 3_600_000);
    const freshness = clamp01(1 / (1 + ageHours / 72));
    const relativeLift = relativeLiftAgainst(metric.value, baseline.value);
    const normalizedLift = signedNormalize(relativeLift);

    comparisons.push({
      name: metricName,
      currentValue: metric.value,
      baselineValue: baseline.value,
      baselineSampleCount: baseline.sampleCount,
      capturedAt: metric.capturedAt,
      relativeLift,
      normalizedLift,
      freshness,
      baselineScope: baseline.scope,
    });
  }

  const availableWeight = comparisons.reduce((sum, item) => sum + METRIC_WEIGHTS[item.name], 0);
  const totalWeight = ALL_METRICS.reduce((sum, name) => sum + METRIC_WEIGHTS[name], 0);
  const metricCoverage = totalWeight ? clamp01(availableWeight / totalWeight) : 0;

  const brandRelativeLift = availableWeight
    ? clampSigned(
        comparisons.reduce((sum, item) => sum + item.normalizedLift * METRIC_WEIGHTS[item.name], 0) /
          availableWeight,
      )
    : 0;

  const baselineStrength = comparisons.length
    ? comparisons.reduce((sum, item) => sum + baselineSampleScore(item.baselineSampleCount), 0) / comparisons.length
    : 0;

  const freshness = comparisons.length
    ? comparisons.reduce((sum, item) => sum + item.freshness, 0) / comparisons.length
    : 0;

  const lineageScore = lineage.directOpportunityLineage ? 1 : 0.35;
  const confidence = comparisons.length
    ? clamp01(
        lineageScore * 0.35 +
        baselineStrength * 0.25 +
        freshness * 0.20 +
        metricCoverage * 0.20,
      )
    : 0;

  const association: OutcomeAttributionResult["association"] =
    comparisons.length === 0
      ? "insufficient-data"
      : brandRelativeLift >= 0.15
        ? "positive"
        : brandRelativeLift <= -0.15
          ? "negative"
          : "neutral";

  const performanceMemoryProposals =
    association === "positive" && confidence >= 0.55 && brandRelativeLift >= 0.15
      ? performanceMemory(lineage, brandRelativeLift, confidence)
      : [];

  const limitations = [
    "This result measures Brand-relative association, not causation.",
    ...(lineage.directOpportunityLineage ? [] : ["Opportunity-to-content lineage is indirect, reducing attribution confidence."]),
    ...(unknownMetrics.length ? ["Some outcome metrics or compatible Brand baselines are unavailable."] : []),
    ...(baselineStrength < 0.5 ? ["Brand baseline sample size is limited."] : []),
    ...(freshness < 0.5 ? ["Available outcome metrics are stale relative to the attribution time."] : []),
  ];

  return {
    version: HUNTER_OUTCOME_ATTRIBUTION_VERSION,
    workspaceId: lineage.workspaceId,
    brandId: lineage.brandId,
    opportunityId: lineage.opportunityId,
    contentId: lineage.contentId,
    publishedPostId: lineage.publishedPostId,
    directOpportunityLineage: lineage.directOpportunityLineage,
    causalClaim: false,
    association,
    brandRelativeLift,
    confidence,
    metricCoverage,
    baselineStrength,
    freshness,
    comparisons,
    unknownMetrics,
    performanceMemoryProposals,
    limitations,
  };
}

function latestMetrics(
  metrics: readonly NormalizedMetric[],
  lineage: OutcomeAttributionLineage,
): Map<MetricName, NormalizedMetric> {
  const result = new Map<MetricName, NormalizedMetric>();
  for (const metric of metrics) {
    if (metric.workspaceId !== lineage.workspaceId || metric.brandId !== lineage.brandId) {
      throw new DomainValidationError("Outcome metric is outside attribution workspace or Brand");
    }
    if (metric.publishedPostId !== lineage.publishedPostId) continue;

    const existing = result.get(metric.name);
    if (!existing || Date.parse(metric.capturedAt) > Date.parse(existing.capturedAt)) {
      result.set(metric.name, metric);
    }
  }
  return result;
}

function selectBaseline(
  baselines: readonly OutcomeMetricBaseline[],
  lineage: OutcomeAttributionLineage,
  name: MetricName,
  format: string | undefined,
): OutcomeMetricBaseline | undefined {
  const candidates = baselines
    .filter((baseline) => {
      validateBaseline(baseline);
      if (baseline.workspaceId !== lineage.workspaceId || baseline.brandId !== lineage.brandId) {
        throw new DomainValidationError("Outcome baseline is outside attribution workspace or Brand");
      }
      if (baseline.name !== name) return false;
      if (baseline.scope === "brand-channel") return baseline.channel === lineage.channel;
      if (baseline.scope === "brand-format") return Boolean(format && baseline.format === format);
      return baseline.scope === "brand-all";
    })
    .sort((left, right) =>
      baselinePriority(left.scope) - baselinePriority(right.scope) ||
      right.sampleCount - left.sampleCount ||
      Date.parse(right.capturedThrough) - Date.parse(left.capturedThrough),
    );

  return candidates[0];
}

function performanceMemory(
  lineage: OutcomeAttributionLineage,
  lift: number,
  confidence: number,
): PerformancePreference[] {
  const weight = clamp01(0.5 + Math.min(0.45, Math.max(0, lift) * 0.35));
  const proposals: PerformancePreference[] = [];

  if (lineage.topic?.trim()) {
    proposals.push({
      key: lineage.topic.trim().slice(0, 300),
      dimension: "topic",
      weight,
      confidence,
      learningId: "outcome:" + lineage.publishedPostId + ":topic",
    });
  }

  if (lineage.audience?.trim()) {
    proposals.push({
      key: lineage.audience.trim().slice(0, 300),
      dimension: "audience",
      weight: clamp01(weight * 0.9),
      confidence,
      learningId: "outcome:" + lineage.publishedPostId + ":audience",
    });
  }

  for (const mechanism of [...new Set(lineage.mechanismKeys ?? [])].slice(0, 8)) {
    const key = mechanism.trim().slice(0, 300);
    if (!key) continue;
    proposals.push({
      key,
      dimension: "mechanism",
      weight: clamp01(weight * 0.85),
      confidence,
      learningId: "outcome:" + lineage.publishedPostId + ":mechanism:" + normalizeKey(key),
    });
  }

  return proposals;
}

function validateLineage(input: OutcomeAttributionLineage): OutcomeAttributionLineage {
  return {
    workspaceId: text(input.workspaceId, "workspaceId", 200),
    brandId: text(input.brandId, "brandId", 200),
    opportunityId: text(input.opportunityId, "opportunityId", 200),
    ideaId: text(input.ideaId, "ideaId", 200),
    contentId: text(input.contentId, "contentId", 200),
    publishedPostId: text(input.publishedPostId, "publishedPostId", 200),
    channel: text(input.channel, "channel", 120),
    publishedAt: timestamp(input.publishedAt, "publishedAt"),
    directOpportunityLineage: Boolean(input.directOpportunityLineage),
    ...(input.topic ? { topic: text(input.topic, "topic", 300) } : {}),
    ...(input.audience ? { audience: text(input.audience, "audience", 300) } : {}),
    ...(input.mechanismKeys
      ? { mechanismKeys: [...new Set(input.mechanismKeys.map((value) => text(value, "mechanismKey", 300)))].slice(0, 20) }
      : {}),
  };
}

function validateBaseline(input: OutcomeMetricBaseline): void {
  text(input.workspaceId, "baseline.workspaceId", 200);
  text(input.brandId, "baseline.brandId", 200);
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new DomainValidationError("baseline.value must be a non-negative number");
  }
  if (!Number.isInteger(input.sampleCount) || input.sampleCount < 1) {
    throw new DomainValidationError("baseline.sampleCount must be a positive integer");
  }
  timestamp(input.capturedThrough, "baseline.capturedThrough");
  if (input.scope === "brand-channel" && !input.channel?.trim()) {
    throw new DomainValidationError("brand-channel baseline requires channel");
  }
  if (input.scope === "brand-format" && !input.format?.trim()) {
    throw new DomainValidationError("brand-format baseline requires format");
  }
}

function relativeLiftAgainst(current: number, baseline: number): number {
  if (baseline === 0) return current === 0 ? 0 : 1;
  return (current - baseline) / baseline;
}

function signedNormalize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clampSigned(value / (1 + Math.abs(value)));
}

function baselineSampleScore(sampleCount: number): number {
  return clamp01(Math.log2(sampleCount + 1) / 5);
}

function baselinePriority(scope: OutcomeMetricBaseline["scope"]): number {
  if (scope === "brand-format") return 0;
  if (scope === "brand-channel") return 1;
  return 2;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "value";
}

function timestamp(value: unknown, field: string): string {
  const normalized = text(value, field, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(field + " must be a valid timestamp");
  return normalized;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(field + " is required");
  const normalized = value.trim();
  if (normalized.length > max) throw new DomainValidationError(field + " is too long");
  return normalized;
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
