import { Pool } from "pg";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KairoService, type KairoRepository } from "@kairo/domain";
import { DiscoveryService } from "@kairo/domain/discovery-service";
import { createBrandBrainActivationSnapshot } from "@kairo/domain/brand-brain-activation";
import {
  BrandDiscoveryPlanService,
  projectInitialBrandDiscoveryPlan,
  type BrandDiscoveryPlan,
  type BrandDiscoveryPlanRepository,
} from "@kairo/domain/brand-discovery-plan";
import { projectBrandIntelligenceSnapshot, type BrandIntelligenceSnapshot } from "@kairo/domain/brand-intelligence-snapshot";
import type { HunterRunRepository } from "@kairo/domain/hunter-run-record";
import { projectBrandIntelligenceProfile, type BrandIntelligenceProfile } from "@kairo/domain/source-policy";
import { selectSectorIntelligencePack } from "@kairo/domain/sector-packs";
import type { HunterRunInput, HunterRunResult } from "@kairo/worker/hunter";
import type { IdentityVerifier } from "./auth";
import type { BrandIntelligenceGraphStore } from "./brand-intelligence-graph-store";
import type { SectorPackId } from "@kairo/domain/brand-intelligence";
import { PgBrandDiscoveryPlanRepository } from "./brand-discovery-plan-postgres";
import { PgHunterRunRepository } from "./hunter-run-postgres";
import {
  hunterClosedLoopStoreFromEnvironment,
  type HunterClosedLoopStore,
  type RecommendationFeedbackAction,
} from "./batch7-closed-loop-store";

let runtimePlanPool: Pool | undefined;
let runtimeRunPool: Pool | undefined;

export interface HunterRecommendationRunner {
  runForAuthorizedBrand(input: HunterRunInput): Promise<HunterRunResult>;
}

