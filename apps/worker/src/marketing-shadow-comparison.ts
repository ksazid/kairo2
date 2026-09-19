import { DomainValidationError } from "@kairo/domain";
import { evaluateMarketingLabComparison, type MarketingSkillRef } from "@kairo/domain/marketing-lab";
import type { MarketingBenchmarkObservation, MarketingBenchmarkPolicy, MarketingBenchmarkResult } from "@kairo/domain/marketing-benchmark";
import type { MarketingSkillRegistry } from "@kairo/domain/skill-registry";

export function evaluateMarketingShadowComparison(input: {
  registry: MarketingSkillRegistry;
  baseline: MarketingSkillRef;
  challenger: MarketingSkillRef;
  observations: readonly MarketingBenchmarkObservation[];
  policy?: MarketingBenchmarkPolicy;
}): MarketingBenchmarkResult {
  if (!input.observations.length) throw new DomainValidationError("Shadow comparison requires paired observations");
  if (input.observations.some((item) => item.stage !== "shadow")) throw new DomainValidationError("VS-19 comparison accepts shadow observations only");
  const result = evaluateMarketingLabComparison(input);
  if (result.stage !== "shadow") throw new DomainValidationError("VS-19 comparison must remain in shadow stage");
  if (result.verdict === "qualified-for-brand") throw new DomainValidationError("Shadow execution cannot qualify a Brand skill");
  return result;
}
