import { randomUUID } from "node:crypto";
import type { Angle, ResearchDossier } from "@kairo/domain/research";

export function deterministicFallbackAngles(input: {
  workspaceId: string;
  brandId: string;
  idea: { id: string; title: string };
  research: ResearchDossier;
}): Angle[] {
  const supported = input.research.claims.filter((claim) => claim.verificationState === "supported");
  const claims = supported.length ? supported : input.research.claims;
  if (!claims.length) throw new Error("Deterministic Angle fallback requires at least one Research Claim");
  const first = claims[0]!;
  const second = claims[1] ?? first;
  const uncertainty = input.research.unresolvedUncertainties[0];
  const base = {
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    ideaId: input.idea.id,
    audience: "Brand audience",
    effort: "low" as const,
    recommendedFormat: "carousel",
    recommendedChannel: "instagram",
    status: "candidate" as const,
    version: 1,
    runtimeProvenance: { runtime: "deterministic-angle-fallback", latencyMs: 0 },
  };
  return [
    {
      ...base,
      id: randomUUID(),
      title: `Evidence first: ${input.idea.title}`,
      framing: `Lead with the supported finding: ${first.text}`,
      objective: "Explain the strongest supported finding clearly",
      hookDirection: first.text,
      expectedValue: "A factual, immediately usable explanation",
      supportingClaimIds: [first.id],
    },
    {
      ...base,
      id: randomUUID(),
      title: `What remains open: ${input.idea.title}`,
      framing: uncertainty ? `Pair the supported evidence with the open question: ${uncertainty}` : `Compare the supported findings without overstating causation: ${second.text}`,
      objective: "Build trust by separating evidence from uncertainty",
      hookDirection: uncertainty ?? second.text,
      expectedValue: "A transparent alternative angle grounded in the same Research",
      supportingClaimIds: [second.id],
    },
  ];
}
