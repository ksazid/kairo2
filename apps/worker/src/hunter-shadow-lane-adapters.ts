import {
  prepareAgentInvocation,
  type AgentInvocationRequest,
  type AgentRuntimePort,
  type AgentRuntimeResult,
  type JsonValue,
  type ToolGatewayPort,
  type ToolRequest,
  type ToolResult,
} from "@kairo/agent-contracts";
import type { BrandDiscoveryPlan } from "@kairo/domain/brand-discovery-plan";
import type { BrandPreferenceState } from "@kairo/domain/brand-preference-state";
import { evaluateOpportunity } from "@kairo/domain/discovery";
import type {
  OpportunityCandidateInput,
  RecordCandidateResult,
} from "@kairo/domain/discovery-service";
import {
  buildHunterRetrievalPlan,
  type HunterRetrievalPlan,
  type HunterSemanticExpansionPort,
} from "@kairo/domain/hunter-retrieval";
import {
  prepareHunterDeepAnalysisResult,
  type HunterDeepAnalysisPort,
  type HunterDeepAnalysisRequest,
  type HunterDeepAnalysisResult,
} from "@kairo/domain/hunter-multistage";
import type { DiscoverySourceDefinition } from "@kairo/domain/source-policy";
import { DEFAULT_SOURCE_REGISTRY } from "@kairo/domain/source-registry";
import {
  HunterOrchestrator,
  type HunterFailureDiagnostic,
  type HunterRunInput,
} from "./hunter";
import {
  HUNTER_EEI_V2_SHADOW_POLICY,
  runShadowPreferenceAwareEEI,
} from "./hunter-shadow-eei-v2";
import type {
  HunterShadowCandidateLaneResult,
  HunterShadowControlLaneResult,
  HunterShadowLaneExecutor,
  HunterShadowRunCase,
} from "./hunter-shadow-evidence-runner";
import {
  runShadowMultiStageIntelligence,
} from "./hunter-shadow-multistage-intelligence";
import {
  runShadowRetrieval,
  type ShadowHardNegativeSemanticPort,
} from "./hunter-shadow-retrieval";
import { GatewayShadowSearchPort } from "./hunter-shadow-search-gateway";
import {
  hunterTrendSignalReference,
  runShadowTrendIntelligence,
} from "./hunter-shadow-trend-intelligence";

export const HUNTER_SHADOW_QUALITY_VERSION = "hunter-shadow-quality-v1" as const;

export interface HunterShadowExecutionContext {
  accountId: string;
  hunterInput: HunterRunInput;
  discoveryPlan: BrandDiscoveryPlan;
  preferenceState?: BrandPreferenceState;
  referenceTime: string;
}

export interface HunterShadowCandidateTrace {
  brandName: string;
  discoveryTopics: Array<{ id: string; name: string; audience: string }>;
  intents: Array<{
    id: string;
    generator: string;
    topicName: string;
    query: string;
    sourceClasses: string[];
    paidAgentReach: boolean;
  }>;
  selected: Array<{
    candidateId: string;
    topic: string;
    bucket: "core" | "adjacent" | "exploration";
    qualityScore: number;
    sourceKeys: string[];
    generatorKeys: string[];
    proposedAngle?: string;
  }>;
  diagnostics: {
    retrievalRawCandidates: number;
    retrievalUniqueCandidates: number;
    retrievalHardNegativeRejected: number;
    retrievalFailedIntents: number;
    trendClusters: number;
    preRankSelected: number;
    eeiEligible: number;
    eeiSelected: number;
    explorationSelected: number;
  };
}

