import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  AgentRuntimeResult,
  DiscoveryEvidence,
  ToolGatewayPort,
  ToolRequest,
  ToolResult,
} from "@kairo/agent-contracts";
import {
  createCampaign,
  createContentAsset,
  createInitialContentVersion,
  type ContentAsset,
} from "@kairo/domain/campaign";
import type { MarketingCreativePlan } from "@kairo/domain/creative-formats";
import {
  createMetricSnapshot,
  normalizeMetricSnapshot,
  type MetricName,
  type NormalizedMetric,
} from "@kairo/domain/analytics";
import { createCandidateLearning } from "@kairo/domain/learning";
import {
  applyPublishAttempt,
  beginPublishAttempt,
  connectChannelAccount,
  createPublishCommand,
  createPublishedPost,
  reconcilePublishAttempt,
  retryPublishCommand,
} from "@kairo/domain/publishing";
import {
  createIdea,
  createResearchDossier,
  selectAngle,
  type Angle,
  type ResearchDossier,
} from "@kairo/domain/research";
import {
  approveContentVersion,
  completeContentReview,
  evaluateTruthGate,
  requestContentReview,
} from "@kairo/domain/review";
import type { BrandIntelligenceProfile } from "@kairo/domain/source-policy";
import { CreativeAssetProductionService, type CreativeObjectStorePort, type StoredCreativePackage } from "./creative-renderer";
import { DrafterOrchestrator, type DrafterOutput } from "./drafter";
import { HunterOrchestrator, type HunterJudgmentOutput } from "./hunter";
import {
  PublishableCreativeMediaService,
  type PrivateCreativeObject,
  type PrivateCreativeObjectDescriptor,
  type PublishableCreativeStorePort,
  type ReelEncoderPort,
} from "./publishable-media";
import { CriticOrchestrator } from "./reviewer";
import { StrategistOrchestrator, type StrategistOutput } from "./strategist";

export type PilotSector = "ai-saas" | "umrah-travel" | "motorcycles" | "ias-upsc";
export type PilotFormat = "carousel" | "reel";
export type PilotCheckpointStatus = "pass" | "fail" | "external";

export interface PilotCheckpoint {
  id: string;
  status: PilotCheckpointStatus;
  code?: string;
  detail?: string;
}

export interface PilotScenarioResult {
  scenarioId: string;
  sector: PilotSector;
  format: PilotFormat;
  status: "pass" | "fail";
  mandatory: PilotCheckpoint[];
  external: PilotCheckpoint[];
  metricSummary: Array<Pick<NormalizedMetric, "name" | "status" | "value" | "reason">>;
  lineage: {
    workspaceId: string;
    brandId: string;
    ideaId: string;
    researchId: string;
    angleId: string;
    campaignId: string;
    contentVersionId: string;
    publishedPostId: string;
    metricObservationIds: string[];
    learningId: string;
  };
  cost: { maxModeledUsd: number };
  elapsedMs: number;
}

export interface PilotReadinessReport {
  status: "pass" | "fail";
  scenarios: PilotScenarioResult[];
}

export interface PilotReadinessOptions {
  injectCrossBrandReuse?: boolean;
  omitOptionalMetric?: boolean;
}

interface Fixture {
  sector: PilotSector;
  format: PilotFormat;
  sectorLabel: string;
  topic: string;
  geography: string;
  audience: string;
}

const FIXTURES: Fixture[] = [
  { sector: "ai-saas", format: "carousel", sectorLabel: "AI / SaaS / Developer Technology", topic: "AI agents", geography: "global", audience: "technical founders" },
  { sector: "umrah-travel", format: "reel", sectorLabel: "Umrah / Religious Travel", topic: "Umrah guidance", geography: "India", audience: "first time pilgrims" },
  { sector: "motorcycles", format: "carousel", sectorLabel: "Motorcycles / Bikes", topic: "motorcycle safety", geography: "India", audience: "motorcycle riders" },
  { sector: "ias-upsc", format: "reel", sectorLabel: "IAS / UPSC Education", topic: "UPSC current affairs", geography: "India", audience: "civil services learners" },
];

const BASE_TIME = new Date("2026-08-15T16:30:00.000Z");
const MAX_MODELED_USD = 0.45;

