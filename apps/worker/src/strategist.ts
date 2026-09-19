import { randomUUID } from "node:crypto";
import { prepareAgentInvocation, type AgentRuntimePort } from "@kairo/agent-contracts";
import type { Angle, ResearchDossier } from "@kairo/domain/research";

export interface StrategistCandidate {
  title: string;
  framing: string;
  audience: string;
  objective: string;
  hookDirection: string;
  expectedValue: string;
  effort: "low" | "medium" | "high";
  recommendedFormat: string;
  recommendedChannel: string;
  supportingClaimIds: string[];
}

export interface StrategistOutput { candidates: StrategistCandidate[] }

export interface StrategistRunInput {
  accountId: string;
  workspaceId: string;
  brandId: string;
  brandContextVersion: string;
  idea: { id: string; title: string; premise: string };
  research: ResearchDossier;
}

export interface AngleSink { saveCandidateAngles(accountId: string, angles: readonly Angle[]): Promise<unknown> }

export class StrategistOrchestrator {
  constructor(private readonly runtime: AgentRuntimePort, private readonly sink: AngleSink) {}

  async run(input: StrategistRunInput): Promise<{ angleCount: number; angleIds: string[] }> {
    if (input.research.workspaceId !== input.workspaceId || input.research.brandId !== input.brandId || input.research.ideaId !== input.idea.id) {
      throw new Error("Research scope does not match Idea scope");
    }
    const invocation = prepareAgentInvocation({
      role: "strategist",
      scope: { visibility: "brand-private", workspaceId: input.workspaceId, brandId: input.brandId },
      approvedContextVersion: input.brandContextVersion,
      capabilities: [],
      task: {
        instruction: "Generate exactly 2 distinct candidate Angles from validated Research. Cite only supplied Claim IDs. Do not draft final content or invent evidence, results, or first-person experience. Return exactly one JSON object with a candidates array containing exactly 2 entries. Every candidate must contain non-empty title, framing, audience, objective, hookDirection, expectedValue, recommendedFormat and recommendedChannel; effort must be low, medium or high; supportingClaimIds must be a non-empty array containing only Claim IDs supplied in context. Make the candidates meaningfully different from one another so a human can choose a direction.",
        context: {
          idea: input.idea,
          research: {
            summary: input.research.summary,
            claims: input.research.claims.map((claim) => ({ id: claim.id, text: claim.text, classification: claim.classification, verificationState: claim.verificationState, confidence: claim.confidence })),
            unresolvedUncertainties: input.research.unresolvedUncertainties,
          },
        },
      },
      outputSchema: { name: "strategist-angles", version: "1" },
      budget: { maxOutputTokens: 2_500, maxToolCalls: 0, maxCostUsd: 0.12, timeoutMs: 40_000 },
    });
    const result = await this.runtime.invoke<StrategistOutput>(invocation);
    if (!isStrategistOutput(result.output)) throw new Error("Strategist output failed schema validation");
    if (result.output.candidates.length < 2) throw new Error("Strategist must return two candidate Angles");
    const knownClaims = new Set(input.research.claims.map((claim) => claim.id));
    for (const candidate of result.output.candidates) {
      if (!candidate.supportingClaimIds.length || candidate.supportingClaimIds.some((id) => !knownClaims.has(id))) {
        throw new Error("Candidate Angle references an unknown Claim");
      }
    }
    const provenance = { runtime: result.metadata.runtime, ...(result.metadata.provider ? { provider: result.metadata.provider } : {}), ...(result.metadata.model ? { model: result.metadata.model } : {}), ...(result.metadata.costUsd !== undefined ? { costUsd: result.metadata.costUsd } : {}), latencyMs: result.metadata.latencyMs };
    const angles: Angle[] = result.output.candidates.slice(0, 2).map((candidate) => ({
      id: randomUUID(), workspaceId: input.workspaceId, brandId: input.brandId, ideaId: input.idea.id,
      ...candidate, supportingClaimIds: [...new Set(candidate.supportingClaimIds)], status: "candidate", version: 1,
      runtimeProvenance: provenance,
    }));
    await this.sink.saveCandidateAngles(input.accountId, angles);
    return { angleCount: angles.length, angleIds: angles.map((angle) => angle.id) };
  }
}

export function isStrategistOutput(value: unknown): value is StrategistOutput {
  if (!value || typeof value !== "object" || !Array.isArray((value as StrategistOutput).candidates)) return false;
  const candidates = (value as StrategistOutput).candidates;
  return candidates.length <= 5 && candidates.every((candidate) => candidate &&
    [candidate.title, candidate.framing, candidate.audience, candidate.objective, candidate.hookDirection, candidate.expectedValue, candidate.recommendedFormat, candidate.recommendedChannel].every(nonEmpty) &&
    ["low", "medium", "high"].includes(candidate.effort) && Array.isArray(candidate.supportingClaimIds) && candidate.supportingClaimIds.every(nonEmpty));
}

function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
