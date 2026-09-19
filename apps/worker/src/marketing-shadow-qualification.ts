import { prepareAgentInvocation, type AgentInvocationMetadata, type AgentRuntimePort } from "@kairo/agent-contracts";
import { validateCarouselPlan, type CarouselPlan } from "@kairo/domain/creative-formats";
import type { MarketingBenchmarkObservation, MarketingQualityScores } from "@kairo/domain/marketing-benchmark";
import {
  MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION,
  marketingShadowInputFingerprint,
  type MarketingShadowBenchmarkCase,
} from "./marketing-shadow";

export const KAIRO_NATIVE_CAROUSEL_BASELINE = Object.freeze({ id: "kairo-native-carousel", version: "1" });

export const MARKETING_NATIVE_BASELINE_INSTRUCTION = [
  "Kairo Marketing Lab native baseline evaluation.",
  "Use only the supplied benchmark Claims and evidence context; never invent facts, experience, evidence, approvals or results.",
  MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION,
  "Do not use external marketing-skill reference material.",
  "Do not request tools, network access, credentials, publishing, policy changes or information outside the benchmark case.",
  "Return exactly one typed Claim-linked creative plan in the requested format.",
].join(" ");

export interface MotorcycleCarouselFixture {
  id: string;
  sector: string;
  format: string;
  audience: string;
  objective: string;
  opportunity: string;
  claims: Array<{ id: string; text: string }>;
}

export interface MarketingNativeBaselineExecution {
  baseline: { id: string; version: string };
  benchmarkCase: MarketingShadowBenchmarkCase;
  inputFingerprint: string;
  output: CarouselPlan;
  metadata: AgentInvocationMetadata;
}

export interface MarketingNativeEvaluation {
  truthPassed: boolean;
  scores: MarketingQualityScores;
  humanPreferenceScore?: number;
  editDistancePercent?: number;
}

const QUALIFICATION_SCOPE = Object.freeze({
  datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
  workspaceId: "workspace-marketing-lab",
  brandId: "brand-motorcycle-synth",
  sector: "Motorcycles / Bikes",
  capability: "carousel-strategy" as const,
  format: "carousel" as const,
  audience: "enthusiast buyers",
  objective: "comparison and saves",
});

export function toMotorcycleCarouselQualificationCase(fixture: MotorcycleCarouselFixture): MarketingShadowBenchmarkCase {
  if (!fixture || fixture.sector !== QUALIFICATION_SCOPE.sector || fixture.format !== QUALIFICATION_SCOPE.format || fixture.audience !== QUALIFICATION_SCOPE.audience || fixture.objective !== QUALIFICATION_SCOPE.objective) {
    throw new Error("Fixture is outside the approved motorcycle carousel qualification scope");
  }
  if (!/^motorcycle-carousel-0[1-4]$/.test(fixture.id)) throw new Error("Fixture is not one of the approved motorcycle carousel qualification cases");
  if (!Array.isArray(fixture.claims) || fixture.claims.length < 2) throw new Error("Qualification fixture requires at least two Claims");
  const claims = fixture.claims.map((claim) => ({
    id: requiredText(claim.id, "claim.id"),
    statement: requiredText(claim.text, "claim.text"),
    evidenceRefs: [`fixture://${fixture.id}/${requiredText(claim.id, "claim.id")}`],
  }));
  return {
    datasetId: QUALIFICATION_SCOPE.datasetId,
    dataClassification: "synthetic",
    caseId: fixture.id,
    workspaceId: QUALIFICATION_SCOPE.workspaceId,
    brandId: QUALIFICATION_SCOPE.brandId,
    capability: QUALIFICATION_SCOPE.capability,
    format: QUALIFICATION_SCOPE.format,
    objective: fixture.opportunity,
    audience: fixture.audience,
    claims,
    requiredClaimIds: claims.map((claim) => claim.id),
    prohibitedPatterns: [
      "guaranteed result",
      "we personally tested",
      "i personally tested",
      "official ktm",
    ],
  };
}

