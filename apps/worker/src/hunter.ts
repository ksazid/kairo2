import {
  prepareAgentInvocation,
  prepareToolRequest,
  type AgentRuntimePort,
  type DiscoveryEvidence,
  type JsonValue,
  type ToolGatewayPort,
  type NormalizedSourceDocument,
} from "@kairo/agent-contracts";
import type { DiscoveryService, OpportunityCandidateInput } from "@kairo/domain/discovery-service";
import {
  planSourceQueries,
  resolveBrandSourcePolicy,
  type BrandIntelligenceProfile,
  type DiscoverySourceDefinition,
} from "@kairo/domain/source-policy";
import { SECTOR_INTELLIGENCE_PACKS, selectSectorIntelligencePack } from "@kairo/domain/sector-packs";
import { DEFAULT_SOURCE_REGISTRY } from "@kairo/domain/source-registry";
import type { BrandIntelligenceTopicGraph } from "@kairo/domain/brand-intelligence";
import type { ManipulationRiskInput } from "@kairo/domain/eei";
import { rankAndFilterHunterCandidates } from "./hunter-quality";
import { applyHunterEEIRerank, HUNTER_EEI_VERSION } from "./hunter-eei";

export interface BrandContextProjection {
  workspaceId: string;
  brandId: string;
  contextVersion: string;
  brandName: string;
  positioning?: string;
  audience?: string;
  voice?: string;
  goals?: string;
  boundaries?: string;
}

export interface HunterJudgmentCandidate {
  sourceUrl: string;
  title: string;
  rationale: string;
  whyNow: string;
  developmentDirection: string;
  topic?: string;
  proposedAngle?: string;
  hook?: string;
  targetAudience?: string;
  objective?: string;
  recommendedFormat?: string;
  recommendedChannel?: string;
  confidence?: number;
  freshnessDays?: number;
  estimatedEffort?: "low" | "medium" | "high";
  engagementRisks?: ManipulationRiskInput;
  scores: {
    relevance: number;
    evidence: number;
    novelty: number;
    timeliness: number;
    brandAuthority: number;
    audienceFit: number;
  };
}

export interface HunterJudgmentOutput {
  candidates: HunterJudgmentCandidate[];
}

export interface HunterRunInput {
  accountId: string;
  brand: BrandContextProjection;
  /** Existing compatibility path. When supplied it takes precedence over sector-aware planning. */
  query?: string;
  /** Transient Brand-private projection; it is used for routing and never copied into shared source definitions. */
  intelligenceProfile?: BrandIntelligenceProfile;
  intelligenceGraph?: BrandIntelligenceTopicGraph;
  intelligenceVersion?: number;
  maxEvidence?: number;
  /** Changes the query rotation without weakening provenance or quality gates. */
  refreshSeed?: string;
  existingOpportunityTitles?: string[];
}

export interface HunterRunResult {
  evidenceCount: number;
  candidateCount: number;
  opportunityCount: number;
  sourcesScanned: string[];
  degradedSources?: string[];
}

export interface HunterFailureDiagnostic {
  phase: "discovery" | "enrichment" | "judgment";
  source: string;
  kind: string;
  statusCode?: number;
}

interface ExecutableDiscoveryPlan {
  source: string;
  query: string;
  explicit: boolean;
}

export class HunterOrchestrator {
  constructor(
    private readonly tools: ToolGatewayPort,
    private readonly runtime: AgentRuntimePort,
    private readonly opportunities: Pick<DiscoveryService, "recordCandidate">,
    private readonly sourceRegistry: readonly DiscoverySourceDefinition[] = DEFAULT_SOURCE_REGISTRY,
    private readonly reportFailure?: (diagnostic: HunterFailureDiagnostic) => void,
  ) {}

  private diagnose(phase: HunterFailureDiagnostic["phase"], source: string, error: unknown): void {
    const kind = error && typeof error === "object" ? (error as { kind?: unknown }).kind : undefined;
    const statusCode = error && typeof error === "object" ? (error as { statusCode?: unknown }).statusCode : undefined;
    const safeKind = typeof kind === "string" && ["unavailable", "rate-limited", "upstream", "invalid-response", "timeout"].includes(kind)
      ? kind : "unknown";
    const safeStatusCode = typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
      ? statusCode : undefined;
    try { this.reportFailure?.({ phase, source, kind: safeKind, ...(safeStatusCode ? { statusCode: safeStatusCode } : {}) }); } catch { /* Diagnostics must not fail the run. */ }
  }

