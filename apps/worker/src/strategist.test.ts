import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort, AgentRuntimeResult } from "@kairo/agent-contracts";
import type { Angle, ResearchDossier } from "@kairo/domain/research";
import { StrategistOrchestrator, type StrategistOutput } from "./strategist";

class FakeRuntime implements AgentRuntimePort {
  lastRequest: AgentInvocationRequest | null = null;
  constructor(private readonly output: StrategistOutput) {}
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.lastRequest = request;
    return { output: this.output as TOutput, metadata: { runtime: "fixture", latencyMs: 1 } };
  }
}

class FakeSink {
  saved: Angle[][] = [];
  async saveCandidateAngles(_accountId: string, angles: readonly Angle[]) { this.saved.push([...angles]); }
}

const research: ResearchDossier = {
  id: "research-1", workspaceId: "workspace-1", brandId: "brand-1", ideaId: "idea-1",
  summary: "Supported research", evidence: [{ id: "evidence-1", sourceUrl: "https://example.com/report", sourceTitle: "Report", retrievedAt: "2026-08-13T08:00:00.000Z" }],
  claims: [{ id: "claim-1", text: "The report records a change.", classification: "fact", confidence: 0.9, evidenceStrength: "strong", verificationState: "supported", freshness: "fresh", evidenceIds: ["evidence-1"], firstPersonAuthorization: "not-applicable" }],
  unresolvedUncertainties: ["Long-term impact is unknown."], status: "ready", createdAt: "2026-08-13T08:05:00.000Z",
};

const input = { accountId: "account-1", workspaceId: "workspace-1", brandId: "brand-1", brandContextVersion: "brand-1@7", idea: { id: "idea-1", title: "A change", premise: "Explain why it matters" }, research };

function output(overrides: Partial<StrategistOutput> = {}): StrategistOutput {
  return { candidates: [
    { title: "Evidence first", framing: "Explain the finding", audience: "Founders", objective: "Education", hookDirection: "Lead with evidence", expectedValue: "Clarity", effort: "low", recommendedFormat: "text", recommendedChannel: "linkedin", supportingClaimIds: ["claim-1"] },
    { title: "Uncertainty first", framing: "Explain what remains unknown", audience: "Leaders", objective: "Trust", hookDirection: "Lead with the open question", expectedValue: "Nuance", effort: "medium", recommendedFormat: "carousel", recommendedChannel: "instagram", supportingClaimIds: ["claim-1"] },
  ], ...overrides };
}

describe("VS-04 Strategist orchestration", () => {
  it("creates multiple evidence-linked candidate Angles through a zero-tool bounded invocation", async () => {
    const runtime = new FakeRuntime(output());
    const sink = new FakeSink();
    const result = await new StrategistOrchestrator(runtime, sink).run(input);
    expect(result.angleCount).toBe(2);
    expect(runtime.lastRequest).toMatchObject({ role: "strategist", capabilities: [], budget: { maxToolCalls: 0, maxOutputTokens: 2500 } });
    expect(sink.saved[0]).toHaveLength(2);
    expect(sink.saved[0]?.every((angle) => angle.status === "candidate" && angle.version === 1)).toBe(true);
  });

  it("rejects candidate Angles that reference unknown Claims", async () => {
    const sink = new FakeSink();
    const invalid = output({ candidates: [{ ...output().candidates[0]!, supportingClaimIds: ["invented-claim"] }, output().candidates[1]!] });
    await expect(new StrategistOrchestrator(new FakeRuntime(invalid), sink).run(input)).rejects.toThrow(/unknown claim/i);
    expect(sink.saved).toHaveLength(0);
  });

  it("rejects a single framing when multiple Angles are appropriate", async () => {
    const sink = new FakeSink();
    await expect(new StrategistOrchestrator(new FakeRuntime(output({ candidates: [output().candidates[0]!] })), sink).run(input)).rejects.toThrow(/two candidate/i);
    expect(sink.saved).toHaveLength(0);
  });

  it("persists exactly two Angles when a provider returns extras", async () => {
    const sink = new FakeSink();
    const extra = { ...output().candidates[0]!, title: "Extra framing" };
    const result = await new StrategistOrchestrator(new FakeRuntime(output({ candidates: [...output().candidates, extra] })), sink).run(input);
    expect(result.angleCount).toBe(2);
    expect(sink.saved[0]).toHaveLength(2);
  });
});