export async function runDeterministicPilotMatrix(options: PilotReadinessOptions = {}): Promise<PilotReadinessReport> {
  const scenarios: PilotScenarioResult[] = [];
  for (let index = 0; index < FIXTURES.length; index += 1) {
    scenarios.push(await runScenario(FIXTURES[index]!, index, options));
  }
  return { status: scenarios.every((scenario) => scenario.status === "pass") ? "pass" : "fail", scenarios };
}

async function runScenario(fixture: Fixture, index: number, options: PilotReadinessOptions): Promise<PilotScenarioResult> {
  const started = Date.now();
  const scenarioId = `pilot-${fixture.sector}`;
  const workspaceId = `workspace-${index + 1}`;
  const brandId = `brand-${index + 1}`;
  const accountId = `account-${index + 1}`;
  const contextVersion = `${brandId}@1`;
  const mandatory: PilotCheckpoint[] = [];
  const external: PilotCheckpoint[] = [
    { id: "auth0-live-callback", status: "external", code: "requires-deployed-auth0" },
    { id: "meta-live-publish-insights", status: "external", code: "requires-meta-production-credentials" },
  ];

  const evidence: DiscoveryEvidence = {
    title: `${fixture.topic} evidence`,
    summary: `Public evidence for ${fixture.topic}`,
    sourceUrl: `https://example.com/${fixture.sector}/evidence`,
    platform: "web",
    retrievedAt: BASE_TIME.toISOString(),
    provider: "fixture-public",
    providerVersion: "vs21",
  };
  const hunterTools = new StaticTools([evidence]);
  const hunterRuntime = new StaticRuntime<HunterJudgmentOutput>({ candidates: [{
    sourceUrl: evidence.sourceUrl,
    title: `${fixture.topic} opportunity`,
    rationale: "Relevant to the configured audience",
    whyNow: "The supplied public evidence is current",
    developmentDirection: "Explain one evidence backed practical implication",
    scores: { relevance: 0.9, evidence: 0.9, novelty: 0.75, timeliness: 0.8, brandAuthority: 0.8, audienceFit: 0.9 },
  }] });
  const opportunityId = `opportunity-${index + 1}`;
  const hunterSink = {
    async recordCandidate() {
      return { signal: { id: `signal-${index + 1}` }, opportunity: { id: opportunityId } } as never;
    },
  };
  const profile: BrandIntelligenceProfile = {
    sector: fixture.sectorLabel,
    geographies: [fixture.geography],
    languages: ["English"],
    audiences: [fixture.audience],
    topics: [fixture.topic],
    excludedTopics: [],
    goals: ["educate"],
  };
  const hunter = await new HunterOrchestrator(hunterTools, hunterRuntime, hunterSink as never).runForAuthorizedBrand({
    accountId,
    brand: { workspaceId, brandId, contextVersion, brandName: `Pilot ${fixture.sector}`, audience: fixture.audience },
    intelligenceProfile: profile,
  });
  mandatory.push(check("discover-evidence-opportunity", hunter.evidenceCount > 0 && hunter.opportunityCount === 1, "hunter-did-not-produce-evidence-linked-opportunity"));
  mandatory.push(check("brand-private-agent-scope", hunterRuntime.lastRequest?.scope.visibility === "brand-private" && hunterRuntime.lastRequest.scope.workspaceId === workspaceId && hunterRuntime.lastRequest.scope.brandId === brandId, "agent-scope-mismatch"));

  const idea = createIdea({
    id: `idea-${index + 1}`, workspaceId, brandId, title: `${fixture.topic} idea`, premise: "Develop the evidence into useful content",
    source: { type: "opportunity", opportunityId }, createdAt: plusSeconds(10),
  });
  const claimId = `claim-${index + 1}`;
  const research: ResearchDossier = createResearchDossier({
    id: `research-${index + 1}`, workspaceId, brandId, ideaId: idea.id,
    summary: `Evidence backed research for ${fixture.topic}`,
    evidence: [{ id: `evidence-${index + 1}`, sourceUrl: evidence.sourceUrl, sourceTitle: evidence.title, retrievedAt: evidence.retrievedAt }],
    claims: [{
      id: claimId, text: `A supported fact about ${fixture.topic}`, classification: "fact", confidence: 0.9,
      evidenceStrength: "strong", verificationState: "supported", freshness: "fresh",
      evidenceIds: [`evidence-${index + 1}`], firstPersonAuthorization: "not-applicable",
    }],
    unresolvedUncertainties: ["Long term outcome remains uncertain"], createdAt: plusSeconds(20),
    runtimeProvenance: { runtime: "fixture", costUsd: 0.02, latencyMs: 2 },
  });
  mandatory.push(check("research-claim-lineage", research.ideaId === idea.id && research.claims[0]?.evidenceIds[0] === research.evidence[0]?.id, "research-lineage-broken"));
  mandatory.push(check("research-uncertainty", research.unresolvedUncertainties.length > 0, "research-uncertainty-missing"));

  const strategistSink = new AngleCollector();
  const strategist = new StrategistOrchestrator(new StaticRuntime<StrategistOutput>({ candidates: [
    candidateAngle("Practical angle", fixture, claimId),
    candidateAngle("Educational angle", fixture, claimId),
  ] }), strategistSink);
  await strategist.run({ accountId, workspaceId, brandId, brandContextVersion: contextVersion, idea: { id: idea.id, title: idea.title, premise: idea.premise }, research });
  const selectedAngles = selectAngle(strategistSink.angles, strategistSink.angles[0]!.id);
  const angle = selectedAngles.find((item) => item.status === "selected")!;
  mandatory.push(check("strategy-selected-angle", Boolean(angle) && angle.supportingClaimIds.includes(claimId), "angle-lineage-broken"));

  const campaign = createCampaign({
    id: `campaign-${index + 1}`, name: `${fixture.topic} campaign`, objective: "Teach one useful evidence backed idea",
    lineage: { workspaceId, brandId, ideaId: idea.id, researchId: research.id, angleId: angle.id, angleStatus: angle.status, supportingClaimIds: angle.supportingClaimIds },
    createdAt: plusSeconds(30),
  });
  const asset = createContentAsset({
    id: `asset-${index + 1}`, campaign, channel: "instagram", format: fixture.format, audience: fixture.audience,
    topic: fixture.topic, hookType: "educational", cta: "Learn more", createdAt: plusSeconds(35),
  });
  const v1 = createInitialContentVersion({
    id: `version-${index + 1}-1`, asset, content: "Evidence backed initial draft", supportingClaimIds: [claimId], actor: "ai", action: "initial-draft", createdAt: plusSeconds(40),
    provenance: { runtime: "fixture", costUsd: 0.02, latencyMs: 2 },
  });
  const currentAsset: ContentAsset = { ...asset, currentVersion: 1 };
  const drafter = new DrafterOrchestrator(new StaticRuntime<DrafterOutput>({ content: "Evidence backed final draft", supportingClaimIds: [claimId] }));
  const v2 = await drafter.run({
    workspaceId, brandId, brandContextVersion: contextVersion, campaign: { id: campaign.id, name: campaign.name, objective: campaign.objective },
    asset: currentAsset, parent: v1, action: "strengthen-opening", claims: research.claims.map((claim) => ({ id: claim.id, text: claim.text, classification: claim.classification, verificationState: claim.verificationState })),
  });
  mandatory.push(check("content-version-lineage", v2.parentVersionId === v1.id && v2.campaignId === campaign.id && v2.supportingClaimIds.includes(claimId), "content-version-lineage-broken"));

  const scope = { workspaceId, brandId, campaignId: campaign.id, assetId: asset.id, versionId: v2.id, version: v2.version };
  const hardFailTruth = evaluateTruthGate({ ...scope, claimUses: [{ claimId, factual: true, supported: false, fresh: true, firstPerson: false, brandAuthorized: false, attributionRequired: false, attributionPresent: true }], prohibitedBrandLanguage: [] });
  const truth = evaluateTruthGate({ ...scope, claimUses: [{ claimId, factual: true, supported: true, fresh: true, firstPerson: false, brandAuthorized: false, attributionRequired: false, attributionPresent: true }], prohibitedBrandLanguage: [] });
  mandatory.push(check("truth-hard-gate", !hardFailTruth.passed && truth.passed, "truth-gate-did-not-fail-closed"));
  const requestedReview = requestContentReview({ id: `review-${index + 1}`, ...scope, truth, requestedAt: plusSeconds(50) });
  const critic = await new CriticOrchestrator(new StaticRuntime({ passed: true, score: 91, findings: [] })).run({ workspaceId, brandId, brandContextVersion: contextVersion, version: { id: v2.id, content: v2.content, supportingClaimIds: v2.supportingClaimIds }, claims: research.claims.map((claim) => ({ id: claim.id, text: claim.text })), rubric: ["truth", "brand fit", "clarity"] });
  const review = completeContentReview({ review: requestedReview, critic, revisionCycle: 0, completedAt: plusSeconds(55) });
  let staleRejected = false;
  try {
    approveContentVersion({ id: `approval-stale-${index + 1}`, review, currentVersionId: v1.id, approverAccountId: accountId, destination: { channel: "instagram", accountRef: `ig-${index + 1}` }, approvedAt: plusSeconds(60) });
  } catch { staleRejected = true; }
  const approval = approveContentVersion({ id: `approval-${index + 1}`, review, currentVersionId: v2.id, approverAccountId: accountId, destination: { channel: "instagram", accountRef: `ig-${index + 1}` }, approvedAt: plusSeconds(60) });
  mandatory.push(check("exact-version-human-approval", staleRejected && approval.versionId === v2.id && approval.approverAccountId === accountId, "approval-version-authority-broken"));

  const store = new InMemoryCreativeStore();
  const production = new CreativeAssetProductionService(store);
  const plan = creativePlan(fixture.format, claimId);
  const stored = await production.produce({ workspaceId, brandId }, plan);
  const publishableService = new PublishableCreativeMediaService(store, new FixtureReelEncoder(), { clock: () => new Date(BASE_TIME), publishingTtlSeconds: 600 });

  let crossBrandRejected = false;
  try { await publishableService.prepare({ workspaceId, brandId: `${brandId}-other` }, stored, { contentVersionId: v2.id }); }
  catch { crossBrandRejected = true; }
  if (options.injectCrossBrandReuse && index === 0) {
    mandatory.push({ id: "cross-brand-isolation", status: "fail", code: "cross-brand-media-reuse-rejected", detail: crossBrandRejected ? "Injected cross-Brand journey was rejected as required" : "Injected cross-Brand journey unexpectedly succeeded" });
  } else {
    mandatory.push(check("cross-brand-isolation", crossBrandRejected, "cross-brand-media-reuse-allowed"));
  }

  const prepared = await publishableService.prepare({ workspaceId, brandId }, stored, { contentVersionId: v2.id });
  mandatory.push(check("creative-publishable-lineage", prepared.brandId === brandId && prepared.contentVersionId === v2.id && prepared.supportingClaimIds.includes(claimId) && prepared.objects.every((object) => object.contentHash.length === 64), "creative-publishable-lineage-broken"));

  const channel = connectChannelAccount({
    id: `channel-${index + 1}`, workspaceId, brandId, channel: "instagram", accountRef: `ig-${index + 1}`, displayName: `Pilot Instagram ${index + 1}`,
    credentialRef: `credential-ref-${index + 1}`, capabilities: fixture.format === "reel" ? ["publish-reel"] : ["publish-carousel"], connectedAt: plusSeconds(65),
  });
  const command = createPublishCommand({
    id: `publish-${index + 1}`, approval, currentVersionId: v2.id, channelAccount: channel, contentType: fixture.format,
    mediaItems: prepared.mediaItems, options: fixture.format === "reel" ? { instagram: { shareToFeed: true } } : undefined,
    scheduledFor: plusSeconds(75), createdAt: plusSeconds(70),
  });
  const attempt = beginPublishAttempt({ id: `attempt-${index + 1}`, command, startedAt: plusSeconds(76) });
  const publishedAttempt = reconcilePublishAttempt({ attempt, outcome: "published", checkedAt: plusSeconds(80), externalPostId: `external-${index + 1}`, providerCorrelationId: `provider-${index + 1}` });
  const publishedCommand = applyPublishAttempt(command, publishedAttempt);
  const published = createPublishedPost({ id: `post-${index + 1}`, command: publishedCommand, attempt: publishedAttempt });
  mandatory.push(check("publishing-idempotency-lineage", attempt.idempotencyKey.includes(command.id) && published.versionId === v2.id && published.brandId === brandId, "publishing-lineage-broken"));

  const unknownAttempt = reconcilePublishAttempt({ attempt: beginPublishAttempt({ id: `unknown-attempt-${index + 1}`, command, startedAt: plusSeconds(77) }), outcome: "unknown", checkedAt: plusSeconds(78), providerCorrelationId: `unknown-provider-${index + 1}` });
  const unknownCommand = applyPublishAttempt(command, unknownAttempt);
  let unknownRetryRejected = false;
  try { retryPublishCommand(unknownCommand, plusSeconds(79)); } catch { unknownRetryRejected = true; }
  mandatory.push(check("publishing-recovery", unknownRetryRejected, "unknown-publication-was-blindly-retried"));

  const raw: Record<string, unknown> = { impressions: 120, likes: 18, ...(options.omitOptionalMetric ? {} : { saves: 12 }) };
  const snapshot = createMetricSnapshot({ id: `snapshot-${index + 1}`, post: published, provider: "instagram", capturedAt: plusSeconds(120), raw, providerRequestId: `metric-request-${index + 1}` });
  const metrics = normalizeMetricSnapshot(snapshot, { version: "instagram-vs21", supported: { impressions: "impressions", likes: "likes", saves: "saves" }, unavailableReason: "provider-did-not-return" });
  const saves = metrics.find((metric) => metric.name === "saves");
  mandatory.push(check("metric-provenance", metrics.every((metric) => metric.brandId === brandId && metric.sourceSnapshotId === snapshot.id) && Boolean(saves) && (options.omitOptionalMetric ? saves?.status === "unavailable" && saves.value === undefined : saves?.status === "available"), "metric-provenance-or-unavailable-state-broken"));

  const learning = createCandidateLearning({
    id: `learning-${index + 1}`, workspaceId, brandId,
    statement: `Educational ${fixture.format} content is a candidate pattern for this Brand`,
    interpretation: "The observed engagement may be associated with this framing and does not prove causation",
    confidence: 0.6, period: { from: published.publishedAt, to: snapshot.capturedAt }, applicability: { channel: "instagram", audience: fixture.audience },
    evidence: [{ publishedPostId: published.id, metricObservationIds: metrics.map((metric) => metric.id) }], createdAt: plusSeconds(130),
  });
  mandatory.push(check("learning-evidence-caution", learning.status === "candidate" && learning.evidence[0]?.publishedPostId === published.id && /does not prove causation/i.test(learning.interpretation), "learning-evidence-or-causation-policy-broken"));

  const metricSummary = metrics.map((metric) => ({ name: metric.name, status: metric.status, ...(metric.value !== undefined ? { value: metric.value } : {}), ...(metric.reason ? { reason: metric.reason } : {}) }));
  const status = mandatory.every((checkpoint) => checkpoint.status === "pass") ? "pass" : "fail";
  return {
    scenarioId, sector: fixture.sector, format: fixture.format, status, mandatory, external, metricSummary,
    lineage: { workspaceId, brandId, ideaId: idea.id, researchId: research.id, angleId: angle.id, campaignId: campaign.id, contentVersionId: v2.id, publishedPostId: published.id, metricObservationIds: metrics.map((metric) => metric.id), learningId: learning.id },
    cost: { maxModeledUsd: MAX_MODELED_USD }, elapsedMs: Math.max(0, Date.now() - started),
  };
}

