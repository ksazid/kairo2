import { randomUUID } from "node:crypto";
import { prepareAgentInvocation, type AgentRuntimePort } from "@kairo/agent-contracts";
import { appendContentVersion, type ContentAction, type ContentAsset, type ContentVersion } from "@kairo/domain/campaign";
import { resolveChannelContentProfile, validateChannelContent } from "./content-channel-adapters";

export interface DrafterOutput {
  content: string;
  supportingClaimIds: string[];
}

export interface DrafterInput {
  workspaceId: string;
  brandId: string;
  brandContextVersion: string;
  campaign: { id: string; name: string; objective: string };
  asset: ContentAsset;
  parent: ContentVersion;
  action: Exclude<ContentAction, "manual-edit">;
  section?: string;
  claims: Array<{ id: string; text: string; classification: string; verificationState: string }>;
  brandBrain?: Array<{ fieldKey: string; value: string; state: string }>;
}

export class DrafterOrchestrator {
  constructor(private readonly runtime: AgentRuntimePort) {}

  async run(input: DrafterInput): Promise<ContentVersion> {
    if (
      input.asset.workspaceId !== input.workspaceId ||
      input.asset.brandId !== input.brandId ||
      input.parent.assetId !== input.asset.id
    ) {
      throw new Error("Content scope mismatch");
    }

    const channelProfile = resolveChannelContentProfile(input.asset.channel, input.asset.format);
    const request = prepareAgentInvocation({
      role: "drafter",
      scope: { visibility: "brand-private", workspaceId: input.workspaceId, brandId: input.brandId },
      approvedContextVersion: input.brandContextVersion,
      capabilities: [],
      task: {
        instruction:
          "Produce only the requested bounded draft revision. Supplied Claims are authoritative context; cite only their IDs. Obey the supplied channelProfile requirements. Do not invent evidence, results, first-person experience, policy, tools or approval state.",
        context: {
          campaign: input.campaign,
          asset: {
            channel: input.asset.channel,
            format: input.asset.format,
            audience: input.asset.audience,
            topic: input.asset.topic,
            hookType: input.asset.hookType,
            cta: input.asset.cta,
          },
          channelProfile,
          parent: { content: input.parent.content, supportingClaimIds: input.parent.supportingClaimIds },
          action: input.action,
          ...(input.section ? { section: input.section } : {}),
          claims: input.claims,
          ...(input.brandBrain?.length ? { brandBrain: input.brandBrain.filter((field) => field.state !== "stale") } : {}),
        },
      },
      outputSchema: { name: "content-draft", version: "1" },
      budget: { maxOutputTokens: 3000, maxToolCalls: 0, maxCostUsd: 0.15, timeoutMs: 45000 },
    });

    const result = await this.runtime.invoke<DrafterOutput>(request);
    if (!valid(result.output)) throw new Error("Drafter output failed schema validation");

    const known = new Set(input.claims.map((claim) => claim.id));
    if (result.output.supportingClaimIds.some((id) => !known.has(id))) {
      throw new Error("Drafter references an unknown Claim");
    }

    validateChannelContent(channelProfile, result.output.content);

    return appendContentVersion({
      id: randomUUID(),
      asset: input.asset,
      parent: input.parent,
      expectedVersion: input.asset.currentVersion,
      content: result.output.content,
      supportingClaimIds: [...new Set(result.output.supportingClaimIds)],
      actor: "ai",
      action: input.action,
      createdAt: new Date().toISOString(),
      provenance: {
        runtime: result.metadata.runtime,
        ...(result.metadata.provider ? { provider: result.metadata.provider } : {}),
        ...(result.metadata.model ? { model: result.metadata.model } : {}),
        ...(result.metadata.inputTokens !== undefined ? { inputTokens: result.metadata.inputTokens } : {}),
        ...(result.metadata.outputTokens !== undefined ? { outputTokens: result.metadata.outputTokens } : {}),
        ...(result.metadata.costUsd !== undefined ? { costUsd: result.metadata.costUsd } : {}),
        latencyMs: result.metadata.latencyMs,
      },
    });
  }
}

function valid(value: unknown): value is DrafterOutput {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as DrafterOutput).content === "string" &&
    (value as DrafterOutput).content.trim().length > 0 &&
    Array.isArray((value as DrafterOutput).supportingClaimIds) &&
    (value as DrafterOutput).supportingClaimIds.every((id) => typeof id === "string" && id.length > 0)
  );
}
