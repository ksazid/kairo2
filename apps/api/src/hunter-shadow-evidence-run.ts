import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  AgentRuntimePort,
  ToolGatewayPort,
} from "@kairo/agent-contracts";
import { KairoService, type KairoRepository } from "@kairo/domain";
import { BrandBrainBootstrapService } from "@kairo/domain/brand-brain-bootstrap";
import { SanitizingPublicBrandReferenceReader } from "@kairo/domain/brand-brain-sanitizing-reader";
import { createBrandBrainActivationSnapshot } from "@kairo/domain/brand-brain-activation";
import {
  projectInitialBrandDiscoveryPlan,
  type BrandDiscoveryPlan,
} from "@kairo/domain/brand-discovery-plan";
import {
  buildTopicGraph,
  type SectorPackId,
} from "@kairo/domain/brand-intelligence";
import {
  projectBrandIntelligenceSnapshot,
  type BrandIntelligenceSnapshot,
} from "@kairo/domain/brand-intelligence-snapshot";
import {
  prepareBrandPreferenceState,
  type BrandPreferenceState,
} from "@kairo/domain/brand-preference-state";
import type { DiscoveryService } from "@kairo/domain/discovery-service";
import {
  projectBrandIntelligenceProfile,
  type BrandIntelligenceProfile,
  type DiscoverySourceDefinition,
} from "@kairo/domain/source-policy";
import { selectSectorIntelligencePack } from "@kairo/domain/sector-packs";
import {
  ReadOnlyHunterShadowLaneExecutor,
  type HunterShadowExecutionContext,
} from "@kairo/worker/hunter-shadow-lane-adapters";
import {
  runHunterShadowEvidenceBatch,
  type HunterShadowEvidenceBatch,
  type HunterShadowRunCase,
} from "@kairo/worker/hunter-shadow-evidence-runner";
import type { HunterRunInput } from "@kairo/worker/hunter";
import { BrandBrainBuilder } from "@kairo/worker/brand-brain-builder";
import { PgHunterClosedLoopStore } from "./batch7-closed-loop-store";
import { PgBrandDiscoveryPlanRepository } from "./brand-discovery-plan-postgres";
import { buildEphemeralPublicBrandContexts } from "./hunter-shadow-ephemeral-brands";
import { PgBrandCreator } from "./brand-creator";
import { SourceIntelligenceBrandReferenceReader } from "./source-intelligence";

const SHA40 = /^[0-9a-f]{40}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface HunterShadowOperationalRequest {
  runId: string;
  releaseSha: string;
  brandCount: number;
  runsPerBrand: number;
  allowEphemeralPublicBrands: boolean;
  allowDisposablePersistedAnchor: boolean;
  anchorBrandId?: string;
}

export interface HunterShadowOperationalEvidence {
  schemaVersion: 1;
  evidenceKind: "hunter-v2-shadow-operational";
  runId: string;
  releaseSha: string;
  startedAt: string;
  completedAt: string;
  brandCount: number;
  pairCount: number;
  cohort: { persistedBrands: number; disposablePersistedBrands: number; ephemeralPublicBrands: number };
  costScope: "model-plus-configured-search";
  readiness: HunterShadowEvidenceBatch["readiness"];
  observations: Array<{
    comparisonId: string;
    brandKey: string;
    v1QualityScore: number;
    v2QualityScore: number;
    retrievalCoverage: number;
    v1LatencyMs: number;
    v2LatencyMs: number;
    v1CostUsd: number;
    v2CostUsd: number;
    v2Failure: boolean;
    explorationShare: number;
    maximumTopicShare: number;
    criticalViolations?: string[];
  }>;
}

export const HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE = {
  maxIntents: 6,
  maxSourcesPerIntent: 2,
  maxExternalCalls: 6,
  maxSemanticCalls: 0,
  deepLimit: 2,
  maxCandidates: 10,
} as const;

export interface ExecuteHunterShadowEvidenceOptions {
  pool: Pool;
  store: KairoRepository;
  discovery: DiscoveryService;
  tools: ToolGatewayPort;
  runtime: AgentRuntimePort;
  sourceRegistry: readonly DiscoverySourceDefinition[];
  request: HunterShadowOperationalRequest;
  searchCostUsdBySource?: Readonly<Record<string, number>>;
}

export function hunterShadowEvidenceRequestFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HunterShadowOperationalRequest | undefined {
  const runId = env.KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID?.trim();
  if (!runId) return undefined;
  if (!RUN_ID.test(runId)) {
    throw new Error("KAIRO_HUNTER_SHADOW_EVIDENCE_RUN_ID is invalid");
  }

  const releaseSha = env.KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA?.trim() ?? "";
  if (!SHA40.test(releaseSha)) {
    throw new Error(
      "KAIRO_HUNTER_SHADOW_EVIDENCE_RELEASE_SHA must be an exact lowercase 40-character SHA",
    );
  }
  const configuredRelease = env.KAIRO_RELEASE_SHA?.trim() ?? "";
  if (configuredRelease !== releaseSha) {
    throw new Error(
      "Hunter shadow evidence release SHA must match KAIRO_RELEASE_SHA",
    );
  }

  const brandCount = boundedInteger(
    env.KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS,
    3,
    "KAIRO_HUNTER_SHADOW_EVIDENCE_BRANDS",
    3,
    10,
  );
  const runsPerBrand = boundedInteger(
    env.KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND,
    10,
    "KAIRO_HUNTER_SHADOW_EVIDENCE_RUNS_PER_BRAND",
    1,
    20,
  );
  if (brandCount * runsPerBrand < 30) {
    throw new Error("Hunter shadow evidence requires at least 30 paired runs");
  }

  if (
    env.EXA_API_KEY?.trim() &&
    !env.KAIRO_HUNTER_AGENT_REACH_SEARCH_COST_USD?.trim()
  ) {
    throw new Error(
      "KAIRO_HUNTER_AGENT_REACH_SEARCH_COST_USD is required when Agent Reach/Exa is enabled for shadow evidence",
    );
  }

  const anchorBrandIdRaw =
    env.KAIRO_HUNTER_SHADOW_EVIDENCE_ANCHOR_BRAND_ID?.trim().toLowerCase();
  if (anchorBrandIdRaw && !UUID.test(anchorBrandIdRaw)) {
    throw new Error(
      "KAIRO_HUNTER_SHADOW_EVIDENCE_ANCHOR_BRAND_ID must be a valid lowercase UUID",
    );
  }

  return {
    runId,
    releaseSha,
    brandCount,
    runsPerBrand,
    allowEphemeralPublicBrands:
      env.KAIRO_HUNTER_SHADOW_EVIDENCE_EPHEMERAL_PUBLIC_BRANDS?.trim().toLowerCase() === "true",
    allowDisposablePersistedAnchor:
      env.KAIRO_HUNTER_SHADOW_EVIDENCE_DISPOSABLE_PERSISTED_ANCHOR?.trim().toLowerCase() === "true",
    ...(anchorBrandIdRaw ? { anchorBrandId: anchorBrandIdRaw } : {}),
  };
}

export function hunterShadowSearchCostUsdBySourceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, number>> {
  const value = env.KAIRO_HUNTER_AGENT_REACH_SEARCH_COST_USD?.trim();
  if (!value) return {};
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      "KAIRO_HUNTER_AGENT_REACH_SEARCH_COST_USD must be a non-negative number",
    );
  }
  return { "agent-reach": parsed };
}

