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
  anchorShadowRetrievalPlanToBrand,
  balancedShadowRetrievalPlan,
  brandIdentityFit,
  isHunterDeepAnalysisOutput,
  isRateLimitedControlDegradation,
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
        maxIntents: 2,
        maxSourcesPerIntent: 2,
        maxPaidIntents: 2,
        maxExternalCalls: 2,
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
    expect(pair.observation.v2CostUsd).toBeLessThanOrEqual(0.014 + 0.011);
    const trace = executor.traceFor(run.comparisonId);
    expect(trace).toBeDefined();
    expect(trace!.brandName).toBe("Example");
    expect(trace!.intents.filter((item) => item.paidAgentReach).length).toBeLessThanOrEqual(2);
    expect(trace!.selected.length).toBeGreaterThan(0);
    expect(trace!.selected.some((item) => item.bucket === "exploration")).toBe(true);
    expect(pair.observation.explorationShare).toBeGreaterThan(0);
    expect(pair.pair.candidate.persistenceAttempted).toBe(false);
    expect(pair.pair.candidate.productionGuardIntact).toBe(true);
    expect(pair.pair.candidate.provenanceComplete).toBe(true);
    expect(pair.observation.criticalViolations).toBeUndefined();
  });

  it("retries a rate-limited V1 control once and keeps retry latency/cost inside measured control evidence", async () => {
    let modelAttempts = 0;
    const sleeps: number[] = [];
    const retryRuntime: AgentRuntimePort = {
      async invoke<TOutput>(request: AgentInvocationRequest) {
        if (request.outputSchema.name !== "hunter-opportunities") {
          return runtime.invoke<TOutput>(request);
        }
        modelAttempts += 1;
        if (modelAttempts === 1) {
          throw { kind: "rate-limited", statusCode: 429 };
        }
        return runtime.invoke<TOutput>(request);
      },
    };
    const executor = new ReadOnlyHunterShadowLaneExecutor({
      loadContext: async () => context,
      tools,
      runtime: retryRuntime,
      searchCostUsdBySource: { "agent-reach": 0.007 },
      controlRetry: {
        maxAttempts: 2,
        delayMs: 25,
        sleep: async (ms) => { sleeps.push(ms); },
      },
    });

    const control = await executor.runControl(run);
    expect(modelAttempts).toBe(2);
    expect(sleeps).toEqual([25]);
    expect(control.criticalDependencyDegraded).toBe(false);
    expect(control.criticalDependencyFailures).toEqual([]);
    expect(control.modelInvocationCount).toBe(1);
    expect(control.metadata.costUsd).toBeGreaterThan(0.01);
    expect(control.metadata.latencyMs).toBeGreaterThan(0);
  });

  it("does not retry non-rate-limit control degradation", async () => {
    let modelAttempts = 0;
    const sleeps: number[] = [];
    const brokenRuntime: AgentRuntimePort = {
      async invoke<TOutput>(request: AgentInvocationRequest) {
        if (request.outputSchema.name !== "hunter-opportunities") {
          return runtime.invoke<TOutput>(request);
        }
        modelAttempts += 1;
        throw { kind: "invalid-response", statusCode: 400 };
      },
    };
    const executor = new ReadOnlyHunterShadowLaneExecutor({
      loadContext: async () => context,
      tools,
      runtime: brokenRuntime,
      searchCostUsdBySource: { "agent-reach": 0.007 },
      controlRetry: {
        maxAttempts: 2,
        delayMs: 25,
        sleep: async (ms) => { sleeps.push(ms); },
      },
    });

    const control = await executor.runControl(run);
    expect(modelAttempts).toBe(1);
    expect(sleeps).toEqual([]);
    expect(control.criticalDependencyDegraded).toBe(true);
    expect(control.criticalDependencyFailures).toEqual([
      { phase: "judgment", source: "hunter-model", kind: "invalid-response", statusCode: 400 },
    ]);
  });

  it("classifies only all-rate-limited critical failures as retryable", () => {
    expect(isRateLimitedControlDegradation(true, [
      { phase: "judgment", source: "hunter-model", kind: "rate-limited", statusCode: 429 },
    ])).toBe(true);
    expect(isRateLimitedControlDegradation(true, [
      { phase: "discovery", source: "github", kind: "rate-limited" },
      { phase: "judgment", source: "hunter-model", kind: "invalid-response" },
    ])).toBe(false);
    expect(isRateLimitedControlDegradation(false, [])).toBe(false);
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

  it("anchors shadow search queries to Brand identity without changing intent identity", () => {
    const plan = {
      schemaVersion: "1" as const,
      workspaceId: "workspace-1",
      brandId: "brand-1",
      snapshotVersion: "snapshot-1",
      planVersion: "plan-brand-anchor",
      explorationBudget: 0.1,
      intents: [{
        id: "core-agents",
        generator: "brand-core" as const,
        mode: "lexical-search" as const,
        topicId: "agents",
        topicName: "AI agents",
        query: "AI agents software teams",
        semanticQuery: "AI agents production",
        audience: "software teams",
        sourceClasses: ["Industry news"],
        priority: "high" as const,
        maxResults: 5,
        reason: "core",
      }],
      hardNegatives: [],
    };

    const anchored = anchorShadowRetrievalPlanToBrand(plan, "Example Labs");
    expect(anchored.intents[0]!.id).toBe("core-agents");
    expect(anchored.intents[0]!.query).toContain("Example Labs");
    expect(anchored.intents[0]!.semanticQuery).toContain("Example Labs");
    expect(anchorShadowRetrievalPlanToBrand(anchored, "Example Labs")).toEqual(anchored);
    expect(brandIdentityFit("Example Labs launches agent tooling", "Example Labs")).toBe(1);
    expect(brandIdentityFit("Generic agent tooling", "Example Labs")).toBe(0);
  });

  it("builds a rotating three-topic plan with a distinct exploration topic", () => {
    const topics = ["a", "b", "c", "d"];
    const plan = {
      schemaVersion: "1" as const,
      workspaceId: "workspace-1",
      brandId: "brand-1",
      snapshotVersion: "snapshot-1",
      planVersion: "plan-rotation",
      explorationBudget: 0.1,
      intents: topics.flatMap((topicId) => [
        { id:"core-"+topicId,generator:"brand-core",mode:"lexical-search",topicId,topicName:topicId.toUpperCase(),query:topicId,semanticQuery:topicId,audience:"audience",sourceClasses:["Official sources"],priority:"high",maxResults:5,reason:"core" },
        { id:"explore-"+topicId,generator:"adjacent-exploration",mode:"lexical-search",topicId,topicName:topicId.toUpperCase(),query:topicId+" adjacent",semanticQuery:topicId+" adjacent",audience:"audience",sourceClasses:["Industry news"],priority:"exploration",maxResults:5,reason:"explore" },
      ]),
      hardNegatives: [],
    } satisfies import("@kairo/domain/hunter-retrieval").HunterRetrievalPlan;

    const first = balancedShadowRetrievalPlan(plan, 3, "comparison-1");
    const second = balancedShadowRetrievalPlan(plan, 3, "comparison-2");

    expect(first.intents).toHaveLength(3);
    expect(new Set(first.intents.map((intent) => intent.topicId)).size).toBe(3);
    expect(first.intents.filter((intent) => intent.generator === "adjacent-exploration")).toHaveLength(1);
    expect(second.intents).toHaveLength(3);
    expect(new Set(second.intents.map((intent) => intent.topicId)).size).toBe(3);
    expect(first.intents.map((intent) => intent.topicId)).not.toEqual(
      second.intents.map((intent) => intent.topicId),
    );
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