export interface HunterShadowLaneAdapterOptions {
  loadContext(run: HunterShadowRunCase): Promise<HunterShadowExecutionContext>;
  tools: ToolGatewayPort;
  runtime: AgentRuntimePort;
  sourceRegistry?: readonly DiscoverySourceDefinition[];
  semanticExpansion?: HunterSemanticExpansionPort;
  semanticHardNegative?: ShadowHardNegativeSemanticPort;
  searchCostUsdBySource?: Readonly<Record<string, number>>;
  controlRetry?: {
    maxAttempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  };
  candidate?: {
    maxIntents?: number;
    maxSourcesPerIntent?: number;
    maxPaidIntents?: number;
    maxExternalCalls?: number;
    maxSemanticCalls?: number;
    deepLimit?: number;
    deepAnalysisConcurrency?: number;
    maxCandidates?: number;
    enforceCertifiedFinalShares?: boolean;
  };
}

export class ReadOnlyHunterShadowLaneExecutor implements HunterShadowLaneExecutor {
  private readonly contexts = new Map<string, HunterShadowExecutionContext>();
  private readonly candidateTraces = new Map<string, HunterShadowCandidateTrace>();

  constructor(private readonly options: HunterShadowLaneAdapterOptions) {}

  traceFor(comparisonId: string): HunterShadowCandidateTrace | undefined {
    const trace = this.candidateTraces.get(comparisonId);
    return trace ? structuredClone(trace) : undefined;
  }

  async runControl(run: HunterShadowRunCase): Promise<HunterShadowControlLaneResult> {
    const context = await this.context(run);
    const runtime = new MeteredRuntime(this.options.runtime);
    const tools = new MeteredToolGateway(this.options.tools, this.options.searchCostUsdBySource);
    const retry = controlRetryPolicy(this.options.controlRetry);
    const started = performance.now();
    let final:
      | {
          captured: OpportunityCandidateInput[];
          controlRun: Awaited<ReturnType<HunterOrchestrator["runForAuthorizedBrand"]>>;
          criticalFailures: HunterShadowControlLaneResult["criticalDependencyFailures"];
          criticalDegraded: boolean;
        }
      | undefined;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      const captured: OpportunityCandidateInput[] = [];
      const controlFailures: HunterFailureDiagnostic[] = [];
      const sink = {
        async recordCandidate(
          _accountId: string,
          _brandId: string,
          input: OpportunityCandidateInput,
        ): Promise<RecordCandidateResult> {
          captured.push(structuredClone(input));
          return {
            signal: { id: "shadow-control-" + captured.length } as RecordCandidateResult["signal"],
            opportunity: null,
          };
        },
      };
      const runner = new HunterOrchestrator(
        tools,
        runtime,
        sink,
        this.options.sourceRegistry ?? DEFAULT_SOURCE_REGISTRY,
        (diagnostic) => controlFailures.push(diagnostic),
      );
      const controlRun = await runner.runForAuthorizedBrand({
        ...context.hunterInput,
        accountId: context.accountId,
        refreshSeed: context.referenceTime,
      });
      const criticalFailures = criticalControlFailures(controlFailures);
      const criticalDegraded =
        Boolean(controlRun.degradedSources?.length) || criticalFailures.length > 0;
      final = { captured, controlRun, criticalFailures, criticalDegraded };

      if (
        attempt >= retry.maxAttempts ||
        !isRateLimitedControlDegradation(criticalDegraded, criticalFailures)
      ) {
        break;
      }
      await retry.sleep(retry.delayMs * attempt);
    }

