import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort, AgentRuntimeResult } from "@kairo/agent-contracts";
import type { ContentAsset, ContentVersion } from "@kairo/domain/campaign";
import { DrafterOrchestrator } from "./drafter";

class Runtime implements AgentRuntimePort {
  last: AgentInvocationRequest | null = null;
  constructor(private output: unknown) {}

  async invoke<T>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<T>> {
    this.last = request;
    return {
      output: this.output as T,
      metadata: {
        runtime: "fixture",
        provider: "fixture",
        model: "draft-1",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.01,
        latencyMs: 2,
      },
    };
  }
}

const asset: ContentAsset = {
  id: "asset-1",
  workspaceId: "ws-1",
  brandId: "brand-1",
  campaignId: "campaign-1",
  channel: "linkedin",
  format: "text",
  audience: "Founders",
  topic: "Evidence",
  hookType: "data-led",
  cta: "Read",
  supportingClaimIds: ["claim-1"],
  currentVersion: 1,
  status: "draft",
  createdAt: "2026-08-13T10:00:00Z",
};

const parent: ContentVersion = {
  id: "version-1",
  workspaceId: "ws-1",
  brandId: "brand-1",
  campaignId: "campaign-1",
  assetId: "asset-1",
  version: 1,
  parentVersionId: null,
  content: "Original",
  supportingClaimIds: ["claim-1"],
  actor: "user",
  action: "manual-edit",
  createdAt: "2026-08-13T10:00:00Z",
};

const input = {
  workspaceId: "ws-1",
  brandId: "brand-1",
  brandContextVersion: "brand-1@1",
  campaign: { id: "campaign-1", name: "Campaign", objective: "Educate" },
  asset,
  parent,
  action: "simplify" as const,
  claims: [{ id: "claim-1", text: "Supported", classification: "fact", verificationState: "supported" }],
};

describe("Drafter", () => {
  it("creates a provenance-linked zero-tool draft version with LinkedIn profile context", async () => {
    const runtime = new Runtime({ content: "Simpler", supportingClaimIds: ["claim-1"] });
    const version = await new DrafterOrchestrator(runtime).run(input);

    expect(runtime.last).toMatchObject({ role: "drafter", capabilities: [], budget: { maxToolCalls: 0 } });
    expect(runtime.last?.task.context).toMatchObject({
      channelProfile: {
        channel: "linkedin",
        format: "text",
        contentMode: "text-first",
        hardLimits: { maxCharacters: 3000 },
      },
    });
    expect(version).toMatchObject({
      version: 2,
      parentVersionId: "version-1",
      actor: "ai",
      action: "simplify",
      provenance: { provider: "fixture", model: "draft-1" },
    });
  });

  it("injects an Instagram carousel profile for an Instagram execution", async () => {
    const runtime = new Runtime({ content: "Save this checklist.", supportingClaimIds: ["claim-1"] });
    await new DrafterOrchestrator(runtime).run({
      ...input,
      asset: { ...asset, channel: "instagram", format: "carousel" },
    });

    expect(runtime.last?.task.context).toMatchObject({
      channelProfile: {
        channel: "instagram",
        format: "carousel",
        contentMode: "visual-caption",
        hardLimits: { maxCharacters: 2200 },
        presentation: { visualPrimary: true, videoPrimary: false },
      },
    });
  });

  it("rejects invented Claim references before persistence", async () => {
    await expect(
      new DrafterOrchestrator(new Runtime({ content: "Invented", supportingClaimIds: ["unknown"] })).run(input),
    ).rejects.toThrow(/unknown claim/i);
  });

  it("rejects over-limit channel output instead of truncating it", async () => {
    const content = "x".repeat(3001);
    await expect(
      new DrafterOrchestrator(new Runtime({ content, supportingClaimIds: ["claim-1"] })).run(input),
    ).rejects.toThrow(/LinkedIn content exceeds 3000 characters/i);
  });
});