  async runForAuthorizedBrand(input: HunterRunInput): Promise<HunterRunResult> {
    const maxEvidence = normalizeMaxEvidence(input.maxEvidence);
    const plans = executablePlans(input, this.sourceRegistry);
    if (!plans.length) return { evidenceCount: 0, candidateCount: 0, opportunityCount: 0, sourcesScanned: [] };
    const sourcesScanned = new Set<string>();

    // Source Registry/query planning owns the provider request ceilings. maxEvidence bounds the
    // evidence set sent to the model, not which relevant providers are allowed to participate.
    const maxResultsPerQuery = Math.max(2, Math.min(20, Math.ceil((maxEvidence * 2) / plans.length)));
    const discovered: DiscoveryEvidence[] = [];
    const degradedSources = new Set<string>();

    for (const plan of plans) {
      if (degradedSources.has(plan.source)) continue;
      sourcesScanned.add(plan.source);
      const toolRequest = prepareToolRequest({
        capability: "public-content-search",
        scope: { visibility: "global-public" },
        input: {
          query: plan.query,
          maxResults: maxResultsPerQuery,
          ...(plan.explicit && plan.source === "agent-reach" ? {} : { source: plan.source }),
        },
        timeoutMs: 20_000,
      });
      try {
        const discovery = await this.tools.invoke<DiscoveryEvidence[]>(toolRequest);
        discovered.push(...discovery.output);
      } catch (error) {
        // A provider is degraded for the rest of this run. Other providers continue; failure is
        // surfaced in the run result rather than fabricated as successful empty evidence.
        degradedSources.add(plan.source);
        this.diagnose("discovery", plan.source, error);
      }
    }

    const shortlisted = rankDiscoveryEvidence(uniqueEvidence(discovered), input).slice(0, maxEvidence);
    const enrichedDocuments = new Map<string, NormalizedSourceDocument>();
    const evidence: DiscoveryEvidence[] = [];
    for (const item of shortlisted) {
      try {
        const fetched = await this.tools.invoke<{ document: NormalizedSourceDocument }> (prepareToolRequest({
          capability: "public-content-fetch", scope: { visibility: "global-public" }, input: { url: item.sourceUrl }, timeoutMs: 20_000,
        }));
        enrichedDocuments.set(item.sourceUrl, fetched.output.document);
        evidence.push(enrichDiscoveryEvidence(item, fetched.output.document));
      } catch (error) { this.diagnose("enrichment", "public-content-fetch", error); evidence.push(item); }
    }
    if (!evidence.length) return withDegraded({ evidenceCount: 0, candidateCount: 0, opportunityCount: 0 }, degradedSources, sourcesScanned);

    const invocation = prepareAgentInvocation({
      role: "hunter",
      scope: { visibility: "brand-private", workspaceId: input.brand.workspaceId, brandId: input.brand.brandId },
      approvedContextVersion: input.brand.contextVersion,
      capabilities: ["public-content-search", "public-content-fetch"],
      task: {
        instruction: "Evaluate the supplied public evidence for this Brand. Review the strongest evidence first and assess at least the top five items (or every item when fewer than five exist) against Brand/topic/audience relevance, concrete source support, timeliness and novelty. Return 1-6 evidence-linked candidates when any item clears those minimums. Zero candidates is valid only when none of the supplied evidence supports a credible Brand-relevant content move. Do not require exceptional or viral certainty: Kairo applies deterministic quality gates after your judgment. Never invent evidence, and every candidate must use an exact sourceUrl supplied in the evidence. Optimize for useful Brand action, not clicks or screen time. If the proposed angle itself relies on artificial urgency, fear/anxiety exploitation, deceptive re-engagement, hidden opt-outs, sensitive-trait targeting, outrage amplification, or a compulsive reward loop, flag the applicable boolean fields in optional engagementRisks; otherwise omit engagementRisks.",
        context: compactHunterContext(input, evidence, enrichedDocuments),
      },
      outputSchema: { name: "hunter-opportunities", version: "2" },
      budget: { maxOutputTokens: 4_000, maxToolCalls: 0, maxCostUsd: 0.12, timeoutMs: 30_000 },
    });

    let judgment: Awaited<ReturnType<AgentRuntimePort["invoke"]>>;
    try {
      judgment = await this.runtime.invoke<HunterJudgmentOutput>(invocation);
    } catch (error) {
      this.diagnose("judgment", "hunter-model", error);
      // A provider/model contract failure must not turn a recommendation refresh into a
      // server error. The evidence fetch was still useful, but no trustworthy opportunities
      // can be persisted without a valid judgment.
      return withDegraded({
        evidenceCount: evidence.length,
        candidateCount: 0,
        opportunityCount: 0,
      }, new Set([...degradedSources, "hunter-model"]), sourcesScanned);
    }
    if (!isHunterJudgmentOutput(judgment.output)) {
      this.diagnose("judgment", "hunter-model", { kind: "invalid-response" });
      return withDegraded({
        evidenceCount: evidence.length,
        candidateCount: 0,
        opportunityCount: 0,
      }, new Set([...degradedSources, "hunter-model"]), sourcesScanned);
    }

    const initialCandidateCount = judgment.output.candidates.length;
    let judgmentOutput = judgment.output;
    let retryCandidateCount: number | undefined;
    if (!input.query?.trim() && initialCandidateCount === 0) {
      try {
        const retry = await this.runtime.invoke<HunterJudgmentOutput>(prepareAgentInvocation({
          role: "hunter",
          scope: { visibility: "brand-private", workspaceId: input.brand.workspaceId, brandId: input.brand.brandId },
          approvedContextVersion: input.brand.contextVersion,
          capabilities: ["public-content-search", "public-content-fetch"],
          task: {
            instruction: "Recheck the strongest supplied evidence before returning zero candidates. Evaluate the top five evidence items (or all items when fewer than five exist) individually. Propose a candidate whenever the source gives concrete support for a timely Brand/topic/audience-relevant angle with reasonable novelty. A candidate does not need to be exceptional or provably viral; it must be useful, grounded and specific. Return zero only if every reviewed item fails those minimums. Use only exact supplied sourceUrl values and do not invent facts. Optimize for usefulness rather than attention capture, and flag any prohibited engagement tactic in optional engagementRisks.",
            context: compactHunterContext(input, evidence, enrichedDocuments),
          },
          outputSchema: { name: "hunter-opportunities", version: "2" },
          budget: { maxOutputTokens: 3_000, maxToolCalls: 0, maxCostUsd: 0.08, timeoutMs: 30_000 },
        }));
        if (isHunterJudgmentOutput(retry.output)) {
          judgmentOutput = retry.output;
          retryCandidateCount = retry.output.candidates.length;
        } else {
          this.diagnose("judgment", "hunter-model", { kind: "invalid-response" });
        }
      } catch (error) {
        this.diagnose("judgment", "hunter-model", error);
      }
    }

    const byUrl = new Map(evidence.map((item) => [item.sourceUrl, item]));
    const qualityQualified = rankAndFilterHunterCandidates(judgmentOutput.candidates, {
      evidenceByUrl: byUrl,
      documentsByUrl: enrichedDocuments,
      ...(input.intelligenceProfile ? { intelligenceProfile: input.intelligenceProfile } : {}),
      ...(input.intelligenceGraph ? { intelligenceGraph: input.intelligenceGraph } : {}),
      ...(input.existingOpportunityTitles?.length ? { existingOpportunityTitles: input.existingOpportunityTitles } : {}),
      ...(input.refreshSeed ? { referenceTime: input.refreshSeed } : {}),
      maxCandidates: 12,
    });
    const qualified = applyHunterEEIRerank(qualityQualified, { maxCandidates: 12 });

    console.info(JSON.stringify({
      event: "hunter_candidate_pipeline",
      evidenceCount: evidence.length,
      initialCandidateCount,
      ...(retryCandidateCount !== undefined ? { retryCandidateCount } : {}),
      modelCandidateCount: judgmentOutput.candidates.length,
      qualityAcceptedCount: qualityQualified.length,
      qualityRejectedCount: Math.max(0, judgmentOutput.candidates.length - qualityQualified.length),
      eeiAcceptedCount: qualified.length,
      eeiRejectedCount: Math.max(0, qualityQualified.length - qualified.length),
      eeiVersion: HUNTER_EEI_VERSION,
    }));

    let opportunityCount = 0;
    for (const { candidate, source, scores: adjustedScores } of qualified) {
      const record: OpportunityCandidateInput = {
        signal: {
          title: source.title,
          ...(source.summary ? { summary: source.summary.slice(0, 2_000) } : {}),
          sourceUrl: source.sourceUrl,
          platform: source.platform,
          ...(source.publisher ? { publisher: source.publisher } : {}),
          ...(source.author ? { author: source.author } : {}),
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          retrievedAt: source.retrievedAt,
          provider: source.provider,
          ...(source.providerVersion ? { providerVersion: source.providerVersion } : {}),
          ...(source.contentHash ? { contentHash: source.contentHash.replace(/^sha256:/, "") } : {}),
        },
        title: candidate.title,
        rationale: candidate.rationale,
        whyNow: candidate.whyNow,
        developmentDirection: candidate.developmentDirection,
        brandContextVersion: input.brand.contextVersion,
        scores: adjustedScores,
        details: opportunityDetails(candidate, source, input),
      };
      const saved = await this.opportunities.recordCandidate(input.accountId, input.brand.brandId, record);
      if (saved.opportunity) opportunityCount += 1;
    }

    console.info(JSON.stringify({
      event: "hunter_candidate_persistence",
      modelCandidateCount: judgmentOutput.candidates.length,
      qualityAcceptedCount: qualityQualified.length,
      eeiAcceptedCount: qualified.length,
      eeiVersion: HUNTER_EEI_VERSION,
      persistedOpportunityCount: opportunityCount,
      domainRejectedCount: Math.max(0, qualified.length - opportunityCount),
    }));

    return withDegraded({
      evidenceCount: evidence.length,
      candidateCount: judgmentOutput.candidates.length,
      opportunityCount,
    }, degradedSources, sourcesScanned);
  }
}