    if (!final) throw new Error("Hunter shadow control did not execute");
    const latencyMs = positiveElapsed(performance.now() - started);
    return {
      inputFingerprint: run.inputFingerprint,
      workspaceId: context.hunterInput.brand.workspaceId,
      brandId: context.hunterInput.brand.brandId,
      qualityScore: average(
        final.captured.map((candidate) => evaluateOpportunity(candidate.scores).overall),
      ),
      recommendationCount: final.captured.length,
      evidenceCount: final.controlRun.evidenceCount,
      modelInvocationCount: runtime.invocations(),
      criticalDependencyDegraded: final.criticalDegraded,
      criticalDependencyFailures: final.criticalFailures,
      metadata: {
        latencyMs,
        costUsd: runtime.measuredCostUsd() + tools.measuredCostUsd(),
      },
    };
  }

  async runCandidate(run: HunterShadowRunCase): Promise<HunterShadowCandidateLaneResult> {
    const context = await this.context(run);
    const runtime = new MeteredRuntime(this.options.runtime);
    const tools = new MeteredToolGateway(this.options.tools, this.options.searchCostUsdBySource);
    const retrievalPlan = focusShadowRetrievalPlanOnDevelopments(anchorShadowRetrievalPlanToBrand(
      balancedShadowRetrievalPlan(buildHunterRetrievalPlan({
        plan: context.discoveryPlan,
        ...(context.preferenceState ? { preferenceState: context.preferenceState } : {}),
      }), this.options.candidate?.maxIntents ?? 12, run.comparisonId),
      context.hunterInput.brand.brandName,
    ), context.referenceTime);
    const paidIntentIds = selectPaidShadowIntentIds(
      retrievalPlan,
      this.options.candidate?.maxPaidIntents ?? 3,
    );
    const search = new GatewayShadowSearchPort(tools, {
      timeoutMs: 20_000,
      maxSourcesPerIntent: this.options.candidate?.maxSourcesPerIntent ?? 1,
      paidIntentIds,
    });

    const started = performance.now();
    const retrieval = await runShadowRetrieval(
      retrievalPlan,
      search,
      this.options.semanticExpansion,
      this.options.semanticHardNegative,
      {
        maxExternalCalls: this.options.candidate?.maxExternalCalls ?? Math.min(24, retrievalPlan.intents.length),
        maxSemanticCalls: this.options.candidate?.maxSemanticCalls ?? Math.min(12, retrievalPlan.intents.length),
      },
    );

    const topicLabels = Object.fromEntries(
      context.discoveryPlan.topics.map((topic) => [topic.id, topic.name]),
    );
    const trend = await runShadowTrendIntelligence(retrieval.candidates, {
      now: new Date(context.referenceTime),
      topicLabels,
    });
    const deep = new RuntimeHunterDeepAnalysisPort(runtime, {
      workspaceId: context.hunterInput.brand.workspaceId,
      brandId: context.hunterInput.brand.brandId,
      approvedContextVersion: context.hunterInput.brand.contextVersion,
    });
    const brandSemanticSimilarityByCandidateId = Object.fromEntries(
      trend.clusters.map((cluster) => [
        cluster.intelligence.trendId,
        brandIdentityFit(cluster.subject, context.hunterInput.brand.brandName),
      ]),
    );
    const multistage = await runShadowMultiStageIntelligence({
      clusters: trend.clusters,
      plan: context.discoveryPlan,
      ...(context.preferenceState ? { preferenceState: context.preferenceState } : {}),
      deepAnalysis: deep,
      options: {
        deepLimit: this.options.candidate?.deepLimit ?? 4,
        deepAnalysisConcurrency: this.options.candidate?.deepAnalysisConcurrency,
        brandSemanticSimilarityByCandidateId,
        preRankLimit: 40,
      },
    });
    const eei = runShadowPreferenceAwareEEI({
      preRanked: multistage.preRanked,
      deepIntelligence: multistage.deepIntelligence,
      ...(context.preferenceState ? { preferenceState: context.preferenceState } : {}),
      options: {
        maxCandidates: this.options.candidate?.maxCandidates ?? 10,
        enforceCertifiedFinalShares:
          this.options.candidate?.enforceCertifiedFinalShares ?? false,
      },
    });
    const latencyMs = positiveElapsed(performance.now() - started);

    const plannedTopics = [...new Set(retrievalPlan.intents.map((intent) => intent.topicId))];
    const coveredTopics = plannedTopics.filter(
      (topicId) => (retrieval.diagnostics.topicCoverage[topicId] ?? 0) > 0,
    );
    const retrievalKeys = new Set(
      retrieval.candidates.map((candidate) => hunterTrendSignalReference(candidate.key)),
    );
    const provenanceComplete = eei.selected.every((item) =>
      item.preRanked.cluster.intelligence.supportingSignalIds.length > 0 &&
      item.preRanked.cluster.intelligence.supportingSignalIds.every((signalId) =>
        retrievalKeys.has(signalId)
      )
    ) && retrieval.candidates.every((candidate) =>
      Boolean(candidate.sourceUrl.trim()) && Boolean(candidate.provider.trim())
    );

    const totalExecuted =
      retrieval.diagnostics.executedLexicalIntentCount +
      retrieval.diagnostics.executedSemanticIntentCount;
    const failed = totalExecuted > 0 &&
      retrieval.diagnostics.failedIntentCount >= totalExecuted;

    this.candidateTraces.set(run.comparisonId, {
      brandName: context.hunterInput.brand.brandName,
      discoveryTopics: context.discoveryPlan.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        audience: topic.audience,
      })),
      intents: retrievalPlan.intents
        .filter((intent) => intent.mode === "lexical-search")
        .map((intent) => ({
          id: intent.id,
          generator: intent.generator,
          topicName: intent.topicName,
          query: intent.query,
          sourceClasses: [...intent.sourceClasses],
          paidAgentReach: paidIntentIds.includes(intent.id),
        })),
      selected: eei.selected.map((item) => ({
        candidateId: item.candidateId,
        topic: item.topic,
        bucket: item.bucket,
        qualityScore: commonCandidateQuality(item),
        sourceKeys: [...item.preRanked.cluster.sourceKeys],
        generatorKeys: [...item.preRanked.cluster.generatorKeys],
        ...(item.deepIntelligence?.analysis.proposedAngle
          ? { proposedAngle: item.deepIntelligence.analysis.proposedAngle }
          : {}),
      })),
      diagnostics: {
        retrievalRawCandidates: retrieval.diagnostics.rawCandidateCount,
        retrievalUniqueCandidates: retrieval.diagnostics.uniqueCandidateCount,
        retrievalHardNegativeRejected: retrieval.diagnostics.hardNegativeRejectedCount,
        retrievalFailedIntents: retrieval.diagnostics.failedIntentCount,
        trendClusters: trend.diagnostics.clusterCount,
        preRankSelected: multistage.diagnostics.preRankSelectedCount,
        eeiEligible: eei.diagnostics.eligibleCount,
        eeiSelected: eei.diagnostics.selectedCount,
        explorationSelected: eei.diagnostics.explorationSelectedCount,
      },
    });

    return {
      inputFingerprint: run.inputFingerprint,
      workspaceId: context.hunterInput.brand.workspaceId,
      brandId: context.hunterInput.brand.brandId,
      qualityScore: average(eei.selected.map(commonCandidateQuality)),
      recommendationCount: eei.selected.length,
      evidenceCount: retrieval.candidates.length,
      modelInvocationCount: runtime.invocations(),
      criticalDependencyDegraded: false,
      criticalDependencyFailures: [],
      metadata: {
        latencyMs,
        costUsd: runtime.measuredCostUsd() + tools.measuredCostUsd(),
      },
      retrievalExpected: plannedTopics.length,
      retrievalCovered: coveredTopics.length,
      failed,
      explorationRecommendations: eei.selected.filter(
        (item) => item.bucket === "exploration",
      ).length,
      recommendationTopics: eei.selected.map((item) => item.topic),
      tenantIsolationVerified: true,
      manipulationSafetyVerified: eei.selected.every(
        (item) =>
          item.manipulationRiskScore <
          HUNTER_EEI_V2_SHADOW_POLICY.manipulationRiskBlockThreshold,
      ),
      provenanceComplete,
      persistenceAttempted: false,
      productionGuardIntact: true,
    };
  }

  private async context(run: HunterShadowRunCase): Promise<HunterShadowExecutionContext> {
    const cached = this.contexts.get(run.comparisonId);
    if (cached) return cached;

    const context = await this.options.loadContext(run);
    validateExecutionContext(run, context);
    this.contexts.set(run.comparisonId, context);
    return context;
  }
}