export async function executeHunterShadowEvidenceRun(
  options: ExecuteHunterShadowEvidenceOptions,
): Promise<HunterShadowOperationalEvidence> {
  const startedAt = new Date().toISOString();
  const core = new KairoService(options.store);
  const planStore = new PgBrandDiscoveryPlanRepository(options.pool);
  const closedLoop = new PgHunterClosedLoopStore(options.pool);
  const candidates = await listCandidateBrands(options.pool, Math.max(30, options.request.brandCount * 10));
  const baseContexts: Array<{
    accountId: string;
    workspaceId: string;
    brandId: string;
    origin: "persisted" | "disposable-persisted" | "ephemeral-public";
    context: Omit<HunterShadowExecutionContext, "referenceTime">;
  }> = [];

  for (const candidate of candidates) {
    if (baseContexts.length >= options.request.brandCount) break;
    const context = await loadReadOnlyBrandContext({
      pool: options.pool,
      core,
      discovery: options.discovery,
      planStore,
      closedLoop,
      accountId: candidate.accountId,
      brandId: candidate.brandId,
    }).catch(() => undefined);
    if (!context) continue;
    baseContexts.push({
      accountId: candidate.accountId,
      workspaceId: candidate.workspaceId,
      brandId: candidate.brandId,
      origin: "persisted",
      context,
    });
  }

  let disposableAnchor: { accountId: string; brandId: string } | undefined;
  if (
    baseContexts.length < 1 &&
    options.request.allowDisposablePersistedAnchor
  ) {
    const anchorCandidates = options.request.anchorBrandId
      ? await listTargetBrandCandidates(options.pool, options.request.anchorBrandId)
      : candidates;
    const tenant = selectDisposableAnchorTenant(
      anchorCandidates,
      options.request.anchorBrandId,
    );
    const disposable = await createDisposablePersistedAnchor({
      ...tenant,
      pool: options.pool,
      store: options.store,
      discovery: options.discovery,
      planStore,
      closedLoop,
      runtime: options.runtime,
    });
    disposableAnchor = {
      accountId: disposable.accountId,
      brandId: disposable.brandId,
    };
    baseContexts.push({
      accountId: disposable.accountId,
      workspaceId: disposable.workspaceId,
      brandId: disposable.brandId,
      origin: "disposable-persisted",
      context: disposable.context,
    });
  }

  const persistedBrandCount = baseContexts.filter(
    (item) => item.origin === "persisted" || item.origin === "disposable-persisted",
  ).length;
  if (persistedBrandCount < 1) {
    throw new Error(
      "Hunter shadow evidence requires at least one persisted Hunter-ready Brand",
    );
  }

  try {
  if (
    baseContexts.length < options.request.brandCount &&
    options.request.allowEphemeralPublicBrands
  ) {
    const ephemeral = await buildEphemeralPublicBrandContexts({
      runtime: options.runtime,
      limit: options.request.brandCount - baseContexts.length,
    });
    for (const item of ephemeral) {
      if (baseContexts.length >= options.request.brandCount) break;
      baseContexts.push({
        accountId: item.context.accountId,
        workspaceId: item.workspaceId,
        brandId: item.brandId,
        origin: "ephemeral-public",
        context: item.context,
      });
    }
  }

  if (baseContexts.length < options.request.brandCount) {
    throw new Error(
      "Hunter shadow evidence could not find enough Hunter-ready Brands",
    );
  }

  const contexts = new Map<string, HunterShadowExecutionContext>();
  const runs: HunterShadowRunCase[] = [];
  for (const [brandIndex, item] of baseContexts.entries()) {
    const brandKey = opaqueBrandKey(item.workspaceId, item.brandId);
    for (let index = 0; index < options.request.runsPerBrand; index += 1) {
      const comparisonId =
        options.request.runId + ":" + brandKey + ":" + String(index + 1).padStart(2, "0");
      const referenceTime = new Date().toISOString();
      const context: HunterShadowExecutionContext = {
        ...item.context,
        referenceTime,
        hunterInput: {
          ...item.context.hunterInput,
          refreshSeed: referenceTime,
        },
      };
      const inputFingerprint = contextFingerprint({
        releaseSha: options.request.releaseSha,
        comparisonId,
        brandIndex,
        brandId: item.brandId,
        workspaceId: item.workspaceId,
        contextVersion: context.hunterInput.brand.contextVersion,
        planVersion: context.discoveryPlan.planVersion,
        preferenceSnapshotVersion: context.preferenceState?.snapshotVersion ?? null,
        referenceTime,
      });
      contexts.set(comparisonId, context);
      runs.push({
        comparisonId,
        workspaceId: item.workspaceId,
        brandId: item.brandId,
        inputFingerprint,
      });
    }
  }

  const executor = new ReadOnlyHunterShadowLaneExecutor({
    loadContext: async (run) => {
      const context = contexts.get(run.comparisonId);
      if (!context) throw new Error("Hunter shadow context is unavailable");
      return context;
    },
    tools: options.tools,
    runtime: options.runtime,
    sourceRegistry: options.sourceRegistry,
    searchCostUsdBySource: options.searchCostUsdBySource ?? {},
    candidate: HUNTER_SHADOW_OPERATIONAL_CANDIDATE_PROFILE,
  });
  const batch = await runHunterShadowEvidenceBatch(runs, executor);
  return redactOperationalEvidence(
    options.request,
    startedAt,
    new Date().toISOString(),
    batch,
    {
      persistedBrands: baseContexts.filter((item) => item.origin === "persisted").length,
      disposablePersistedBrands: baseContexts.filter((item) => item.origin === "disposable-persisted").length,
      ephemeralPublicBrands: baseContexts.filter((item) => item.origin === "ephemeral-public").length,
    },
  );
  } finally {
    if (disposableAnchor) {
      await deleteDisposableBrand(
        options.store,
        disposableAnchor.accountId,
        disposableAnchor.brandId,
      );
    }
  }
}


