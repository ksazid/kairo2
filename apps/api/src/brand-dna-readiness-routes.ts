import { Pool } from "pg";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { evaluateBrandDnaReadiness, KairoService, type KairoRepository } from "@kairo/domain";
import { createBrandBrainActivationSnapshot } from "@kairo/domain/brand-brain-activation";
import {
  BrandDiscoveryPlanService,
  projectInitialBrandDiscoveryPlan,
  type BrandDiscoveryPlanRepository,
  type UpdateBrandDiscoveryTopicInput,
} from "@kairo/domain/brand-discovery-plan";
import { projectBrandIntelligenceSnapshot } from "@kairo/domain/brand-intelligence-snapshot";
import type { HunterRunRepository } from "@kairo/domain/hunter-run-record";
import type { IdentityVerifier } from "./auth";
import { PgBrandDiscoveryPlanRepository } from "./brand-discovery-plan-postgres";
import { PgHunterRunRepository } from "./hunter-run-postgres";

let runtimePlanPool: Pool | undefined;
let runtimeRunPool: Pool | undefined;

export function registerBrandDnaReadinessRoutes(app: FastifyInstance, options: {
  store: KairoRepository;
  identityVerifier: IdentityVerifier;
  discoveryPlanStore?: BrandDiscoveryPlanRepository;
  hunterRunStore?: HunterRunRepository;
}): void {
  const core = new KairoService(options.store);
  const planStore = options.discoveryPlanStore ?? discoveryPlanStoreFromEnv();
  const plans = planStore ? new BrandDiscoveryPlanService(planStore) : undefined;
  const runStore = options.hunterRunStore ?? hunterRunStoreFromEnv();

  app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/brain/readiness", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    const fields = await core.listBrandBrain(account.id, request.params.brandId);
    return evaluateBrandDnaReadiness(fields);
  });

  app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/brain/activation", async (request, reply) => {
    const account = await authenticate(request, reply, core, options.identityVerifier);
    if (!account) return;
    const context = await activationContext(core, account.id, request.params.brandId);
    const discoveryPlan = plans
      ? await plans.ensure(account.id, context.intelligenceSnapshot)
      : projectInitialBrandDiscoveryPlan(context.intelligenceSnapshot);
    const discoveryRun = runStore ? await runStore.getLatest(account.id, request.params.brandId) : undefined;
    return {
      brain: context.brain,
      sources: context.sources,
      ...context.activation,
      intelligenceSnapshot: context.intelligenceSnapshot,
      discoveryPlan,
      discoveryPlanCurrent: discoveryPlan.snapshotVersion === context.intelligenceSnapshot.snapshotVersion,
      discoveryRun: discoveryRun ?? null,
      schedule: null,
    };
  });

  if (plans) {
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/discovery-plan", async (request, reply) => {
      const account = await authenticate(request, reply, core, options.identityVerifier);
      if (!account) return;
      const context = await activationContext(core, account.id, request.params.brandId);
      const plan = await plans.ensure(account.id, context.intelligenceSnapshot);
      return { plan, current: plan.snapshotVersion === context.intelligenceSnapshot.snapshotVersion };
    });

    app.patch<{ Params: { brandId: string; topicId: string }; Body: UpdateBrandDiscoveryTopicInput }>(
      "/api/v1/brands/:brandId/discovery-plan/topics/:topicId",
      async (request, reply) => {
        const account = await authenticate(request, reply, core, options.identityVerifier);
        if (!account) return;
        return plans.updateTopic(account.id, request.params.brandId, request.params.topicId, request.body ?? ({} as UpdateBrandDiscoveryTopicInput));
      },
    );
  }
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

async function activationContext(core: KairoService, accountId: string, brandId: string) {
  const [brand, brain, sources] = await Promise.all([
    core.getBrand(accountId, brandId),
    core.listBrandBrain(accountId, brandId),
    core.listKnowledgeSources(accountId, brandId),
  ]);
  const activation = createBrandBrainActivationSnapshot(brain, sources);
  const intelligenceSnapshot = projectBrandIntelligenceSnapshot({ brand, fields: brain, sources, activation });
  return { brain, sources, activation, intelligenceSnapshot };
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, core: KairoService, verifier: IdentityVerifier) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Authentication is required", code: "unauthorized", correlationId: request.id });
    return null;
  }
  return core.establishSession(identity);
}