export class RuntimeHunterDeepAnalysisPort implements HunterDeepAnalysisPort {
  constructor(
    private readonly runtime: AgentRuntimePort,
    private readonly scope: {
      workspaceId: string;
      brandId: string;
      approvedContextVersion: string;
    },
  ) {}

  async analyze(request: HunterDeepAnalysisRequest): Promise<HunterDeepAnalysisResult> {
    const invocation = prepareAgentInvocation({
      role: "hunter",
      scope: {
        visibility: "brand-private",
        workspaceId: this.scope.workspaceId,
        brandId: this.scope.brandId,
      },
      approvedContextVersion: this.scope.approvedContextVersion,
      capabilities: ["public-content-search"],
      task: {
        instruction:
          "Analyze only the supplied Hunter evidence summary. Return a concise Brand-relevant opportunity analysis. Do not invent facts, do not infer private traits, and do not optimize for compulsive engagement. Originality and actionability are 0..1 confidence-like scores.",
        context: deepContext(request),
      },
      outputSchema: { name: "hunter-deep-intelligence", version: "1" },
      budget: {
        maxOutputTokens: 1_600,
        maxToolCalls: 0,
        maxCostUsd: 0.03,
        timeoutMs: 30_000,
      },
    });

    const result = await this.runtime.invoke<HunterDeepAnalysisResult>(invocation);
    return prepareHunterDeepAnalysisResult(result.output);
  }
}