export function selectDisposableAnchorTenant(
  candidates: ReadonlyArray<{ accountId: string; workspaceId: string; brandId: string }>,
  anchorBrandId?: string,
): { accountId: string; workspaceId: string } {
  const matching = anchorBrandId
    ? candidates.filter((item) => item.brandId === anchorBrandId)
    : [...candidates];
  if (!matching.length) {
    throw new Error(
      anchorBrandId
        ? "Target Hunter shadow anchor Brand is unavailable or has no active workspace membership"
        : "Disposable persisted Hunter shadow anchor requires an existing persisted Brand",
    );
  }
  const workspaceIds = [...new Set(matching.map((item) => item.workspaceId))];
  if (workspaceIds.length !== 1) {
    throw new Error(
      anchorBrandId
        ? "Target Hunter shadow anchor Brand resolved to an ambiguous workspace"
        : "Disposable persisted Hunter shadow anchor requires one unambiguous workspace",
    );
  }
  const workspaceId = workspaceIds[0]!;
  const accountId = [...new Set(
    matching
      .filter((item) => item.workspaceId === workspaceId)
      .map((item) => item.accountId),
  )].sort()[0];
  if (!accountId) {
    throw new Error("Disposable persisted Hunter shadow anchor has no active account");
  }
  return { accountId, workspaceId };
}

async function createDisposablePersistedAnchor(input: {
  accountId: string;
  workspaceId: string;
  pool: Pool;
  store: KairoRepository;
  discovery: DiscoveryService;
  planStore: PgBrandDiscoveryPlanRepository;
  closedLoop: PgHunterClosedLoopStore;
  runtime: AgentRuntimePort;
}): Promise<{
  accountId: string;
  workspaceId: string;
  brandId: string;
  context: Omit<HunterShadowExecutionContext, "referenceTime">;
}> {
  const creator = new PgBrandCreator(input.pool);
  const brand = await creator.createBrand(
    input.accountId,
    input.workspaceId,
    {
      brandName: "Vercel",
      publicSourceUrl: "https://vercel.com/about",
    },
  );

  try {
    const bootstrap = new BrandBrainBootstrapService(
      input.store,
      new BrandBrainBuilder(input.runtime),
      new SanitizingPublicBrandReferenceReader(
        new SourceIntelligenceBrandReferenceReader(),
      ),
    );
    await bootstrap.build(input.accountId, brand.id, {
      publicReferenceUrl: "https://vercel.com/legal/acceptable-use-policy",
    });
    await ensureDisposableVercelCanonicalFields(
      input.store,
      input.accountId,
      brand.id,
    );
    const core = new KairoService(input.store);
    const context = await loadReadOnlyBrandContext({
      pool: input.pool,
      core,
      discovery: input.discovery,
      planStore: input.planStore,
      closedLoop: input.closedLoop,
      accountId: input.accountId,
      brandId: brand.id,
    });
    if (!context) {
      throw new Error(
        "Disposable persisted Vercel Brand did not satisfy canonical Hunter readiness",
      );
    }
    return {
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      brandId: brand.id,
      context,
    };
  } catch (error) {
    await deleteDisposableBrand(input.store, input.accountId, brand.id);
    throw error;
  }
}



