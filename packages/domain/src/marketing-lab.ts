import { DomainValidationError } from "./index";
import {
  canExecuteMarketingSkill,
  canRunMarketingSkillInBenchmark,
  type BrandSkillQualificationEvidence,
  type MarketingSkillManifest,
  type MarketingSkillRegistry,
} from "./skill-registry";
import {
  compareMarketingBenchmark,
  type MarketingBenchmarkObservation,
  type MarketingBenchmarkPolicy,
  type MarketingBenchmarkResult,
} from "./marketing-benchmark";

export interface MarketingSkillRef { id: string; version: string }

export function evaluateMarketingLabComparison(input: {
  registry: MarketingSkillRegistry;
  baseline: MarketingSkillRef;
  challenger: MarketingSkillRef;
  observations: readonly MarketingBenchmarkObservation[];
  policy?: MarketingBenchmarkPolicy;
}): MarketingBenchmarkResult {
  const baseline = requiredManifest(input.registry, input.baseline, "baseline");
  const challenger = requiredManifest(input.registry, input.challenger, "challenger");
  if (baseline.source.kind !== "kairo-native" || baseline.benchmarkStatus !== "baseline" || !canExecuteMarketingSkill(baseline)) {
    throw new DomainValidationError("Marketing Lab baseline must be an approved Kairo Native baseline");
  }
  if (challenger.status === "rejected" || challenger.status === "disabled") throw new DomainValidationError("Marketing Lab challenger is not eligible for evaluation");

  const exactObservations = input.observations.filter((item) =>
    (item.candidateSkillId === baseline.id && item.candidateSkillVersion === baseline.version) ||
    (item.candidateSkillId === challenger.id && item.candidateSkillVersion === challenger.version));
  const capability = exactObservations[0]?.capability;
  if (capability && (!baseline.capabilities.includes(capability) || !challenger.capabilities.includes(capability))) {
    throw new DomainValidationError("Benchmark capability must be provided by both baseline and challenger");
  }

  const stages = new Set(exactObservations.map((item) => item.stage));
  if (stages.size === 1) {
    const stage = exactObservations[0]!.stage;
    if (stage === "offline") {
      if (challenger.executionMode !== "reference-only" && challenger.executionMode !== "sandboxed" && challenger.source.kind !== "kairo-native") {
        throw new DomainValidationError("Offline challenger must be a registered reference, sandboxed or Kairo-owned skill");
      }
    } else if (!canRunMarketingSkillInBenchmark(challenger, stage)) {
      throw new DomainValidationError(`Challenger is not approved for ${stage} benchmark execution`);
    }
  }

  return compareMarketingBenchmark({
    baselineSkillId: baseline.id,
    baselineSkillVersion: baseline.version,
    challengerSkillId: challenger.id,
    challengerSkillVersion: challenger.version,
    observations: input.observations,
    ...(input.policy ? { policy: input.policy } : {}),
  });
}

export function createBrandQualificationEvidence(result: MarketingBenchmarkResult): BrandSkillQualificationEvidence {
  if (
    result.verdict !== "qualified-for-brand" ||
    !result.workspaceId ||
    !result.brandId ||
    !result.capability ||
    !result.format
  ) throw new DomainValidationError("Brand qualification evidence requires a fully qualified benchmark result");
  return {
    verdict: "qualified-for-brand",
    workspaceId: result.workspaceId,
    brandId: result.brandId,
    capability: result.capability,
    format: result.format,
    challengerSkillId: result.challengerSkillId,
    challengerSkillVersion: result.challengerSkillVersion,
  };
}

function requiredManifest(registry: MarketingSkillRegistry, ref: MarketingSkillRef, label: string): MarketingSkillManifest {
  if (!ref || typeof ref.id !== "string" || !ref.id.trim() || typeof ref.version !== "string" || !ref.version.trim()) throw new DomainValidationError(`${label} skill reference is required`);
  const manifest = registry.get(ref.id.trim(), ref.version.trim());
  if (!manifest) throw new DomainValidationError(`${label} skill version is not registered`);
  return manifest;
}