export function isHunterJudgmentOutput(value: unknown): value is HunterJudgmentOutput {
  if (!value || typeof value !== "object" || !Array.isArray((value as HunterJudgmentOutput).candidates)) return false;
  return (value as HunterJudgmentOutput).candidates.every((candidate) =>
    candidate && typeof candidate === "object" &&
    nonEmpty(candidate.sourceUrl) && nonEmpty(candidate.title) && nonEmpty(candidate.rationale) &&
    nonEmpty(candidate.whyNow) && nonEmpty(candidate.developmentDirection) && validScores(candidate.scores) &&
    validEngagementRisks(candidate.engagementRisks),
  );
}

function executablePlans(input: HunterRunInput, sourceRegistry: readonly DiscoverySourceDefinition[] = DEFAULT_SOURCE_REGISTRY): ExecutableDiscoveryPlan[] {
  const explicit = input.query?.trim();
  if (explicit) {
    const agentReach = sourceRegistry.find((source) => source.key === "agent-reach" && source.enabled && source.capabilities.includes("discovery"));
    if (agentReach) return [{ source: "agent-reach", query: explicit, explicit: true }];
    const sources = sourceRegistry
      .filter((source) => source.enabled && source.capabilities.includes("discovery"))
      .map((source) => source.key)
      .slice(0, 6);
    return sources.map((source) => ({ source, query: explicit, explicit: true }));
  }
  if (input.query !== undefined && !explicit) throw new Error("Hunter query is required");
  if (!input.intelligenceProfile) throw new Error("Hunter requires an explicit query or Brand Intelligence Profile");

  const pack = selectSectorIntelligencePack(input.intelligenceProfile, Object.values(SECTOR_INTELLIGENCE_PACKS));
  const policy = resolveBrandSourcePolicy(input.intelligenceProfile, pack, sourceRegistry);
  const base = planSourceQueries(input.intelligenceProfile, pack, policy, sourceRegistry);
  return expandIntentPlans(base, input).slice(0, 16);
}