export function disposableVercelCanonicalFields(
  aboutSourceId: string,
  policySourceId: string,
): ReadonlyArray<{
  section: "identity" | "audience" | "positioning" | "content-strategy" | "boundaries";
  fieldKey: string;
  value: string;
  sourceIds: string[];
}> {
  return [
    {
      section: "identity",
      fieldKey: "identity.description",
      value: "Vercel provides infrastructure where humans and agents build and ship software together.",
      sourceIds: [aboutSourceId],
    },
    {
      section: "identity",
      fieldKey: "identity.products-services",
      value: "Infrastructure and platform services for building and shipping applications and agents.",
      sourceIds: [aboutSourceId],
    },
    {
      section: "audience",
      fieldKey: "audience.primary",
      value: "Developers and software teams building applications and agents.",
      sourceIds: [aboutSourceId],
    },
    {
      section: "positioning",
      fieldKey: "positioning.value-proposition",
      value: "Infrastructure designed to help humans and agents build and ship software.",
      sourceIds: [aboutSourceId],
    },
    {
      section: "content-strategy",
      fieldKey: "content.core-topics",
      value: "Application development, agents, developer infrastructure, deployment, and software delivery.",
      sourceIds: [aboutSourceId],
    },
    {
      section: "boundaries",
      fieldKey: "boundaries.excluded-topics",
      value: "Unlawful, fraudulent, deceptive, abusive, violent, exploitative, spam, and security-circumvention uses prohibited by Vercel's Acceptable Use Policy.",
      sourceIds: [policySourceId],
    },
  ];
}

async function ensureDisposableVercelCanonicalFields(
  store: KairoRepository,
  accountId: string,
  brandId: string,
): Promise<void> {
  const sources = await store.listKnowledgeSources(accountId, brandId);
  const about = sources.find(
    (source) =>
      source.status === "active" &&
      source.sourceUrl?.includes("vercel.com/about"),
  );
  const policy = sources.find(
    (source) =>
      source.status === "active" &&
      source.sourceUrl?.includes("vercel.com/legal/acceptable-use-policy"),
  );
  if (!about || !policy) {
    throw new Error(
      "Disposable persisted Vercel Brand is missing required verified public sources",
    );
  }

  const existingByKey = new Map(
    (await store.listBrandBrainFields(accountId, brandId)).map((field) => [
      field.fieldKey,
      field,
    ]),
  );
  for (const field of disposableVercelCanonicalFields(about.id, policy.id)) {
    const existing = existingByKey.get(field.fieldKey);
    const written = await store.recordInferredBrandBrainField(
      accountId,
      brandId,
      {
        section: field.section,
        fieldKey: field.fieldKey,
        value: field.value,
        sourceIds: field.sourceIds,
        ...(existing ? { expectedVersion: existing.version } : {}),
      },
    );
    existingByKey.set(field.fieldKey, written);
  }

  const activation = createBrandBrainActivationSnapshot(
    await store.listBrandBrainFields(accountId, brandId),
    await store.listKnowledgeSources(accountId, brandId),
  );
  if (!activation.hunterReady) {
    throw new Error(
      "Disposable persisted Vercel Brand did not satisfy canonical Hunter readiness after source-backed fixture repair: gaps=" +
        activation.readiness.gaps.join(",") +
        "; weak=" +
        activation.weakFields.join(","),
    );
  }
}

async function deleteDisposableBrand(
  store: KairoRepository,
  accountId: string,
  brandId: string,
): Promise<void> {
  if (!store.deleteBrand) {
    throw new Error(
      "Disposable persisted Hunter shadow anchor cleanup is unsupported by the repository",
    );
  }
  await store.deleteBrand(accountId, brandId);
}

export function resolveReadOnlyDiscoveryPlan(
  current: BrandDiscoveryPlan | undefined,
  snapshot: BrandIntelligenceSnapshot,
): BrandDiscoveryPlan {
  if (!current) return projectInitialBrandDiscoveryPlan(snapshot, 1);
  if (
    current.snapshotVersion === snapshot.snapshotVersion ||
    current.state === "customized"
  ) {
    return current;
  }
  return projectInitialBrandDiscoveryPlan(snapshot, current.revision + 1);
}