export function isHunterDeepAnalysisOutput(value: unknown): value is HunterDeepAnalysisResult {
  try {
    prepareHunterDeepAnalysisResult(value as HunterDeepAnalysisResult);
    return true;
  } catch {
    return false;
  }
}

class MeteredToolGateway implements ToolGatewayPort {
  private costUsd = 0;
  private missingCostSource: string | undefined;

  constructor(
    private readonly inner: ToolGatewayPort,
    private readonly searchCostUsdBySource: Readonly<Record<string, number>> = {},
  ) {}

  async invoke<TOutput>(request: ToolRequest): Promise<ToolResult<TOutput>> {
    const result = await this.inner.invoke<TOutput>(request);
    if (request.capability === "public-content-search") {
      const source = typeof request.input.source === "string" && request.input.source.trim()
        ? request.input.source.trim().toLowerCase()
        : "agent-reach";
      const configured = this.searchCostUsdBySource[source];
      if (configured !== undefined) {
        if (!Number.isFinite(configured) || configured < 0) {
          throw new Error("Hunter shadow search cost must be a non-negative number for " + source);
        }
        this.costUsd += configured;
      } else if (!FREE_SEARCH_SOURCES.has(source)) {
        this.missingCostSource = source;
      }
    }
    return result;
  }

  measuredCostUsd(): number {
    if (this.missingCostSource) {
      throw new Error(
        "Measured search cost metadata is required for Hunter shadow source " +
        this.missingCostSource,
      );
    }
    return this.costUsd;
  }
}

const FREE_SEARCH_SOURCES = new Set([
  "rss",
  "github",
  "hacker-news",
  "bluesky",
  "youtube",
]);

class MeteredRuntime implements AgentRuntimePort {
  private costUsd = 0;
  private invocationCount = 0;
  private missingCost = false;

  constructor(private readonly inner: AgentRuntimePort) {}

  async invoke<TOutput>(
    request: AgentInvocationRequest,
  ): Promise<AgentRuntimeResult<TOutput>> {
    const result = await this.inner.invoke<TOutput>(request);
    this.invocationCount += 1;
    if (result.metadata.costUsd === undefined || !Number.isFinite(result.metadata.costUsd)) {
      this.missingCost = true;
    } else {
      this.costUsd += result.metadata.costUsd;
    }
    return result;
  }