function normalizeMaxEvidence(value: number | undefined): number {
  const maxEvidence = value ?? 20;
  if (!Number.isInteger(maxEvidence) || maxEvidence < 1 || maxEvidence > 20) {
    throw new Error("maxEvidence must be an integer from 1 to 20");
  }
  return maxEvidence;
}

function validScores(scores: HunterJudgmentCandidate["scores"] | undefined): boolean {
  if (!scores || typeof scores !== "object") return false;
  return [scores.relevance, scores.evidence, scores.novelty, scores.timeliness, scores.brandAuthority, scores.audienceFit]
    .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function validEngagementRisks(value: ManipulationRiskInput | undefined): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set([
    "artificialUrgency",
    "fearOrAnxietyExploitation",
    "deceptiveReengagement",
    "hiddenOptOut",
    "sensitiveTraitTargeting",
    "outrageAmplificationObjective",
    "compulsiveRewardLoop",
  ]);
  return Object.entries(value).every(([key, item]) => allowed.has(key) && typeof item === "boolean");
}

function uniqueEvidence(items: DiscoveryEvidence[]): DiscoveryEvidence[] {
  const seen = new Set<string>();
  const storyKeys = new Set<string>();
  const result: DiscoveryEvidence[] = [];
  for (const item of items) {
    const key = canonicalEvidenceKey(item.sourceUrl);
    const storyKey = normalizedStoryKey(item.title);
    if (seen.has(key) || (storyKey && storyKeys.has(storyKey))) continue;
    seen.add(key);
    if (storyKey) storyKeys.add(storyKey);
    result.push(item);
  }
  return result;
}

