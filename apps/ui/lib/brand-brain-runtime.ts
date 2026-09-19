import type { BrandBrainActivationInput } from "./brand-brain-view-model";
import type { BrandBrainField, DiscoveryTopic } from "./brand-brain";

export interface BrandDiscoveryPlanData {
  schemaVersion: "1";
  workspaceId: string;
  brandId: string;
  revision: number;
  planVersion: string;
  snapshotVersion: string;
  state: "initial" | "customized";
  topics: Array<{ id: string; name: string; priority: "High" | "Medium"; audience: string; entities: string[]; sourceClasses: string[] }>;
  excludedTopics: string[];
  updatedAt: string | null;
}

export interface BrandDiscoveryRunData {
  runId: string;
  completedAt: string;
  valuableDiscoveries: number;
  newTopicClusters: number;
  weakSignalsFiltered: number;
}

export interface BrandBrainRuntimeData extends BrandBrainActivationInput {
  intelligenceSnapshot?: {
    snapshotVersion: string;
    performanceMemory: Array<{ learningId: string; statement: string; interpretation: string; confidence: number; decidedAt: string }>;
  };
  discoveryPlan?: BrandDiscoveryPlanData;
  /** False only when a user-customized plan intentionally remains pinned to its earlier Brand Intelligence snapshot. */
  discoveryPlanCurrent?: boolean;
  discoveryRun?: BrandDiscoveryRunData | null;
  schedule?: { nextRunAt: string } | null;
}

export interface BrandSourceUi {
  id: string;
  title: string;
  type: string;
  status: string;
  detail: string;
  synced: string;
  sourceUrl?: string;
}

export interface BrandLearningUi {
  id: string;
  title: string;
  detail: string;
  evidence: string;
  effect: string;
}

const FIELD_DEFS: Array<{ key: string; label: string; description: string; section: string; candidates: string[] }> = [
  { key: "category", label: "Category", description: "What your Brand does", section: "identity", candidates: ["identity.category", "identity.sector", "identity.description"] },
  { key: "offerings", label: "Products & services", description: "What you provide", section: "identity", candidates: ["identity.products-services", "identity.offers"] },
  { key: "audience", label: "Primary audience", description: "Who you serve", section: "audience", candidates: ["audience.primary"] },
  { key: "positioning", label: "Positioning", description: "Why you are meaningfully different", section: "positioning", candidates: ["positioning.value-proposition", "positioning.differentiation", "positioning.market-position"] },
  { key: "voice", label: "Voice", description: "How your Brand communicates", section: "voice", candidates: ["voice.tone", "voice.vocabulary"] },
  { key: "content", label: "Content focus", description: "What you should talk about", section: "content-strategy", candidates: ["content.pillars", "content.preferred-topics", "content.core-topics", "content.authority-areas"] },
  { key: "visual-direction", label: "Visual direction", description: "How content should look and feel", section: "content-strategy", candidates: ["content.visual-direction"] },
  { key: "goals", label: "Primary objective", description: "What content should accomplish", section: "goals", candidates: ["goals.objectives"] },
  { key: "boundaries", label: "Boundaries", description: "Topics and claims Kairo must avoid", section: "boundaries", candidates: ["boundaries.excluded-topics", "boundaries.claims-to-avoid", "boundaries.prohibited-subjects", "boundaries.owner-directive"] },
];

export function projectRuntimeFields(input?: BrandBrainRuntimeData): BrandBrainField[] {
  if (!input) return FIELD_DEFS.map((definition) => emptyField(definition));
  const activation = new Map(input.fields.map((field) => [field.fieldKey, field] as const));
  const sources = new Map(input.sources.map((source) => [source.id, source] as const));
  return FIELD_DEFS.map((definition) => {
    const source = definition.candidates.map((key) => input.brain.find((field) => field.fieldKey === key && field.state !== "stale")).find(Boolean);
    if (!source) return emptyField(definition);
    const meta = activation.get(source.fieldKey);
    const evidence = source.sourceIds.map((sourceId) => sourceLabel(sources.get(sourceId))).filter(Boolean) as string[];
    const origin = meta?.origin ?? (source.state === "confirmed" ? "user-confirmed" : source.sourceIds.length ? "source-backed" : "ai-inferred");
    const confidence = meta?.confidence.level ?? (source.state === "confirmed" || source.sourceIds.length ? "high" : "medium");
    const state = source.state === "confirmed" ? "confirmed" : meta?.weak || confidence === "low" ? "review" : "suggested";
    return {
      key: definition.key,
      fieldKey: source.fieldKey,
      section: source.section,
      version: source.version,
      label: definition.label,
      description: definition.description,
      value: source.value,
      state,
      evidence: evidence.length ? [...new Set(evidence)] : [origin === "user-confirmed" ? "Owner confirmed" : origin === "ai-inferred" ? "AI inferred" : "Source backed"],
      origin,
      confidence,
    };
  });
}

export function projectRuntimeTopics(input?: BrandBrainRuntimeData): DiscoveryTopic[] {
  return (input?.discoveryPlan?.topics ?? []).map((topic) => ({
    id: topic.id,
    name: topic.name,
    priority: topic.priority,
    audience: topic.audience,
    entities: topic.entities,
    sources: topic.sourceClasses,
  }));
}

export function projectRuntimeSources(input?: BrandBrainRuntimeData): BrandSourceUi[] {
  return (input?.sources ?? []).map((source) => ({
    id: source.id,
    title: source.title?.trim() || host(source.sourceUrl) || `${source.type} source`,
    type: source.type,
    status: source.status,
    detail: source.sourceUrl ? source.sourceUrl : "Private Brand evidence",
    synced: input?.updatedAt ? formatTimestamp(input.updatedAt) : "Not synced yet",
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
  }));
}

export function projectRuntimeLearnings(input?: BrandBrainRuntimeData): BrandLearningUi[] {
  return (input?.intelligenceSnapshot?.performanceMemory ?? []).map((learning) => ({
    id: learning.learningId,
    title: learning.statement,
    detail: learning.interpretation,
    evidence: `${Math.round(learning.confidence * 100)}% confidence · accepted ${formatTimestamp(learning.decidedAt)}`,
    effect: "Used as guidance for future discovery and recommendations",
  }));
}

function emptyField(definition: (typeof FIELD_DEFS)[number]): BrandBrainField {
  return {
    key: definition.key,
    fieldKey: definition.candidates[0]!,
    section: definition.section,
    label: definition.label,
    description: definition.description,
    value: "Not known yet",
    state: "review",
    evidence: ["No evidence yet"],
    origin: "unknown",
    confidence: "unknown",
  };
}

function sourceLabel(source: BrandBrainRuntimeData["sources"][number] | undefined): string {
  if (!source) return "";
  return source.title?.trim() || host(source.sourceUrl) || source.type;
}

function host(value?: string): string {
  if (!value) return "";
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
