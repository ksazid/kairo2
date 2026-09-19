import { prepareAgentInvocation, type AgentInvocationMetadata, type AgentRuntimePort } from "@kairo/agent-contracts";
import type { CriticFinding, CriticResult } from "@kairo/domain/review";

interface ScopedReview { workspaceId: string; brandId: string; brandContextVersion: string }
interface CriticOutput extends CriticResult {}
interface JudgeOutput { selectedVersionId: string; rationale: string }
export interface ReviewProvenance { runtime: string; provider?: string; model?: string; latencyMs: number }

export class CriticOrchestrator {
  constructor(private readonly runtime: AgentRuntimePort) {}
  async run(input: ScopedReview & { version: { id: string; content: string; supportingClaimIds: string[] }; claims: Array<{ id: string; text: string }>; rubric: string[] }): Promise<CriticResult & { provenance: ReviewProvenance }> {
    const request = prepareAgentInvocation({ role: "critic", scope: { visibility: "brand-private", workspaceId: input.workspaceId, brandId: input.brandId }, approvedContextVersion: input.brandContextVersion, capabilities: [], task: { instruction: "Independently evaluate only the visible content against the supplied rubric and evidence. Do not infer hidden Drafter reasoning. Return advisory or revision findings; never claim approval, publishing authority, or override deterministic policy.", context: { version: input.version, claims: input.claims, rubric: input.rubric } }, outputSchema: { name: "critic-review", version: "1" }, budget: { maxOutputTokens: 1800, maxToolCalls: 0, maxCostUsd: 0.1, timeoutMs: 30_000 } });
    const result = await this.runtime.invoke<CriticOutput>(request);
    if (!validCritic(result.output)) throw new Error("Critic output failed schema validation");
    return { passed: result.output.passed, score: result.output.score, findings: result.output.findings.map((finding) => ({ ...finding })), provenance: provenance(result.metadata) };
  }
}

export class JudgeOrchestrator {
  constructor(private readonly runtime: AgentRuntimePort) {}
  async run(input: ScopedReview & { candidates: Array<{ versionId: string; content: string; criticScore: number }> }): Promise<JudgeOutput & { provenance: ReviewProvenance }> {
    if (input.candidates.length < 1) throw new Error("Judge requires at least one valid candidate");
    const request = prepareAgentInvocation({ role: "judge", scope: { visibility: "brand-private", workspaceId: input.workspaceId, brandId: input.brandId }, approvedContextVersion: input.brandContextVersion, capabilities: [], task: { instruction: "Select exactly one strongest candidate from the supplied truth-valid, Critic-passed candidates. Explain the user-visible choice briefly. Never approve or publish content.", context: { candidates: input.candidates } }, outputSchema: { name: "judge-selection", version: "1" }, budget: { maxOutputTokens: 600, maxToolCalls: 0, maxCostUsd: 0.06, timeoutMs: 20_000 } });
    const result = await this.runtime.invoke<JudgeOutput>(request);
    if (!validJudge(result.output) || !input.candidates.some((candidate) => candidate.versionId === result.output.selectedVersionId)) throw new Error("Judge must select a supplied candidate");
    return { selectedVersionId: result.output.selectedVersionId, rationale: result.output.rationale.trim(), provenance: provenance(result.metadata) };
  }
}

function validCritic(value: unknown): value is CriticOutput { if (!value || typeof value !== "object") return false; const item = value as CriticOutput; return typeof item.passed === "boolean" && typeof item.score === "number" && Number.isFinite(item.score) && item.score >= 0 && item.score <= 100 && Array.isArray(item.findings) && item.findings.every(validFinding); }
function validFinding(value: unknown): value is CriticFinding { if (!value || typeof value !== "object") return false; const item = value as CriticFinding; return typeof item.code === "string" && item.code.length > 0 && (item.severity === "advisory" || item.severity === "revision") && typeof item.message === "string" && item.message.length > 0; }
function validJudge(value: unknown): value is JudgeOutput { if (!value || typeof value !== "object") return false; const item = value as JudgeOutput; return typeof item.selectedVersionId === "string" && item.selectedVersionId.length > 0 && typeof item.rationale === "string" && item.rationale.trim().length > 0; }
function provenance(metadata: AgentInvocationMetadata): ReviewProvenance { return { runtime: metadata.runtime, ...(metadata.provider ? { provider: metadata.provider } : {}), ...(metadata.model ? { model: metadata.model } : {}), latencyMs: metadata.latencyMs }; }
