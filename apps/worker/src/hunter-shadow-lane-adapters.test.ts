import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  ToolGatewayPort,
  ToolRequest,
  ToolResult,
} from "@kairo/agent-contracts";
import type { BrandDiscoveryPlan } from "@kairo/domain/brand-discovery-plan";
import {
  ReadOnlyHunterShadowLaneExecutor,
  isHunterDeepAnalysisOutput,
  selectPaidShadowIntentIds,
  type HunterShadowExecutionContext,
} from "./hunter-shadow-lane-adapters";
import { runHunterShadowEvidencePair } from "./hunter-shadow-evidence-runner";

const fingerprint = createHash("sha256").update("same-input").digest("hex");

const run = {
  comparisonId: "shadow-real-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  inputFingerprint: fingerprint,
};

const discoveryPlan: BrandDiscoveryPlan = {
  schemaVersion: "1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  revision: 1,
  planVersion: "snapshot-1:discovery:1",
  snapshotVersion: "snapshot-1",
  state: "initial",
  topics: [
    {
      id: "agents",
      name: "AI agents",
      priority: "High",
      audience: "software teams",
      entities: ["AI agents"],
      sourceClasses: ["Industry news"],
    },
  ],
  excludedTopics: [],
  updatedAt: "2026-09-20T10:00:00Z",
};

const context: HunterShadowExecutionContext = {
  accountId: "account-1",
  referenceTime: "2026-09-20T10:00:00Z",
  discoveryPlan,
  hunterInput: {
    accountId: "account-1",
    brand: {
      workspaceId: "workspace-1",
      brandId: "brand-1",
      contextVersion: "snapshot-1|snapshot-1:discovery:1",
      brandName: "Example",
      audience: "software teams",
      goals: "Help software teams understand AI agents",
    },
    intelligenceProfile: {
      sector: "technology",
      geographies: [],
      languages: ["English"],
      audiences: ["software teams"],
      topics: ["AI agents"],
      excludedTopics: [],
      goals: ["education"],
      sourceClasses: ["Industry news"],
    },
    maxEvidence: 10,
    refreshSeed: "2026-09-20T10:00:00Z",
  },
};

const tools: ToolGatewayPort = {
  async invoke<TOutput>(request: ToolRequest): Promise<ToolResult<TOutput>> {
    if (request.capability === "public-content-search") {
      const query = String(request.input.query ?? "");
      const source = String(request.input.source ?? "agent-reach");
      const exploration = query.includes("adjacent emerging topics");
      return {
        output: [{
          title: exploration
            ? "Developer workflow governance shifts around autonomous tools"
            : "AI agents move into production workflows",
          summary: exploration
            ? "Teams are examining adjacent governance and workflow patterns around autonomous developer tooling."
            : "Teams are adopting agent workflows with stronger evaluation and observability.",
          sourceUrl: exploration
            ? "https://example.com/autonomous-workflow-governance"
            : "https://example.com/agents",
          platform: source === "rss" ? "rss" : "web",
          publisher: exploration ? "Adjacent Research" : "Example Research",
          publishedAt: "2026-09-20T08:00:00Z",
          retrievedAt: "2026-09-20T10:00:00Z",
          provider: source,
          providerVersion: "test",
          contentHash: (exploration ? "c" : "a").repeat(64),
        }] as TOutput,
        provenance: [],
      };
    }
    if (request.capability === "public-content-fetch") {
      return {
        output: {
          document: {
            canonicalUrl: "https://example.com/agents",
            platform: "web",
            title: "AI agents move into production workflows",
            description: "Teams are adopting agent workflows with stronger evaluation and observability.",
            body: "Production teams are introducing agent evaluation, observability and bounded execution.",
            retrievedAt: "2026-09-20T10:00:00Z",
            provider: "test-fetch",
            providerVersion: "1",
            contentHash: "sha256:" + "b".repeat(64),
          },
        } as TOutput,
        provenance: [],
      };
    }
    throw new Error("unexpected capability");
  },
};

const runtime: AgentRuntimePort = {
  async invoke<TOutput>(request: AgentInvocationRequest) {
    if (request.outputSchema.name === "hunter-opportunities") {
      return {
        output: {
          candidates: [{
            sourceUrl: "https://example.com/agents",
            title: "Agent observability becomes a production requirement",
            rationale: "It directly matches the Brand audience and source evidence.",
            whyNow: "Production adoption is increasing.",
            developmentDirection: "Explain the evaluation and observability stack.",
            topic: "AI agents",
            targetAudience: "software teams",
            scores: {
              relevance: 0.9,
              evidence: 0.85,
              novelty: 0.78,
              timeliness: 0.9,
              brandAuthority: 0.8,
              audienceFit: 0.9,
            },
          }],
        } as TOutput,
        metadata: {
          runtime: "test",
          provider: "test",
          model: "test",
          inputTokens: 100,
          outputTokens: 80,
          costUsd: 0.01,
          latencyMs: 10,
        },
      };
    }
    if (request.outputSchema.name === "hunter-deep-intelligence") {
      return {
        output: {
          version: "hunter-deep-v1",
          candidateId: String(request.task.context.candidateId),
          brandReason: "The topic directly matches the approved Brand discovery plan.",
          audienceReason: "Software teams need concrete production guidance.",
          whyNow: "The evidence is fresh and production-oriented.",
          contentGap: "Existing discussion lacks practical evaluation guidance.",
          proposedAngle: "A production checklist for agent evaluation and observability.",
          originality: 0.78,
          actionability: 0.86,
          confidence: 0.84,
        } as TOutput,
        metadata: {
          runtime: "test",
          provider: "test",
          model: "test",
          inputTokens: 90,
          outputTokens: 70,
          costUsd: 0.005,
          latencyMs: 8,
        },
      };
    }
    throw new Error("unexpected schema");
  },
};