function canonicalEvidenceKey(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || ["fbclid", "gclid", "dclid", "msclkid"].includes(normalized)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\?$/, "");
  } catch {
    return sourceUrl.trim();
  }
}

function withDegraded(
  result: Omit<HunterRunResult, "degradedSources" | "sourcesScanned">,
  degraded: ReadonlySet<string>,
  scanned: ReadonlySet<string>,
): HunterRunResult {
  const sourcesScanned = [...scanned].sort();
  const degradedSources = [...degraded].sort();
  return degradedSources.length
    ? { ...result, sourcesScanned, degradedSources }
    : { ...result, sourcesScanned };
}

function compactBrand(brand: BrandContextProjection) {
  return {
    brandName: brand.brandName.slice(0, 300),
    ...(brand.positioning ? { positioning: brand.positioning.slice(0, 1_000) } : {}),
    ...(brand.audience ? { audience: brand.audience.slice(0, 1_000) } : {}),
    ...(brand.voice ? { voice: brand.voice.slice(0, 1_000) } : {}),
    ...(brand.goals ? { goals: brand.goals.slice(0, 1_000) } : {}),
    ...(brand.boundaries ? { boundaries: brand.boundaries.slice(0, 1_000) } : {}),
  };
}

function compactIntelligenceProfile(profile: BrandIntelligenceProfile) {
  return {
    ...(profile.sector ? { sector: profile.sector.slice(0, 200) } : {}),
    ...(profile.subsector ? { subsector: profile.subsector.slice(0, 200) } : {}),
    geographies: boundedStrings(profile.geographies, 10, 120),
    languages: boundedStrings(profile.languages, 10, 120),
    audiences: boundedStrings(profile.audiences, 12, 300),
    topics: boundedStrings(profile.topics, 20, 300),
    excludedTopics: boundedStrings(profile.excludedTopics, 20, 300),
    goals: boundedStrings(profile.goals, 12, 500),
  };
}

// The Hermes bridge and its upstream providers enforce a much smaller practical
// request ceiling than the worker's original 32k serialization budget. Keep the
// complete evidence set for provenance and quality checks, but send the model a
// compact judgment packet that has reliable transport headroom.
const HUNTER_CONTEXT_MAX_CHARS = 12_000;
const HUNTER_EVIDENCE_TEXT_CHARS = 600;

function compactHunterContext(
  input: HunterRunInput,
  evidence: readonly DiscoveryEvidence[],
  documents: ReadonlyMap<string, NormalizedSourceDocument>,
) {
  const base = {
    brand: compactBrand(input.brand),
    ...(input.intelligenceProfile ? { intelligenceProfile: compactIntelligenceProfile(input.intelligenceProfile) } : {}),
    ...(input.intelligenceGraph ? {
      topicGraph: compactTopicGraph(input.intelligenceGraph),
      ...(input.intelligenceVersion !== undefined ? { intelligenceVersion: input.intelligenceVersion } : {}),
    } : {}),
  };
  const compactedEvidence = compactHunterEvidence(evidence, documents, base);
  const context = { ...base, evidence: compactedEvidence };
  if (JSON.stringify(context).length > HUNTER_CONTEXT_MAX_CHARS) {
    throw new Error("Hunter model context exceeded its deterministic serialization budget");
  }
  return context;
}