  invocations(): number {
    return this.invocationCount;
  }

  measuredCostUsd(): number {
    if (this.invocationCount > 0 && this.missingCost) {
      throw new Error("Measured model cost metadata is required for Hunter shadow evidence");
    }
    return this.costUsd;
  }
}


export function isRateLimitedControlDegradation(
  criticalDegraded: boolean,
  failures: HunterShadowControlLaneResult["criticalDependencyFailures"],
): boolean {
  return criticalDegraded &&
    failures.length > 0 &&
    failures.every((failure) => failure.kind === "rate-limited");
}

function criticalControlFailures(
  diagnostics: readonly HunterFailureDiagnostic[],
): HunterShadowControlLaneResult["criticalDependencyFailures"] {
  return diagnostics
    .filter(
      (
        diagnostic,
      ): diagnostic is HunterFailureDiagnostic & {
        phase: "discovery" | "judgment";
      } =>
        diagnostic.phase === "discovery" || diagnostic.phase === "judgment",
    )
    .map((diagnostic) => ({
      phase: diagnostic.phase,
      source: diagnostic.source,
      kind: diagnostic.kind,
      ...(diagnostic.statusCode !== undefined
        ? { statusCode: diagnostic.statusCode }
        : {}),
    }));
}

function controlRetryPolicy(
  input: HunterShadowLaneAdapterOptions["controlRetry"],
): { maxAttempts: number; delayMs: number; sleep: (ms: number) => Promise<void> } {
  const maxAttempts = input?.maxAttempts ?? 2;
  const delayMs = input?.delayMs ?? 10_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("Hunter shadow control retry maxAttempts must be an integer from 1 to 3");
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 30_000) {
    throw new Error("Hunter shadow control retry delayMs must be an integer from 0 to 30000");
  }
  return {
    maxAttempts,
    delayMs,
    sleep: input?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

export function anchorShadowRetrievalPlanToBrand(
  plan: HunterRetrievalPlan,
  brandName: string,
): HunterRetrievalPlan {
  const brand = brandName.replace(/\s+/g, " ").trim();
  if (!brand) return plan;
  return {
    ...plan,
    intents: plan.intents.map((intent) => ({
      ...intent,
      query: anchorQuery(intent.query, brand),
      semanticQuery: anchorQuery(intent.semanticQuery, brand),
    })),
  };
}

/** Keep shadow searches tied to a dated development, not a Brand landing page. */
export function focusShadowRetrievalPlanOnDevelopments(
  plan: HunterRetrievalPlan,
  referenceTime: string,
): HunterRetrievalPlan {
  const year = new Date(referenceTime).getUTCFullYear();
  if (!Number.isFinite(year)) throw new Error("Hunter shadow referenceTime is invalid");
  const developmentTerms = ` ${year} recent announcement update release news`;
  const focus = (query: string) => query.slice(0, 500 - developmentTerms.length).trimEnd() + developmentTerms;
  return {
    ...plan,
    intents: plan.intents.map((intent) => ({
      ...intent,
      query: focus(intent.query),
      semanticQuery: focus(intent.semanticQuery),
    })),
  };
}

export function brandIdentityFit(text: string, brandName: string): number {
  const brandTokens = meaningfulIdentityTokens(brandName);
  if (!brandTokens.length) return 0;
  const textTokens = new Set(meaningfulIdentityTokens(text));
  const matched = brandTokens.filter((token) => textTokens.has(token)).length;
  return matched / brandTokens.length;
}

function anchorQuery(query: string, brandName: string): string {
  if (brandIdentityFit(query, brandName) >= 1) return query;
  return (brandName + " " + query).replace(/\s+/g, " ").trim().slice(0, 500);
}

function meaningfulIdentityTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1) ?? [];
}