class StaticTools implements ToolGatewayPort {
  constructor(private readonly evidence: DiscoveryEvidence[]) {}
  async invoke<TOutput>(_request: ToolRequest): Promise<ToolResult<TOutput>> { return { output: this.evidence as TOutput, provenance: [] }; }
}

class StaticRuntime<T> implements AgentRuntimePort {
  lastRequest: AgentInvocationRequest | null = null;
  constructor(private readonly output: T) {}
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.lastRequest = request;
    return { output: this.output as unknown as TOutput, metadata: { runtime: "fixture", costUsd: 0.01, latencyMs: 1 } };
  }
}

class AngleCollector {
  angles: Angle[] = [];
  async saveCandidateAngles(_accountId: string, angles: readonly Angle[]): Promise<void> { this.angles = angles.map((angle) => ({ ...angle })); }
}

class InMemoryCreativeStore implements CreativeObjectStorePort, PublishableCreativeStorePort {
  private readonly objects = new Map<string, PrivateCreativeObject>();
  private counter = 0;
  async putPrivateObject(input: { workspaceId: string; brandId: string; objectKey: string; contentType: string; contentHash: string; bytes: Uint8Array }): Promise<{ objectId: string }> {
    this.counter += 1;
    const objectId = `object-${this.counter}`;
    const object: PrivateCreativeObject & { workspaceId: string; brandId: string } = { objectId, objectKey: input.objectKey, contentType: input.contentType, contentHash: input.contentHash, sizeBytes: input.bytes.byteLength, bytes: new Uint8Array(input.bytes), workspaceId: input.workspaceId, brandId: input.brandId };
    this.objects.set(objectId, object);
    return { objectId };
  }
  async readPrivateObject(input: { workspaceId: string; brandId: string; objectId: string }): Promise<PrivateCreativeObject> {
    const raw = this.objects.get(input.objectId) as (PrivateCreativeObject & { workspaceId?: string; brandId?: string }) | undefined;
    if (!raw || raw.workspaceId !== input.workspaceId || raw.brandId !== input.brandId) throw new Error("Private creative object is outside Brand scope");
    return { objectId: raw.objectId, objectKey: raw.objectKey, contentType: raw.contentType, contentHash: raw.contentHash, sizeBytes: raw.sizeBytes, bytes: new Uint8Array(raw.bytes) };
  }
  async findPrivateObjectByKey(input: { workspaceId: string; brandId: string; objectKey: string }): Promise<PrivateCreativeObjectDescriptor | null> {
    for (const raw of this.objects.values() as Iterable<PrivateCreativeObject & { workspaceId?: string; brandId?: string }>) {
      if (raw.workspaceId === input.workspaceId && raw.brandId === input.brandId && raw.objectKey === input.objectKey) return { objectId: raw.objectId, objectKey: raw.objectKey, contentType: raw.contentType, contentHash: raw.contentHash, sizeBytes: raw.sizeBytes };
    }
    return null;
  }
  async issuePublishingUrl(input: { workspaceId: string; brandId: string; objectId: string; ttlSeconds: number; audience: "publishing" }): Promise<{ url: string; expiresAt: string }> {
    await this.readPrivateObject(input);
    return { url: `https://media.example.com/${encodeURIComponent(input.objectId)}?audience=${input.audience}`, expiresAt: new Date(BASE_TIME.getTime() + input.ttlSeconds * 1000).toISOString() };
  }
}