export async function executeKairoNativeCarouselBaseline(
  runtime: AgentRuntimePort,
  benchmarkCase: MarketingShadowBenchmarkCase,
): Promise<MarketingNativeBaselineExecution> {
  if (benchmarkCase.capability !== "carousel-strategy" || benchmarkCase.format !== "carousel") throw new Error("Kairo Native carousel baseline requires carousel-strategy/carousel scope");
  const inputFingerprint = marketingShadowInputFingerprint(benchmarkCase);
  const request = prepareAgentInvocation({
    role: "strategist",
    scope: { visibility: "brand-private", workspaceId: benchmarkCase.workspaceId, brandId: benchmarkCase.brandId },
    approvedContextVersion: `marketing-shadow:${inputFingerprint.slice(0, 40)}`,
    capabilities: [],
    task: {
      instruction: MARKETING_NATIVE_BASELINE_INSTRUCTION,
      context: {
        benchmarkCase: {
          datasetId: benchmarkCase.datasetId,
          dataClassification: benchmarkCase.dataClassification,
          caseId: benchmarkCase.caseId,
          capability: benchmarkCase.capability,
          format: benchmarkCase.format,
          objective: benchmarkCase.objective,
          audience: benchmarkCase.audience,
          claims: benchmarkCase.claims.map((claim) => ({ id: claim.id, statement: claim.statement, evidenceRefs: claim.evidenceRefs })),
          requiredClaimIds: benchmarkCase.requiredClaimIds,
          prohibitedPatterns: benchmarkCase.prohibitedPatterns ?? [],
        },
      },
    },
    outputSchema: { name: "marketing-carousel-plan", version: "1" },
    budget: { maxOutputTokens: 2_200, maxToolCalls: 0, maxCostUsd: 0.03, timeoutMs: 30_000 },
  });
  const result = await runtime.invoke<CarouselPlan>(request);
  const output = validateQualificationCarousel(result.output, benchmarkCase);
  return {
    baseline: { ...KAIRO_NATIVE_CAROUSEL_BASELINE },
    benchmarkCase,
    inputFingerprint,
    output,
    metadata: { ...result.metadata },
  };
}

export function buildMarketingNativeObservation(
  execution: MarketingNativeBaselineExecution,
  evaluation: MarketingNativeEvaluation,
): MarketingBenchmarkObservation {
  if (!evaluation || typeof evaluation.truthPassed !== "boolean") throw new Error("Kairo truth evaluation is required");
  const costUsd = execution.metadata.costUsd;
  if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd < 0) throw new Error("Measured runtime cost metadata is required for qualification evidence");
  if (!Number.isFinite(execution.metadata.latencyMs) || execution.metadata.latencyMs < 0) throw new Error("Measured runtime latency metadata is required for qualification evidence");
  const scores = validateScores(evaluation.scores);
  return {
    caseId: execution.benchmarkCase.caseId,
    inputFingerprint: execution.inputFingerprint,
    workspaceId: execution.benchmarkCase.workspaceId,
    brandId: execution.benchmarkCase.brandId,
    capability: execution.benchmarkCase.capability,
    format: execution.benchmarkCase.format,
    stage: "shadow",
    candidateSkillId: execution.baseline.id,
    candidateSkillVersion: execution.baseline.version,
    truthPassed: evaluation.truthPassed,
    scores,
    ...(evaluation.humanPreferenceScore !== undefined ? { humanPreferenceScore: score(evaluation.humanPreferenceScore, "humanPreferenceScore") } : {}),
    ...(evaluation.editDistancePercent !== undefined ? { editDistancePercent: score(evaluation.editDistancePercent, "editDistancePercent") } : {}),
    latencyMs: execution.metadata.latencyMs,
    costUsd,
  };
}

function validateQualificationCarousel(output: CarouselPlan, benchmarkCase: MarketingShadowBenchmarkCase): CarouselPlan {
  const value = validateCarouselPlan(output);
  const allowed = new Set(benchmarkCase.claims.map((claim) => claim.id));
  if (value.supportingClaimIds.some((id) => !allowed.has(id))) throw new Error("Native baseline output references a Claim outside the benchmark lineage");
  if (benchmarkCase.requiredClaimIds.some((id) => !value.supportingClaimIds.includes(id))) throw new Error("Native baseline output omitted a required Claim");
  const visible = JSON.stringify(value).toLowerCase();
  for (const pattern of benchmarkCase.prohibitedPatterns ?? []) {
    if (visible.includes(pattern.toLowerCase())) throw new Error("Native baseline output contains a prohibited benchmark pattern");
  }
  return value;
}

function validateScores(value: MarketingQualityScores): MarketingQualityScores {
  if (!value || typeof value !== "object") throw new Error("Kairo quality scores are required");
  return {
    brandFit: score(value.brandFit, "brandFit"),
    hookQuality: score(value.hookQuality, "hookQuality"),
    originality: score(value.originality, "originality"),
    formatQuality: score(value.formatQuality, "formatQuality"),
    criticScore: score(value.criticScore, "criticScore"),
  };
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${field} must be between 0 and 100`);
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}