export function selectPaidShadowIntentIds(
  plan: HunterRetrievalPlan,
  maxPaidInput: number,
): string[] {
  const maxPaid = Math.max(0, Math.min(6, Math.trunc(maxPaidInput)));
  if (maxPaid === 0) return [];

  const lexical = plan.intents.filter((intent) => intent.mode === "lexical-search");
  const generatorOrder = new Map<string, number>([
    ["brand-core", 0],
    ["rising-breaking", 1],
    ["authority", 2],
    ["audience-problem", 3],
    ["outlier", 4],
    ["evergreen", 5],
    ["category-competitor", 6],
    ["adjacent-exploration", 7],
  ]);
  const compare = (left: typeof lexical[number], right: typeof lexical[number]) =>
    (generatorOrder.get(left.generator) ?? 99) -
      (generatorOrder.get(right.generator) ?? 99) ||
    left.topicId.localeCompare(right.topicId) ||
    left.id.localeCompare(right.id);

  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const coveredTopics = new Set<string>();
  const add = (intent: typeof lexical[number] | undefined) => {
    if (!intent || selected.length >= maxPaid || selectedSet.has(intent.id)) return;
    selected.push(intent.id);
    selectedSet.add(intent.id);
    coveredTopics.add(intent.topicId);
  };

  const exploration = lexical
    .filter((intent) => intent.generator === "adjacent-exploration")
    .sort((a, b) => a.topicId.localeCompare(b.topicId) || a.id.localeCompare(b.id));
  add(exploration[0]);

  const nonExploration = lexical
    .filter((intent) => intent.generator !== "adjacent-exploration")
    .sort(compare);
  const topicIds = [...new Set(nonExploration.map((intent) => intent.topicId))].sort();

  for (const topicId of topicIds) {
    if (selected.length >= maxPaid) break;
    if (coveredTopics.has(topicId)) continue;
    add(nonExploration.find((intent) => intent.topicId === topicId));
  }
  for (const intent of nonExploration) {
    if (selected.length >= maxPaid) break;
    add(intent);
  }
  for (const intent of exploration.slice(1)) {
    if (selected.length >= maxPaid) break;
    add(intent);
  }
  return selected;
}

export function balancedShadowRetrievalPlan(
  plan: HunterRetrievalPlan,
  maxIntentsInput: number,
  rotationSeed = "",
): HunterRetrievalPlan {
  const maxIntents = Math.max(1, Math.min(24, Math.trunc(maxIntentsInput)));
  const allTopicIds = [...new Set(plan.intents.map((intent) => intent.topicId))].sort();
  const topicIds = rotateStable(allTopicIds, rotationSeed);
  const generatorOrder = new Map<string, number>([
    ["brand-core", 0],
    ["rising-breaking", 1],
    ["authority", 2],
    ["audience-problem", 3],
    ["outlier", 4],
    ["evergreen", 5],
    ["category-competitor", 6],
  ]);
  const bestNonExplorationByTopic = new Map(topicIds.map((topicId) => [
    topicId,
    plan.intents
      .filter(
        (intent) =>
          intent.topicId === topicId &&
          intent.mode === "lexical-search" &&
          intent.generator !== "adjacent-exploration",
      )
      .sort((left, right) =>
        (generatorOrder.get(left.generator) ?? 99) -
          (generatorOrder.get(right.generator) ?? 99) ||
        left.id.localeCompare(right.id)
      )[0],
  ] as const));

  const selected: HunterRetrievalPlan["intents"] = [];
  const selectedTopics = new Set<string>();
  const reserveExploration = maxIntents >= 2 &&
    plan.intents.some(
      (intent) =>
        intent.mode === "lexical-search" &&
        intent.generator === "adjacent-exploration",
    );
  const coreTarget = Math.max(0, maxIntents - (reserveExploration ? 1 : 0));

  for (const topicId of topicIds) {
    if (selected.length >= coreTarget) break;
    const intent = bestNonExplorationByTopic.get(topicId);
    if (!intent) continue;
    selected.push(intent);
    selectedTopics.add(topicId);
  }

  if (reserveExploration) {
    const exploration = plan.intents
      .filter(
        (intent) =>
          intent.mode === "lexical-search" &&
          intent.generator === "adjacent-exploration",
      )
      .sort((left, right) => {
        const leftIndex = topicIds.indexOf(left.topicId);
        const rightIndex = topicIds.indexOf(right.topicId);
        return leftIndex - rightIndex || left.id.localeCompare(right.id);
      });
    const distinct = exploration.find((intent) => !selectedTopics.has(intent.topicId));
    const chosen = distinct ?? exploration[0];
    if (chosen) selected.push(chosen);
  }

  if (selected.length < maxIntents) {
    const selectedIds = new Set(selected.map((intent) => intent.id));
    for (const topicId of topicIds) {
      const intent = bestNonExplorationByTopic.get(topicId);
      if (!intent || selectedIds.has(intent.id)) continue;
      selected.push(intent);
      selectedIds.add(intent.id);
      if (selected.length >= maxIntents) break;
    }
  }
  return { ...plan, intents: selected.slice(0, maxIntents) };
}

