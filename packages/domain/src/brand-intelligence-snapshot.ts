import type { BrandBrainFieldDto, BrandDto, KnowledgeSourceDto } from "@kairo/contracts";
import type { CandidateLearning } from "./learning";
import {
  createBrandBrainActivationSnapshot,
  type BrandBrainActivationSnapshot,
  type BrandBrainValueOrigin,
} from "./brand-brain-activation";

export const BRAND_INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION = "1" as const;

export interface BrandIntelligenceFieldSnapshot {
  fieldKey: string;
  section: BrandBrainFieldDto["section"];
  value: string;
  state: BrandBrainFieldDto["state"];
  origin: BrandBrainValueOrigin;
  confidence: { score: number; level: "high" | "medium" | "low" };
  sourceIds: string[];
  version: number;
  updatedAt: string;
  confirmedByAccountId?: string;
}

export interface BrandIntelligencePerformanceMemory {
  learningId: string;
  statement: string;
  interpretation: string;
  confidence: number;
  applicability: CandidateLearning["applicability"];
  decidedAt: string;
}

export interface BrandIntelligenceAgentContext {
  brandName: string;
  identity?: string;
  positioning?: string;
  audience?: string;
  voice?: string;
  contentStrategy?: string;
  goals?: string;
  boundaries?: string;
}

export interface BrandIntelligenceSnapshot {
  schemaVersion: typeof BRAND_INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION;
  snapshotVersion: string;
  workspaceId: string;
  brandId: string;
  brandName: string;
  status: BrandBrainActivationSnapshot["status"];
  hunterReady: boolean;
  completeness: BrandBrainActivationSnapshot["completeness"];
  readiness: BrandBrainActivationSnapshot["readiness"];
  context: BrandIntelligenceAgentContext;
  fields: BrandIntelligenceFieldSnapshot[];
  weakFields: string[];
  readinessGaps: BrandBrainActivationSnapshot["readiness"]["gaps"];
  evidenceSourceIds: string[];
  activeSourceIds: string[];
  performanceMemory: BrandIntelligencePerformanceMemory[];
  updatedAt: string | null;
}

export interface ProjectBrandIntelligenceSnapshotInput {
  brand: Pick<BrandDto, "id" | "workspaceId" | "name">;
  fields: readonly BrandBrainFieldDto[];
  sources?: readonly KnowledgeSourceDto[];
  learnings?: readonly CandidateLearning[];
  activation?: BrandBrainActivationSnapshot;
}

/**
 * Canonical Brand-private intelligence contract shared by Kairo agents.
 *
 * The snapshot is projected from persisted Brand Brain/source/learning state and receives a stable
 * version derived from that state. Agent outputs should record snapshotVersion so a decision can be
 * traced back to the exact Brand intelligence that informed it.
 */
export function projectBrandIntelligenceSnapshot(input: ProjectBrandIntelligenceSnapshotInput): BrandIntelligenceSnapshot {
  const sources = input.sources ?? [];
  const activation = input.activation ?? createBrandBrainActivationSnapshot(input.fields, sources);
  const fields = projectFields(input.fields, activation);
  const performanceMemory = projectPerformanceMemory(input.brand.id, input.learnings ?? []);
  const activeSourceIds = unique(sources.filter((source) => source.status === "active").map((source) => source.id));
  const evidenceSourceIds = unique([
    ...activeSourceIds,
    ...fields.flatMap((field) => field.sourceIds),
  ]);
  const updatedAt = latestTimestamp([
    ...fields.map((field) => field.updatedAt),
    ...sources.map((source) => source.updatedAt),
    ...performanceMemory.map((memory) => memory.decidedAt),
  ]);
  const snapshotVersion = `${input.brand.id}@${updatedAt ?? "brain-empty"}`;

  return {
    schemaVersion: BRAND_INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion,
    workspaceId: input.brand.workspaceId,
    brandId: input.brand.id,
    brandName: input.brand.name,
    status: activation.status,
    hunterReady: activation.hunterReady,
    completeness: activation.completeness,
    readiness: activation.readiness,
    context: projectContext(input.brand.name, fields),
    fields,
    weakFields: [...activation.weakFields],
    readinessGaps: [...activation.readiness.gaps],
    evidenceSourceIds,
    activeSourceIds,
    performanceMemory,
    updatedAt,
  };
}