describe("read-only Hunter shadow lane adapters", () => {
  it("runs the real production control path and certified V2 shadow pipeline without persistence authority", async () => {
    const executor = new ReadOnlyHunterShadowLaneExecutor({
      loadContext: async () => context,
      tools,
      runtime,
      searchCostUsdBySource: { "agent-reach": 0.007 },
      candidate: {
        maxIntents: 6,
        maxSourcesPerIntent: 2,
        maxPaidIntents: 3,
        maxExternalCalls: 6,
        maxSemanticCalls: 0,
        deepLimit: 2,
        maxCandidates: 5,
      },
    });

    const pair = await runHunterShadowEvidencePair(run, executor);

    expect(pair.pair.control.qualityScore).toBeGreaterThan(0.6);
    expect(pair.pair.candidate.qualityScore).toBeGreaterThan(0.5);
    expect(pair.observation.retrievalCoverage).toBeGreaterThan(0);
    expect(pair.observation.v2CostUsd).toBeGreaterThan(0);
    expect(pair.observation.v2CostUsd).toBeLessThanOrEqual(0.021 + 0.011);
    const trace = executor.traceFor(run.comparisonId);
    expect(trace).toBeDefined();
    expect(trace!.brandName).toBe("Example");
    expect(trace!.intents.filter((item) => item.paidAgentReach).length).toBeLessThanOrEqual(3);
    expect(trace!.selected.length).toBeGreaterThan(0);
    expect(trace!.selected.some((item) => item.bucket === "exploration")).toBe(true);
    expect(pair.observation.explorationShare).toBeGreaterThan(0);
    expect(pair.pair.candidate.persistenceAttempted).toBe(false);
    expect(pair.pair.candidate.productionGuardIntact).toBe(true);
    expect(pair.pair.candidate.provenanceComplete).toBe(true);
    expect(pair.observation.criticalViolations).toBeUndefined();
  });

  it("rejects a context whose tenant scope differs from the requested shadow case before execution", async () => {
    const executor = new ReadOnlyHunterShadowLaneExecutor({
      loadContext: async () => ({
        ...context,
        hunterInput: {
          ...context.hunterInput,
          brand: { ...context.hunterInput.brand, brandId: "other-brand" },
        },
      }),
      tools,
      runtime,
      searchCostUsdBySource: { "agent-reach": 0 },
    });

    await expect(executor.runControl(run)).rejects.toThrow(/workspace and Brand/);
  });

  it("selects at most three deterministic paid intents and always reserves lexical exploration", () => {
    const plan = {
      schemaVersion: "1" as const,
      workspaceId: "workspace-1",
      brandId: "brand-1",
      snapshotVersion: "snapshot-1",
      planVersion: "plan-1",
      explorationBudget: 0.1,
      intents: [
        { id:"core-a",generator:"brand-core",mode:"lexical-search",topicId:"a",topicName:"A",query:"A",semanticQuery:"A",audience:"x",sourceClasses:["Official sources"],priority:"high",maxResults:5,reason:"core" },
        { id:"rise-a",generator:"rising-breaking",mode:"lexical-search",topicId:"a",topicName:"A",query:"A latest",semanticQuery:"A latest",audience:"x",sourceClasses:["Industry news"],priority:"high",maxResults:5,reason:"rise" },
        { id:"core-b",generator:"brand-core",mode:"lexical-search",topicId:"b",topicName:"B",query:"B",semanticQuery:"B",audience:"y",sourceClasses:["Official sources"],priority:"high",maxResults:5,reason:"core" },
        { id:"explore-a",generator:"adjacent-exploration",mode:"lexical-search",topicId:"a",topicName:"A",query:"A adjacent",semanticQuery:"A adjacent",audience:"x",sourceClasses:["Industry news"],priority:"exploration",maxResults:5,reason:"explore" },
      ],
      hardNegatives: [],
    } satisfies import("@kairo/domain/hunter-retrieval").HunterRetrievalPlan;

    const selected = selectPaidShadowIntentIds(plan, 3);
    expect(selected).toHaveLength(3);
    expect(selected).toContain("explore-a");
    expect(selected).toContain("core-b");
    expect(selectPaidShadowIntentIds(plan, 3)).toEqual(selected);
  });

  it("validates deep-analysis outputs through the certified domain contract", () => {
    expect(isHunterDeepAnalysisOutput({
      version: "hunter-deep-v1",
      candidateId: "candidate-1",
      brandReason: "Relevant",
      audienceReason: "Useful",
      whyNow: "Timely",
      contentGap: "Gap",
      proposedAngle: "Angle",
      originality: 0.8,
      actionability: 0.8,
      confidence: 0.8,
    })).toBe(true);

    expect(isHunterDeepAnalysisOutput({
      version: "hunter-deep-v1",
      candidateId: "candidate-1",
      originality: 3,
    })).toBe(false);
  });
});