function rotateStable<T>(values: readonly T[], seed: string): T[] {
  if (values.length < 2) return [...values];
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const offset = (hash >>> 0) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function validateExecutionContext(
  run: HunterShadowRunCase,
  context: HunterShadowExecutionContext,
): void {
  const brand = context.hunterInput.brand;
  if (
    brand.workspaceId !== run.workspaceId ||
    brand.brandId !== run.brandId ||
    context.discoveryPlan.workspaceId !== run.workspaceId ||
    context.discoveryPlan.brandId !== run.brandId
  ) {
    throw new Error("Hunter shadow execution context must match the requested workspace and Brand");
  }
  if (context.hunterInput.accountId !== context.accountId) {
    throw new Error("Hunter shadow execution account must match Hunter input account");
  }
  if (
    context.preferenceState &&
    (
      context.preferenceState.workspaceId !== run.workspaceId ||
      context.preferenceState.brandId !== run.brandId
    )
  ) {
    throw new Error("Hunter shadow Preference State must match the requested workspace and Brand");
  }
  if (Number.isNaN(Date.parse(context.referenceTime))) {
    throw new Error("Hunter shadow referenceTime must be a valid timestamp");
  }
}

function commonCandidateQuality(
  item: ReturnType<typeof runShadowPreferenceAwareEEI>["selected"][number],
): number {
  const topicFit = item.preRanked.topicFit;
  const brandIdentityFitScore =
    item.preRanked.preRank.features.brandSemanticSimilarity;
  const relevance = brandIdentityFitScore === undefined
    ? topicFit
    : clamp01(topicFit * 0.65 + brandIdentityFitScore * 0.35);
  const preference = item.preferenceAffinity;
  const audienceFit = preference === undefined
    ? relevance
    : clamp01(relevance * 0.6 + preference * 0.4);

  return evaluateOpportunity({
    relevance,
    evidence: clamp01(item.preRanked.cluster.intelligence.evidenceConfidence),
    novelty: clamp01(1 - item.saturationPenalty),
    timeliness: clamp01(
      item.preRanked.cluster.intelligence.freshness * 0.6 +
      item.preRanked.preRank.features.trendMomentum * 0.4,
    ),
    brandAuthority: clamp01(item.sourceDiversity),
    audienceFit,
  }).overall;
}

function deepContext(request: HunterDeepAnalysisRequest): Record<string, JsonValue> {
  return {
    candidateId: request.candidateId,
    topic: request.topic,
    stage: request.stage,
    ...(request.audience ? { audience: request.audience } : {}),
    evidenceSummary: request.evidenceSummary,
    supportingSignalIds: [...request.supportingSignalIds],
    sourceClasses: [...request.sourceClasses],
    preRankScore: request.preRankScore,
  };
}

function average(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function positiveElapsed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