async function loadReadOnlyBrandContext(input: {
  pool: Pool;
  core: KairoService;
  discovery: DiscoveryService;
  planStore: PgBrandDiscoveryPlanRepository;
  closedLoop: PgHunterClosedLoopStore;
  accountId: string;
  brandId: string;
}): Promise<Omit<HunterShadowExecutionContext, "referenceTime"> | undefined> {
  const brand = await input.core.getBrand(input.accountId, input.brandId);
  const [brain, sources] = await Promise.all([
    input.core.listBrandBrain(input.accountId, brand.id),
    input.core.listKnowledgeSources(input.accountId, brand.id),
  ]);
  const activation = createBrandBrainActivationSnapshot(brain, sources);
  const snapshot = projectBrandIntelligenceSnapshot({
    brand,
    fields: brain,
    sources,
    activation,
  });
  if (!snapshot.hunterReady) return undefined;

  const currentPlan = await input.planStore.getLatest(input.accountId, brand.id);
  const discoveryPlan = resolveReadOnlyDiscoveryPlan(currentPlan, snapshot);
  if (!discoveryPlan.topics.length) return undefined;

  const baseProfile = projectBrandIntelligenceProfile(brain);
  const intelligenceProfile = applyDiscoveryPlan(baseProfile, discoveryPlan);
  const pack = selectSectorIntelligencePack(intelligenceProfile);
  const intelligenceGraph = buildTopicGraph(brain, topicGraphPack(pack.id));
  const [existingOpportunities, learnedContext, preferenceState] = await Promise.all([
    input.discovery.list(input.accountId, brand.id),
    input.closedLoop.learningContext(input.accountId, brand.id),
    readPreferenceState(input.pool, brand.workspaceId, brand.id),
  ]);
  const projectedBrand = projectBrandContext(snapshot, discoveryPlan);

  const hunterInput: HunterRunInput = {
    accountId: input.accountId,
    brand: learnedContext
      ? {
          ...projectedBrand,
          goals: mergeClosedLoopContext(projectedBrand.goals, learnedContext),
        }
      : projectedBrand,
    intelligenceProfile,
    intelligenceGraph,
    maxEvidence: 20,
    ...(existingOpportunities.length
      ? {
          existingOpportunityTitles: existingOpportunities
            .map((item) => item.title)
            .slice(0, 100),
        }
      : {}),
    snapshotVersion: snapshot.snapshotVersion,
    planVersion: discoveryPlan.planVersion,
  };

  return {
    accountId: input.accountId,
    hunterInput,
    discoveryPlan,
    ...(preferenceState ? { preferenceState } : {}),
  };
}


async function listTargetBrandCandidates(
  pool: Pool,
  brandId: string,
): Promise<Array<{ accountId: string; workspaceId: string; brandId: string }>> {
  const result = await pool.query<{
    account_id: string;
    workspace_id: string;
    brand_id: string;
  }>(
    `select m.account_id,b.workspace_id,b.id as brand_id
       from brands b
       join workspace_memberships m on m.workspace_id=b.workspace_id
      where b.id=$1 and m.active=true
      order by m.account_id`,
    [brandId],
  );
  return result.rows.map((row) => ({
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
  }));
}

