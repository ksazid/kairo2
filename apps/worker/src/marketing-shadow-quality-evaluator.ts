import {
  prepareAgentInvocation,
  type AgentInvocationMetadata,
  type AgentRuntimePort,
  type JsonValue,
} from "@kairo/agent-contracts";
import {
  validateCarouselPlan,
  validateReelPlan,
  type CarouselPlan,
  type MarketingCreativePlan,
  type ReelPlan,
} from "@kairo/domain/creative-formats";
import type { MarketingQualityScores } from "@kairo/domain/marketing-benchmark";
import {
  marketingShadowInputFingerprint,
  type MarketingShadowBenchmarkCase,
} from "./marketing-shadow";

export const MARKETING_SHADOW_QUALITY_EVALUATOR_INSTRUCTION = [
  "Kairo Marketing Lab independent blind evaluator.",
  "Evaluate Candidate A and Candidate B only against the supplied synthetic benchmark case, audience, objective and Claims.",
  "Candidate labels are anonymized; do not infer or guess which system, skill, provider or source produced either candidate.",
  "Use no external knowledge as evidence and never let candidate wording create its own support.",
  "Truth is independent of quality: truthPassed MUST be false if visible content asserts any factual, technical, experiential, quantitative, causal, model-specific or capability detail that is not directly entailed by the supplied benchmark Claims.",
  "Creative or rhetorical framing may be novel, but it must not introduce unsupported factual support.",
  "Apply the exact same 0-100 rubric to both candidates: brandFit = fit to this synthetic benchmark scope/audience/objective; hookQuality = relevant stopping power without overclaiming; originality = useful non-generic framing while grounded; formatQuality = structure, progression, scannability and CTA fit; criticScore = holistic usefulness, clarity and persuasiveness subject to Truth.",
  "Return concise reasons for each candidate. If Truth fails, identify the unsupported assertion category or example. Never return human preference, edit-distance, approval, publishing or advancement decisions.",
].join(" ");

export interface MarketingShadowQualityCandidateEvaluation {
  truthPassed: boolean;
  scores: MarketingQualityScores;
  reasons: string[];
}

export interface MarketingShadowQualityEvaluatorProvenance {
  runtime: string;
  runtimeVersion?: string;
  provider?: string;
  model?: string;
  modelVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  pricingVersion?: string;
  latencyMs: number;
}

export interface MarketingShadowPairQualityEvaluation {
  inputFingerprint: string;
  candidateA: MarketingShadowQualityCandidateEvaluation;
  candidateB: MarketingShadowQualityCandidateEvaluation;
  provenance: MarketingShadowQualityEvaluatorProvenance;
}

interface RawCandidateEvaluation {
  truthPassed?: unknown;
  scores?: unknown;
  reasons?: unknown;
}

interface RawPairEvaluation {
  candidateA?: RawCandidateEvaluation;
  candidateB?: RawCandidateEvaluation;
}

export async function evaluateMarketingShadowPair(
  runtime: AgentRuntimePort,
  input: {
    benchmarkCase: MarketingShadowBenchmarkCase;
    candidateA: MarketingCreativePlan;
    candidateB: MarketingCreativePlan;
  },
): Promise<MarketingShadowPairQualityEvaluation> {
  const inputFingerprint = marketingShadowInputFingerprint(input.benchmarkCase);
  const candidateA = validateCandidate(input.candidateA, input.benchmarkCase);
  const candidateB = validateCandidate(input.candidateB, input.benchmarkCase);

  const request = prepareAgentInvocation({
    role: "critic",
    scope: { visibility: "global-public" },
    approvedContextVersion: `marketing-quality:${inputFingerprint.slice(0, 40)}`,
    capabilities: [],
    task: {
      instruction: MARKETING_SHADOW_QUALITY_EVALUATOR_INSTRUCTION,
      context: {
        benchmarkCase: {
          datasetId: input.benchmarkCase.datasetId,
          dataClassification: input.benchmarkCase.dataClassification,
          caseId: input.benchmarkCase.caseId,
          capability: input.benchmarkCase.capability,
          format: input.benchmarkCase.format,
          objective: input.benchmarkCase.objective,
          audience: input.benchmarkCase.audience,
          claims: input.benchmarkCase.claims.map((claim) => ({ id: claim.id, statement: claim.statement })),
          requiredClaimIds: [...input.benchmarkCase.requiredClaimIds],
        },
        candidateA: candidateContext(candidateA),
        candidateB: candidateContext(candidateB),
      },
    },
    outputSchema: { name: "marketing-pair-quality-evaluation", version: "1" },
    budget: {
      maxOutputTokens: 1_800,
      maxToolCalls: 0,
      maxCostUsd: 0.03,
      timeoutMs: 30_000,
    },
  });

  const result = await runtime.invoke<RawPairEvaluation>(request);
  const evaluation = validatePairEvaluation(result.output);
  return {
    inputFingerprint,
    ...evaluation,
    provenance: evaluatorProvenance(result.metadata),
  };
}

export function validateMarketingShadowPairQualityEvaluation(value: unknown): {
  candidateA: MarketingShadowQualityCandidateEvaluation;
  candidateB: MarketingShadowQualityCandidateEvaluation;
} {
  return validatePairEvaluation(value);
}

