import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort, AgentRuntimeResult } from "@kairo/agent-contracts";
import { CriticOrchestrator, JudgeOrchestrator } from "./reviewer";

class Runtime implements AgentRuntimePort {
  last: AgentInvocationRequest | null = null;
  constructor(private readonly output: unknown) {}
  async invoke<T>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<T>> {
    this.last = request;
    return { output: this.output as T, metadata: { runtime: "fixture", provider: "fixture", model: "review-1", latencyMs: 3 } };
  }
}

const base = { workspaceId: "ws-1", brandId: "brand-1", brandContextVersion: "brand-1@2" };

describe("VS-06 independent Critic and Judge", () => {
  it("Critic receives bounded visible evidence, no hidden Drafter reasoning and no tools", async () => {
    const runtime = new Runtime({ passed: false, score: 72, findings: [{ code: "weak-hook", severity: "revision", message: "Opening lacks specificity" }] });
    const result = await new CriticOrchestrator(runtime).run({ ...base, version: { id: "v2", content: "A measured draft", supportingClaimIds: ["c1"] }, claims: [{ id: "c1", text: "Supported evidence" }], rubric: ["brand-fit", "clarity", "usefulness"] });
    expect(runtime.last).toMatchObject({ role: "critic", capabilities: [], budget: { maxToolCalls: 0 } });
    expect(JSON.stringify(runtime.last?.task.context)).not.toMatch(/reasoning|chain.of.thought|scratchpad/i);
    expect(result).toMatchObject({ passed: false, score: 72, provenance: { model: "review-1" } });
  });

  it("rejects malformed Critic output before application persistence", async () => {
    await expect(new CriticOrchestrator(new Runtime({ passed: true, score: 120, findings: [] })).run({ ...base, version: { id: "v2", content: "Draft", supportingClaimIds: [] }, claims: [], rubric: ["clarity"] })).rejects.toThrow(/critic output/i);
  });

  it("Judge selects only one supplied truth-valid candidate with zero tools", async () => {
    const runtime = new Runtime({ selectedVersionId: "v2", rationale: "Clearer and better grounded" });
    const result = await new JudgeOrchestrator(runtime).run({ ...base, candidates: [{ versionId: "v1", content: "One", criticScore: 80 }, { versionId: "v2", content: "Two", criticScore: 88 }] });
    expect(runtime.last).toMatchObject({ role: "judge", capabilities: [], budget: { maxToolCalls: 0 } });
    expect(result.selectedVersionId).toBe("v2");
    await expect(new JudgeOrchestrator(new Runtime({ selectedVersionId: "invented", rationale: "No" })).run({ ...base, candidates: [{ versionId: "v2", content: "Two", criticScore: 88 }] })).rejects.toThrow(/supplied candidate/i);
  });
});