export function registerHunterRecommendationRoutes(app: FastifyInstance, options: {
  store: KairoRepository;
  identityVerifier: IdentityVerifier;
  runner?: HunterRecommendationRunner;
  graphStore?: BrandIntelligenceGraphStore;
  closedLoopStore?: HunterClosedLoopStore;
  discovery?: DiscoveryService;
  discoveryPlanStore?: BrandDiscoveryPlanRepository;
  hunterRunStore?: HunterRunRepository;
  onOpportunityDeveloped?: (input: { accountId: string; brandId: string; opportunityId: string; ideaId: string }) => Promise<void>;
}) {
  const core = new KairoService(options.store);
  const inFlight = new Map<string, Promise<HunterRunResult>>();
  const closedLoop = options.closedLoopStore ?? hunterClosedLoopStoreFromEnvironment();
  const planStore = options.discoveryPlanStore ?? discoveryPlanStoreFromEnv();
  const plans = planStore ? new BrandDiscoveryPlanService(planStore) : undefined;
  const runStore = options.hunterRunStore ?? hunterRunStoreFromEnv();

  app.get<{ Params: { brandId: string }; Querystring: { limit?: string } }>(
    "/api/v1/brands/:brandId/hunter-runs",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      await core.getBrand(account.id, request.params.brandId);
      if (!runStore) return unavailableRunHistory(reply, request.id);
      const requested = Number(request.query.limit ?? 20);
      const limit = Number.isInteger(requested) ? Math.max(1, Math.min(100, requested)) : 20;
      return runStore.listRecent(account.id, request.params.brandId, limit);
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/api/v1/brands/:brandId/hunter-runs/latest",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      await core.getBrand(account.id, request.params.brandId);
      if (!runStore) return unavailableRunHistory(reply, request.id);
      return (await runStore.getLatest(account.id, request.params.brandId)) ?? null;
    },
  );

  app.post<{ Params: { brandId: string } }>(
    "/api/v1/brands/:brandId/recommendations",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;

      const brand = await core.getBrand(account.id, request.params.brandId);
      if (!options.runner) {
        return reply.status(503).send({
          type: "about:blank",
          title: "Recommendations unavailable",
          status: 503,
          detail: "Kairo's recommendation runtime is not configured right now.",
          code: "hunter_unavailable",
          correlationId: request.id,
        });
      }

      const [brain, sources] = await Promise.all([
        core.listBrandBrain(account.id, brand.id),
        core.listKnowledgeSources(account.id, brand.id),
      ]);
      const activation = createBrandBrainActivationSnapshot(brain, sources);
      const snapshot = projectBrandIntelligenceSnapshot({ brand, fields: brain, sources, activation });
      if (!snapshot.hunterReady) {
        return reply.status(409).send({
          type: "about:blank",
          title: "Brand Brain is not ready for Hunter",
          status: 409,
          detail: "Complete or confirm the required Brand Brain context before running discovery.",
          code: "hunter_not_ready",
          correlationId: request.id,
          readiness: snapshot.status,
          gaps: snapshot.readinessGaps,
          weakFields: snapshot.weakFields,
          snapshotVersion: snapshot.snapshotVersion,
        });
      }

      const discoveryPlan = plans
        ? await plans.ensure(account.id, snapshot)
        : projectInitialBrandDiscoveryPlan(snapshot);
      const baseProfile = projectBrandIntelligenceProfile(brain);
      const intelligenceProfile = applyDiscoveryPlan(baseProfile, discoveryPlan);
      const pack = selectSectorIntelligencePack(intelligenceProfile);
      const graphRecord = options.graphStore
        ? await options.graphStore.ensureCurrent(account.id, brand.workspaceId, brand.id, brain, topicGraphPack(pack.id))
        : undefined;
      const existingOpportunities = options.discovery ? await options.discovery.list(account.id, brand.id) : [];
      const projectedBrand = projectBrandContext(snapshot, discoveryPlan);
      const learnedContext = closedLoop ? await closedLoop.learningContext(account.id, brand.id) : undefined;
      const startedAt = new Date().toISOString();
      const input: HunterRunInput = {
        accountId: account.id,
        brand: learnedContext
          ? { ...projectedBrand, goals: mergeClosedLoopContext(projectedBrand.goals, learnedContext) }
          : projectedBrand,
        intelligenceProfile,
        ...(graphRecord ? { intelligenceGraph: graphRecord.graph, intelligenceVersion: graphRecord.version } : {}),
        maxEvidence: 20,
        refreshSeed: startedAt,
        ...(existingOpportunities.length ? { existingOpportunityTitles: existingOpportunities.map((item) => item.title).slice(0, 100) } : {}),
      };
      const key = `${account.id}:${brand.id}`;
      let run = inFlight.get(key);
      if (!run) {
        run = executeRecordedHunterRun({
          accountId: account.id,
          workspaceId: brand.workspaceId,
          brandId: brand.id,
          snapshotVersion: snapshot.snapshotVersion,
          planVersion: discoveryPlan.planVersion,
          startedAt,
          input,
          runner: options.runner,
          runStore,
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, run);
      }
      return run;
    },
  );

  app.post<{ Params: { brandId: string; opportunityId: string; action: string } }>(
    "/api/v1/brands/:brandId/opportunities/:opportunityId/feedback/:action",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      await core.getBrand(account.id, request.params.brandId);
      if (!closedLoop) return unavailableClosedLoop(reply, request.id);
      if (!isFeedbackAction(request.params.action)) {
        return reply.status(400).send({
          type: "about:blank",
          title: "Invalid feedback",
          status: 400,
          detail: "Recommendation feedback must be seen or dismissed.",
          code: "invalid_feedback_action",
          correlationId: request.id,
        });
      }
      return closedLoop.recordFeedback(account.id, request.params.brandId, request.params.opportunityId, request.params.action);
    },
  );

  app.post<{ Params: { brandId: string; opportunityId: string } }>(
    "/api/v1/brands/:brandId/opportunities/:opportunityId/development",
    async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      await core.getBrand(account.id, request.params.brandId);
      if (!closedLoop) return unavailableClosedLoop(reply, request.id);
      const result = await closedLoop.developOpportunity(account.id, request.params.brandId, request.params.opportunityId);
      // An idea is the explicit selection point. Asset rendering is best-effort here:
      // it must never undo the persisted idea if storage is temporarily unavailable.
      await options.onOpportunityDeveloped?.({ accountId: account.id, brandId: request.params.brandId, opportunityId: request.params.opportunityId, ideaId: result.ideaId }).catch((error) => {
        request.log.warn({ err: error, opportunityId: request.params.opportunityId }, "Concept asset rendering deferred");
      });
      return result;
    },
  );
}

async function executeRecordedHunterRun(options: {
  accountId: string;
  workspaceId: string;
  brandId: string;
  snapshotVersion: string;
  planVersion: string;
  startedAt: string;
  input: HunterRunInput;
  runner: HunterRecommendationRunner;
  runStore?: HunterRunRepository;
}): Promise<HunterRunResult> {
  const startedMs = Date.parse(options.startedAt);
  const record = options.runStore ? await options.runStore.start(options.accountId, {
    workspaceId: options.workspaceId,
    brandId: options.brandId,
    snapshotVersion: options.snapshotVersion,
    planVersion: options.planVersion,
    trigger: "manual",
    startedAt: options.startedAt,
  }) : undefined;
  try {
    const result = await options.runner.runForAuthorizedBrand(options.input);
    if (record && options.runStore) {
      const completedAt = new Date().toISOString();
      await options.runStore.complete(options.accountId, record.runId, {
        completedAt,
        durationMs: elapsedMs(startedMs, completedAt),
        evidenceCount: result.evidenceCount,
        candidateCount: result.candidateCount,
        opportunityCount: result.opportunityCount,
        sourcesScanned: authoritativeSources(result),
        degradedSources: result.degradedSources ?? [],
      });
    }
    return result;
  } catch (error) {
    if (record && options.runStore) {
      const completedAt = new Date().toISOString();
      await options.runStore.fail(options.accountId, record.runId, {
        completedAt,
        durationMs: elapsedMs(startedMs, completedAt),
        sourcesScanned: [],
        degradedSources: [],
        failureCode: failureCode(error),
        failureMessage: failureMessage(error),
      }).catch(() => undefined);
    }
    throw error;
  }
}