function validatePairEvaluation(value: unknown): {
  candidateA: MarketingShadowQualityCandidateEvaluation;
  candidateB: MarketingShadowQualityCandidateEvaluation;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Marketing quality evaluation must be an object");
  }
  const item = value as RawPairEvaluation;
  return {
    candidateA: validateCandidateEvaluation(item.candidateA, "candidateA"),
    candidateB: validateCandidateEvaluation(item.candidateB, "candidateB"),
  };
}

function validateCandidateEvaluation(
  value: RawCandidateEvaluation | undefined,
  field: string,
): MarketingShadowQualityCandidateEvaluation {
  if (!value || typeof value !== "object") throw new Error(`${field} evaluation is required`);
  if (typeof value.truthPassed !== "boolean") throw new Error(`${field}.truthPassed must be boolean`);
  if (!value.scores || typeof value.scores !== "object" || Array.isArray(value.scores)) {
    throw new Error(`${field}.scores are required`);
  }
  const scores = value.scores as Partial<Record<keyof MarketingQualityScores, unknown>>;
  const reasons = value.reasons;
  if (!Array.isArray(reasons) || reasons.length < 1 || reasons.length > 6) {
    throw new Error(`${field}.reasons must contain 1-6 concise reasons`);
  }
  return {
    truthPassed: value.truthPassed,
    scores: {
      brandFit: boundedScore(scores.brandFit, `${field}.scores.brandFit`),
      hookQuality: boundedScore(scores.hookQuality, `${field}.scores.hookQuality`),
      originality: boundedScore(scores.originality, `${field}.scores.originality`),
      formatQuality: boundedScore(scores.formatQuality, `${field}.scores.formatQuality`),
      criticScore: boundedScore(scores.criticScore, `${field}.scores.criticScore`),
    },
    reasons: reasons.map((reason, index) => boundedText(reason, `${field}.reasons[${index}]`, 500)),
  };
}

function validateCandidate(
  output: MarketingCreativePlan,
  benchmarkCase: MarketingShadowBenchmarkCase,
): MarketingCreativePlan {
  const value = benchmarkCase.format === "carousel"
    ? validateCarouselPlan(output as CarouselPlan)
    : validateReelPlan(output as ReelPlan);
  const allowed = new Set(benchmarkCase.claims.map((claim) => claim.id));
  if (value.supportingClaimIds.some((id) => !allowed.has(id))) {
    throw new Error("Evaluator candidate references a Claim outside the benchmark case");
  }
  if (benchmarkCase.requiredClaimIds.some((id) => !value.supportingClaimIds.includes(id))) {
    throw new Error("Evaluator candidate omitted a required benchmark Claim");
  }
  return value;
}

function candidateContext(value: MarketingCreativePlan): JsonValue {
  if (value.format === "carousel") {
    return {
      format: value.format,
      coverHook: value.coverHook,
      slides: value.slides.map((slide) => ({
        headline: slide.headline,
        body: slide.body,
        supportingClaimIds: [...slide.supportingClaimIds],
      })),
      caption: value.caption,
      cta: value.cta,
      supportingClaimIds: [...value.supportingClaimIds],
    };
  }
  return {
    format: value.format,
    hook: value.hook,
    targetDurationSeconds: value.targetDurationSeconds,
    scenes: value.scenes.map((scene) => ({
      startSecond: scene.startSecond,
      endSecond: scene.endSecond,
      visual: scene.visual,
      onScreenText: scene.onScreenText,
      voiceover: scene.voiceover,
      supportingClaimIds: [...scene.supportingClaimIds],
    })),
    caption: value.caption,
    cta: value.cta,
    supportingClaimIds: [...value.supportingClaimIds],
  };
}

function evaluatorProvenance(metadata: AgentInvocationMetadata): MarketingShadowQualityEvaluatorProvenance {
  if (!Number.isFinite(metadata.latencyMs) || metadata.latencyMs < 0) {
    throw new Error("Evaluator latency metadata is invalid");
  }
  if (metadata.costUsd !== undefined && (!Number.isFinite(metadata.costUsd) || metadata.costUsd < 0)) {
    throw new Error("Evaluator cost metadata is invalid");
  }
  return {
    runtime: boundedText(metadata.runtime, "metadata.runtime", 120),
    ...(metadata.runtimeVersion ? { runtimeVersion: boundedText(metadata.runtimeVersion, "metadata.runtimeVersion", 120) } : {}),
    ...(metadata.provider ? { provider: boundedText(metadata.provider, "metadata.provider", 120) } : {}),
    ...(metadata.model ? { model: boundedText(metadata.model, "metadata.model", 240) } : {}),
    ...(metadata.modelVersion ? { modelVersion: boundedText(metadata.modelVersion, "metadata.modelVersion", 240) } : {}),
    ...(metadata.inputTokens !== undefined ? { inputTokens: nonNegativeInteger(metadata.inputTokens, "metadata.inputTokens") } : {}),
    ...(metadata.outputTokens !== undefined ? { outputTokens: nonNegativeInteger(metadata.outputTokens, "metadata.outputTokens") } : {}),
    ...(metadata.costUsd !== undefined ? { costUsd: metadata.costUsd } : {}),
    ...(metadata.pricingVersion ? { pricingVersion: boundedText(metadata.pricingVersion, "metadata.pricingVersion", 240) } : {}),
    latencyMs: metadata.latencyMs,
  };
}

function boundedScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
  return value;
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field} is too long`);
  return text;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}