/** Compact payload intended for Hunter, Researcher, Strategist, Drafter, Critic and Judge prompts. */
export function compactBrandIntelligenceSnapshot(snapshot: BrandIntelligenceSnapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    snapshotVersion: snapshot.snapshotVersion,
    status: snapshot.status,
    hunterReady: snapshot.hunterReady,
    completeness: snapshot.completeness.score,
    brand: snapshot.context,
    ...(snapshot.weakFields.length ? { weakFields: snapshot.weakFields } : {}),
    ...(snapshot.readinessGaps.length ? { readinessGaps: snapshot.readinessGaps } : {}),
    ...(snapshot.performanceMemory.length
      ? {
          performanceMemory: snapshot.performanceMemory.map((memory) => ({
            statement: memory.statement,
            interpretation: memory.interpretation,
            confidence: memory.confidence,
            ...(Object.keys(memory.applicability).length ? { applicability: memory.applicability } : {}),
          })),
        }
      : {}),
  };
}

function projectFields(
  values: readonly BrandBrainFieldDto[],
  activation: BrandBrainActivationSnapshot,
): BrandIntelligenceFieldSnapshot[] {
  const activeByKey = new Map(activation.fields.map((field) => [field.fieldKey, field] as const));
  const newest = newestByField(values);
  return newest.map((field) => {
    const metadata = activeByKey.get(field.fieldKey);
    const origin: BrandBrainValueOrigin = metadata?.origin ?? (field.state === "confirmed" ? "user-confirmed" : field.sourceIds.length ? "source-backed" : "ai-inferred");
    const confidence = metadata?.confidence ?? { score: field.state === "confirmed" ? 1 : field.sourceIds.length ? 0.85 : 0.55, level: field.state === "confirmed" || field.sourceIds.length ? "high" as const : "medium" as const };
    return {
      fieldKey: field.fieldKey,
      section: field.section,
      value: field.value.trim(),
      state: field.state,
      origin,
      confidence,
      sourceIds: unique(field.sourceIds),
      version: field.version,
      updatedAt: field.updatedAt,
      ...(field.confirmedByAccountId ? { confirmedByAccountId: field.confirmedByAccountId } : {}),
    };
  });
}

function projectContext(brandName: string, fields: readonly BrandIntelligenceFieldSnapshot[]): BrandIntelligenceAgentContext {
  return {
    brandName,
    ...section(fields, "identity", "identity"),
    ...section(fields, "positioning", "positioning"),
    ...section(fields, "audience", "audience"),
    ...section(fields, "voice", "voice"),
    ...section(fields, "content-strategy", "contentStrategy"),
    ...section(fields, "goals", "goals"),
    ...section(fields, "boundaries", "boundaries"),
  };
}

function section<K extends Exclude<keyof BrandIntelligenceAgentContext, "brandName">>(
  fields: readonly BrandIntelligenceFieldSnapshot[],
  sectionName: BrandBrainFieldDto["section"],
  key: K,
): Partial<Pick<BrandIntelligenceAgentContext, K>> {
  const value = fields
    .filter((field) => field.section === sectionName && field.state !== "stale")
    .sort((left, right) => left.fieldKey.localeCompare(right.fieldKey))
    .map((field) => `${field.fieldKey}: ${field.value}`)
    .join(" · ")
    .slice(0, 8_000);
  return value ? ({ [key]: value } as Partial<Pick<BrandIntelligenceAgentContext, K>>) : {};
}

function projectPerformanceMemory(brandId: string, learnings: readonly CandidateLearning[]): BrandIntelligencePerformanceMemory[] {
  return learnings
    .filter((learning) => learning.brandId === brandId && learning.status === "accepted")
    .sort((left, right) => learningTime(right).localeCompare(learningTime(left)))
    .slice(0, 12)
    .map((learning) => ({
      learningId: learning.id,
      statement: learning.statement,
      interpretation: learning.interpretation,
      confidence: learning.confidence,
      applicability: { ...learning.applicability },
      decidedAt: learningTime(learning),
    }));
}

function newestByField(fields: readonly BrandBrainFieldDto[]): BrandBrainFieldDto[] {
  const newest = new Map<string, BrandBrainFieldDto>();
  for (const field of fields) {
    const current = newest.get(field.fieldKey);
    if (!current || stateRank(field.state) > stateRank(current.state) || (stateRank(field.state) === stateRank(current.state) && field.updatedAt > current.updatedAt)) {
      newest.set(field.fieldKey, field);
    }
  }
  return [...newest.values()].sort((left, right) => left.fieldKey.localeCompare(right.fieldKey));
}

function stateRank(state: BrandBrainFieldDto["state"]): number {
  return state === "confirmed" ? 3 : state === "inferred" ? 2 : 1;
}

function learningTime(learning: CandidateLearning): string {
  return learning.decidedAt ?? learning.createdAt;
}

function latestTimestamp(values: readonly string[]): string | null {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