class FixtureReelEncoder implements ReelEncoderPort {
  readonly version = "vs21-fixture-encoder-v1";
  async encode(): Promise<{ contentType: "video/mp4"; bytes: Uint8Array }> {
    return { contentType: "video/mp4", bytes: new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,2,0,105,115,111,109,105,115,111,50]) };
  }
}

function candidateAngle(title: string, fixture: Fixture, claimId: string): StrategistOutput["candidates"][number] {
  return { title, framing: "Explain the supported evidence plainly", audience: fixture.audience, objective: "Educate", hookDirection: "Lead with the practical implication", expectedValue: "Useful evidence backed context", effort: "low", recommendedFormat: fixture.format, recommendedChannel: "instagram", supportingClaimIds: [claimId] };
}

function creativePlan(format: PilotFormat, claimId: string): MarketingCreativePlan {
  if (format === "carousel") return {
    format: "carousel", coverHook: "What matters now", caption: "Evidence backed summary", cta: "Learn more", supportingClaimIds: [claimId],
    slides: [
      { headline: "First fact", body: "Evidence backed point", supportingClaimIds: [claimId] },
      { headline: "Why it matters", body: "Useful audience context", supportingClaimIds: [claimId] },
      { headline: "Next step", body: "Apply the insight carefully", supportingClaimIds: [claimId] },
    ],
  };
  return {
    format: "reel", hook: "What matters now", targetDurationSeconds: 6, caption: "Evidence backed summary", cta: "Learn more", supportingClaimIds: [claimId],
    scenes: [
      { startSecond: 0, endSecond: 3, visual: "Simple chart", onScreenText: "Key fact", voiceover: "Here is the supported fact", supportingClaimIds: [claimId] },
      { startSecond: 3, endSecond: 6, visual: "Simple diagram", onScreenText: "Why it matters", voiceover: "Here is why the evidence matters", supportingClaimIds: [claimId] },
    ],
  };
}

function check(id: string, passed: boolean, failureCode: string): PilotCheckpoint {
  return passed ? { id, status: "pass" } : { id, status: "fail", code: failureCode };
}

function plusSeconds(seconds: number): string { return new Date(BASE_TIME.getTime() + seconds * 1000).toISOString(); }

export type PilotMetricName = MetricName;
export type PilotStoredCreativePackage = StoredCreativePackage;