async function listCandidateBrands(
  pool: Pool,
  limit: number,
): Promise<Array<{ accountId: string; workspaceId: string; brandId: string }>> {
  const result = await pool.query<{
    account_id: string;
    workspace_id: string;
    brand_id: string;
  }>(
    `select distinct on (b.id)
       m.account_id,b.workspace_id,b.id as brand_id
       from brands b
       join workspace_memberships m on m.workspace_id=b.workspace_id
      where m.active=true
      order by b.id,m.account_id
      limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
  }));
}

async function readPreferenceState(
  pool: Pool,
  workspaceId: string,
  brandId: string,
): Promise<BrandPreferenceState | undefined> {
  const result = await pool.query<{ state: BrandPreferenceState }>(
    `select state from brand_preference_states
      where workspace_id=$1 and brand_id=$2`,
    [workspaceId, brandId],
  ).catch(() => ({ rows: [] as Array<{ state: BrandPreferenceState }> }));
  const state = result.rows[0]?.state;
  if (!state || state.schemaVersion !== "1") return undefined;
  const { schemaVersion: _schemaVersion, ...input } = state;
  try {
    return prepareBrandPreferenceState(input);
  } catch {
    return undefined;
  }
}

function redactOperationalEvidence(
  request: HunterShadowOperationalRequest,
  startedAt: string,
  completedAt: string,
  batch: HunterShadowEvidenceBatch,
  cohort: { persistedBrands: number; disposablePersistedBrands: number; ephemeralPublicBrands: number },
): HunterShadowOperationalEvidence {
  return {
    schemaVersion: 1,
    evidenceKind: "hunter-v2-shadow-operational",
    runId: request.runId,
    releaseSha: request.releaseSha,
    startedAt,
    completedAt,
    brandCount: batch.readiness.metrics.shadowBrands,
    pairCount: batch.pairs.length,
    cohort,
    costScope: "model-plus-configured-search",
    readiness: batch.readiness,
    observations: batch.pairs.map((pair) => ({
      comparisonId: pair.pair.comparisonId,
      brandKey: opaqueBrandKey(pair.pair.workspaceId, pair.pair.brandId),
      v1QualityScore: pair.observation.v1QualityScore,
      v2QualityScore: pair.observation.v2QualityScore,
      retrievalCoverage: pair.observation.retrievalCoverage,
      v1LatencyMs: pair.observation.v1LatencyMs,
      v2LatencyMs: pair.observation.v2LatencyMs,
      v1CostUsd: pair.observation.v1CostUsd,
      v2CostUsd: pair.observation.v2CostUsd,
      v2Failure: pair.observation.v2Failure,
      explorationShare: pair.observation.explorationShare,
      maximumTopicShare: pair.observation.maximumTopicShare,
      ...(pair.observation.criticalViolations?.length
        ? { criticalViolations: [...pair.observation.criticalViolations] }
        : {}),
    })),
  };
}

function projectBrandContext(
  snapshot: BrandIntelligenceSnapshot,
  plan: BrandDiscoveryPlan,
): HunterRunInput["brand"] {
  const context = snapshot.context;
  return {
    workspaceId: snapshot.workspaceId,
    brandId: snapshot.brandId,
    contextVersion: snapshot.snapshotVersion + "|" + plan.planVersion,
    brandName: snapshot.brandName,
    ...(context.positioning ? { positioning: context.positioning } : {}),
    ...(context.audience ? { audience: context.audience } : {}),
    ...(context.voice ? { voice: context.voice } : {}),
    ...(context.goals ? { goals: context.goals } : {}),
    ...(context.boundaries ? { boundaries: context.boundaries } : {}),
  };
}

function applyDiscoveryPlan(
  profile: BrandIntelligenceProfile,
  plan: BrandDiscoveryPlan,
): BrandIntelligenceProfile {
  const topicNames = unique(plan.topics.map((topic) => topic.name));
  const topicAudiences = unique(plan.topics.map((topic) => topic.audience));
  const sourceClasses = unique(plan.topics.flatMap((topic) => topic.sourceClasses));
  return {
    ...profile,
    topics: topicNames.length ? topicNames : profile.topics,
    audiences: unique([...topicAudiences, ...profile.audiences]),
    excludedTopics: unique([...plan.excludedTopics, ...profile.excludedTopics]),
    ...(sourceClasses.length
      ? { sourceClasses }
      : profile.sourceClasses?.length
        ? { sourceClasses: profile.sourceClasses }
        : {}),
  };
}

function mergeClosedLoopContext(
  existing: string | undefined,
  learnedContext: string,
): string {
  const prefix = existing?.trim() ? existing.trim() + "\n\n" : "";
  return (
    prefix +
    "Closed-loop learning (use as guidance, not as public evidence):\n" +
    learnedContext
  ).slice(0, 8_000);
}

function topicGraphPack(packId: string): SectorPackId {
  if (packId === "ai-technology") return "ai-tech";
  if (packId === "umrah-religious-travel") return "umrah";
  if (packId === "ias-upsc-education") return "ias-upsc";
  if (packId === "motorcycles") return "motorcycles";
  return "generic";
}

function opaqueBrandKey(workspaceId: string, brandId: string): string {
  return createHash("sha256")
    .update(workspaceId + ":" + brandId)
    .digest("hex")
    .slice(0, 16);
}

function contextFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  field: string,
  min: number,
  max: number,
): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(field + " must be an integer from " + min + " to " + max);
  }
  return value;
}