function compactHunterEvidence(
  evidence: readonly DiscoveryEvidence[],
  documents: ReadonlyMap<string, NormalizedSourceDocument>,
  baseContext: Record<string, JsonValue>,
) {
  const result: Array<Record<string, JsonValue>> = [];
  for (const item of evidence) {
    const document = documents.get(item.sourceUrl);
    const sourceText = item.summary ?? document?.transcript ?? document?.body ?? document?.description;
    const summary = sourceText?.trim().slice(0, HUNTER_EVIDENCE_TEXT_CHARS);
    const candidate: Record<string, JsonValue> = {
      title: item.title.slice(0, 500),
      ...(summary ? { summary } : {}),
      sourceUrl: item.sourceUrl,
      platform: item.platform,
      ...(item.publisher ? { publisher: item.publisher.slice(0, 300) } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      retrievedAt: item.retrievedAt,
      ...(document?.tags?.length ? { tags: document.tags.slice(0, 20).map((tag) => tag.slice(0, 120)) } : {}),
    };
    if (JSON.stringify({ ...baseContext, evidence: [...result, candidate] }).length <= HUNTER_CONTEXT_MAX_CHARS) {
      result.push(candidate);
      continue;
    }
    const metadataOnly = { ...candidate };
    delete (metadataOnly as { summary?: unknown }).summary;
    if (JSON.stringify({ ...baseContext, evidence: [...result, metadataOnly] }).length <= HUNTER_CONTEXT_MAX_CHARS) {
      result.push(metadataOnly);
      continue;
    }
    break;
  }
  return result;
}

function boundedStrings(values: readonly string[], count: number, chars: number): string[] {
  return values.slice(0, count).map((value) => value.slice(0, chars));
}

const QUERY_INTENTS = ["latest developments", "new release", "trend", "debate", "benchmark", "audience pain", "regulation", "new research", "tutorial", "misconception", "contrarian viewpoint"] as const;
function expandIntentPlans(base: ReturnType<typeof planSourceQueries>, input: HunterRunInput): ExecutableDiscoveryPlan[] {
  const graphTopics = input.intelligenceGraph?.nodes.filter((node) => !node.excluded).sort((a, b) => b.priority - a.priority).slice(0, 4) ?? [];
  const aliases = new Map(graphTopics.map((node) => [node.topic.toLowerCase(), node.aliases[0]]));
  const excluded = input.intelligenceProfile?.excludedTopics ?? [];
  const language = input.intelligenceProfile?.languages[0]; const geography = input.intelligenceProfile?.geographies[0];
  const rotationOffset = refreshRotationOffset(input.refreshSeed);
  return base.flatMap((plan, index) => {
    const node = graphTopics[index % Math.max(1, graphTopics.length)];
    const topic = node?.topic ?? plan.query;
    const alias = aliases.get(topic.toLowerCase());
    const intent = plan.source === "github" ? "new repo tool" : QUERY_INTENTS[(index + rotationOffset) % QUERY_INTENTS.length];
    const freshness = node?.freshness === "fresh" ? "past week" : "recent";
    const negative = excluded.slice(0, 3).map((item) => `-${quoteQuery(item)}`).join(" ");
    const sourceSyntax = plan.source === "github" ? `in:name,description,readme pushed:>${dateDaysAgo(90)}` : "";
    const query = [topic, alias, intent, freshness, geography, language, negative, sourceSyntax].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
    return [{ source: plan.source, query, explicit: false }];
  });
}
function refreshRotationOffset(seed: string | undefined): number {
  if (!seed) return 0;
  return [...seed].reduce((total, character) => total + character.charCodeAt(0), 0) % QUERY_INTENTS.length;
}
function compactTopicGraph(graph: BrandIntelligenceTopicGraph) { return { schemaVersion: graph.schemaVersion, sectorPack: graph.sectorPack.slice(0, 120), fingerprint: graph.fingerprint.slice(0, 120), nodes: graph.nodes.slice(0, 6).map((node) => ({ topic: node.topic.slice(0, 180), aliases: boundedStrings(node.aliases, 2, 80), ...(node.parent ? { parent: node.parent.slice(0, 180) } : {}), priority: node.priority, ...(node.confidence !== undefined ? { confidence: node.confidence } : {}), sourceIds: boundedStrings(node.sourceIds, 3, 80), freshness: node.freshness, preferred: node.preferred, excluded: node.excluded, authority: node.authority, origin: node.origin })) }; }
function enrichDiscoveryEvidence(item: DiscoveryEvidence, document: NormalizedSourceDocument): DiscoveryEvidence {
  const summary = document.transcript ?? document.body ?? document.description ?? item.summary;
  return { ...item, ...(summary ? { summary: summary.slice(0, 8_000) } : {}), contentHash: document.contentHash, providerVersion: document.providerVersion };
}
function rankDiscoveryEvidence(items: DiscoveryEvidence[], input: HunterRunInput): DiscoveryEvidence[] {
  const topics = input.intelligenceGraph?.nodes.filter((node) => !node.excluded).map((node) => node.topic) ?? input.intelligenceProfile?.topics ?? [];
  const ranked = [...items].sort((a, b) => discoveryScore(b, topics) - discoveryScore(a, topics) || a.sourceUrl.localeCompare(b.sourceUrl));
  const result: DiscoveryEvidence[] = []; const queues = new Map<string, DiscoveryEvidence[]>();
  for (const item of ranked) queues.set(item.platform, [...(queues.get(item.platform) ?? []), item]);
  while (queues.size) for (const [platform, queue] of queues) { const item = queue.shift(); if (item) result.push(item); if (!queue.length) queues.delete(platform); }
  return result;
}
function discoveryScore(item: DiscoveryEvidence, topics: readonly string[]) { const text = `${item.title} ${item.summary ?? ""}`.toLowerCase(); const fit = topics.reduce((score, topic) => score + (text.includes(topic.toLowerCase()) ? 1 : 0), 0); const freshness = item.publishedAt ? Math.max(0, 1 - ((Date.now() - Date.parse(item.publishedAt)) / 86_400_000) / 180) : 0; return fit * 2 + freshness + sourceAuthority(item.platform); }
function opportunityDetails(candidate: HunterJudgmentCandidate, source: DiscoveryEvidence, input: HunterRunInput): NonNullable<OpportunityCandidateInput["details"]> {
  const confidence = clamp01(candidate.confidence ?? Object.values(candidate.scores).reduce((sum, score) => sum + score, 0) / 6);
  const freshnessDays = Math.max(1, Math.min(365, Math.round(candidate.freshnessDays ?? 30)));
  return { topic: candidate.topic?.trim() || bestTopic(source, input) || candidate.title, proposedAngle: candidate.proposedAngle?.trim() || candidate.developmentDirection,
    hook: candidate.hook?.trim() || candidate.title, targetAudience: candidate.targetAudience?.trim() || input.intelligenceProfile?.audiences[0] || "Brand audience",
    objective: candidate.objective?.trim() || input.intelligenceProfile?.goals[0] || "Build relevant authority", recommendedFormat: candidate.recommendedFormat?.trim() || "post",
    recommendedChannel: candidate.recommendedChannel?.trim() || "best-fit channel", confidence, expiresAt: new Date(Date.now() + freshnessDays * 86_400_000).toISOString(),
    estimatedEffort: candidate.estimatedEffort ?? "medium", ...(input.intelligenceVersion !== undefined ? { intelligenceVersion: input.intelligenceVersion } : {}) };
}
function bestTopic(source: DiscoveryEvidence, input: HunterRunInput) { const text = `${source.title} ${source.summary ?? ""}`.toLowerCase(); return input.intelligenceGraph?.nodes.filter((node) => !node.excluded && text.includes(node.topic.toLowerCase())).sort((a, b) => b.priority - a.priority)[0]?.topic ?? input.intelligenceProfile?.topics[0]; }
function sourceAuthority(platform: string) { return ["github", "hacker-news", "rss"].includes(platform) ? 0.9 : platform === "youtube" ? 0.75 : 0.6; }
function quoteQuery(value: string) { return /\s/.test(value) ? `"${value.replaceAll('"', "")}"` : value; }
function dateDaysAgo(days: number) { return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10); }
function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }
function normalizedStoryKey(title: string) { return title.toLowerCase().replace(/\b(breaking|new|latest|update|release|announcing)\b/g, " ").match(/[a-z0-9]+/g)?.filter((token) => token.length > 2).sort().slice(0, 8).join("|") ?? ""; }

function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
