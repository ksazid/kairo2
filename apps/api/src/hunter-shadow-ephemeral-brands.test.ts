import { describe, expect, it } from "vitest";
import type {
  AgentInvocationRequest,
  AgentRuntimePort,
} from "@kairo/agent-contracts";
import type {
  PublicBrandReference,
  PublicBrandReferenceReader,
} from "@kairo/domain/brand-brain-bootstrap";
import {
  buildEphemeralPublicBrandContexts,
  type EphemeralPublicBrandFixture,
} from "./hunter-shadow-ephemeral-brands";

const fixtures: readonly EphemeralPublicBrandFixture[] = [{
  id: "fixture-1",
  brandName: "Fixture AI",
  referenceUrls: [
    "https://example.com/",
    "https://example.com/policy",
  ],
}];

const reader: PublicBrandReferenceReader = {
  async read(url): Promise<PublicBrandReference> {
    return {
      url,
      title: url.endsWith("/policy") ? "Usage Policy" : "Fixture AI",
      excerpt: url.endsWith("/policy")
        ? "Users must avoid harmful, illegal, deceptive and unsafe uses."
        : "Fixture AI builds AI software for developers and teams, with APIs and agent tools.",
      retrievedAt: "2026-09-20T10:00:00Z",
    };
  },
};

const runtime: AgentRuntimePort = {
  async invoke<TOutput>(request: AgentInvocationRequest) {
    const references = request.task.context.references as Array<{ sourceId: string }>;
    const source = references[0]!.sourceId;
    const policy = references[1]!.sourceId;
    return {
      output: {
        proposals: [
          {
            section: "identity",
            fieldKey: "identity.description",
            value: "AI software company building developer tools.",
            sourceIds: [source],
          },
          {
            section: "identity",
            fieldKey: "identity.sector",
            value: "AI / SaaS / Developer Technology",
            sourceIds: [source],
          },
          {
            section: "identity",
            fieldKey: "identity.products-services",
            value: "AI APIs and agent tools",
            sourceIds: [source],
          },
          {
            section: "audience",
            fieldKey: "audience.primary",
            value: "Developers and software teams",
            sourceIds: [source],
          },
          {
            section: "positioning",
            fieldKey: "positioning.value-proposition",
            value: "Build useful AI software with APIs and agent tooling.",
            sourceIds: [source],
          },
          {
            section: "content-strategy",
            fieldKey: "content.core-topics",
            value: "AI agents, developer tools, AI software",
            sourceIds: [source],
          },
          {
            section: "boundaries",
            fieldKey: "boundaries.excluded-topics",
            value: "Harmful, illegal, deceptive and unsafe uses",
            sourceIds: [policy],
          },
        ],
      } as TOutput,
      metadata: {
        runtime: "test",
        provider: "test",
        model: "test",
        inputTokens: 100,
        outputTokens: 100,
        costUsd: 0.01,
        latencyMs: 10,
      },
    };
  },
};

describe("ephemeral public Hunter shadow Brand contexts", () => {
  it("builds a real-source-only context that passes the unchanged Hunter readiness gate", async () => {
    const contexts = await buildEphemeralPublicBrandContexts({
      runtime,
      limit: 1,
      fixtures,
      reader,
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.context.discoveryPlan.topics.length).toBeGreaterThan(0);
    expect(contexts[0]!.context.hunterInput.brand.brandName).toBe("Fixture AI");
    const profile = contexts[0]!.context.hunterInput.intelligenceProfile;
    expect(profile).toBeDefined();
    expect(profile!.excludedTopics).toContain("Harmful");
  });

  it("fails instead of overriding readiness when public evidence leaves a required group weak", async () => {
    const weakRuntime: AgentRuntimePort = {
      async invoke<TOutput>(request: AgentInvocationRequest) {
        const result = await runtime.invoke<{ proposals: Array<Record<string, unknown>> }>(request);
        return {
          ...result,
          output: {
            proposals: result.output.proposals.filter(
              (item) => item.fieldKey !== "boundaries.excluded-topics",
            ),
          } as TOutput,
        };
      },
    };

    await expect(buildEphemeralPublicBrandContexts({
      runtime: weakRuntime,
      limit: 1,
      fixtures,
      reader,
    })).rejects.toThrow(/did not satisfy canonical Hunter readiness/);
  });
});