function authoritativeSources(result: HunterRunResult): string[] {
  const value = (result as HunterRunResult & { sourcesScanned?: unknown }).sourcesScanned;
  if (!Array.isArray(value)) return [];
  return unique(value.filter((item): item is string => typeof item === "string"));
}

function elapsedMs(startedMs: number, completedAt: string): number {
  if (!Number.isFinite(startedMs)) return 0;
  return Math.max(0, Math.round(Date.parse(completedAt) - startedMs));
}

function failureCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code.trim().slice(0, 120) || "hunter_run_failed";
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Hunter run failed";
  return message.trim().slice(0, 1_000) || "Hunter run failed";
}

function discoveryPlanStoreFromEnv(): BrandDiscoveryPlanRepository | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  runtimePlanPool ??= new Pool({ connectionString });
  return new PgBrandDiscoveryPlanRepository(runtimePlanPool);
}

function hunterRunStoreFromEnv(): HunterRunRepository | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  runtimeRunPool ??= new Pool({ connectionString });
  return new PgHunterRunRepository(runtimeRunPool);
}

function applyDiscoveryPlan(profile: BrandIntelligenceProfile, plan: BrandDiscoveryPlan): BrandIntelligenceProfile {
  const topicNames = unique(plan.topics.map((topic) => topic.name));
  const topicAudiences = unique(plan.topics.map((topic) => topic.audience));
  const sourceClasses = unique(plan.topics.flatMap((topic) => topic.sourceClasses));
  return {
    ...profile,
    topics: topicNames.length ? topicNames : profile.topics,
    audiences: unique([...topicAudiences, ...profile.audiences]),
    excludedTopics: unique([...plan.excludedTopics, ...profile.excludedTopics]),
    ...(sourceClasses.length ? { sourceClasses } : profile.sourceClasses?.length ? { sourceClasses: profile.sourceClasses } : {}),
  };
}

function projectBrandContext(snapshot: BrandIntelligenceSnapshot, plan: BrandDiscoveryPlan): HunterRunInput["brand"] {
  const context = snapshot.context;
  return {
    workspaceId: snapshot.workspaceId,
    brandId: snapshot.brandId,
    contextVersion: `${snapshot.snapshotVersion}|${plan.planVersion}`,
    brandName: snapshot.brandName,
    ...(context.positioning ? { positioning: context.positioning } : {}),
    ...(context.audience ? { audience: context.audience } : {}),
    ...(context.voice ? { voice: context.voice } : {}),
    ...(context.goals ? { goals: context.goals } : {}),
    ...(context.boundaries ? { boundaries: context.boundaries } : {}),
  };
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isFeedbackAction(value: string): value is RecommendationFeedbackAction {
  return value === "seen" || value === "dismissed";
}

function unavailableClosedLoop(reply: FastifyReply, correlationId: string) {
  return reply.status(503).send({
    type: "about:blank",
    title: "Recommendation feedback unavailable",
    status: 503,
    detail: "Kairo's recommendation feedback store is not configured right now.",
    code: "closed_loop_unavailable",
    correlationId,
  });
}

function unavailableRunHistory(reply: FastifyReply, correlationId: string) {
  return reply.status(503).send({
    type: "about:blank",
    title: "Hunter run history unavailable",
    status: 503,
    detail: "Kairo's Hunter run history store is not configured right now.",
    code: "hunter_run_history_unavailable",
    correlationId,
  });
}

function mergeClosedLoopContext(existing: string | undefined, learnedContext: string): string {
  const prefix = existing?.trim() ? `${existing.trim()}\n\n` : "";
  return `${prefix}Closed-loop learning (use as guidance, not as public evidence):\n${learnedContext}`.slice(0, 8_000);
}

function topicGraphPack(packId: string): SectorPackId {
  if (packId === "ai-technology") return "ai-tech";
  if (packId === "umrah-religious-travel") return "umrah";
  if (packId === "ias-upsc-education") return "ias-upsc";
  if (packId === "motorcycles") return "motorcycles";
  return "generic";
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, service: KairoService, verifier: IdentityVerifier) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "Authentication is required",
      code: "unauthorized",
      correlationId: request.id,
    });
    return null;
  }
  return service.establishSession(identity);
}
