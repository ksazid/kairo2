import { createHash } from "node:crypto";
import type {
  AgentRuntimePort,
} from "@kairo/agent-contracts";
import type {
  BrandBrainFieldDto,
  KnowledgeSourceDto,
} from "@kairo/contracts";
import { createBrandBrainActivationSnapshot } from "@kairo/domain/brand-brain-activation";
import {
  type BrandBrainProposal,
  type BrandBrainProposalGenerator,
  type BrandBrainProposalInput,
  type PublicBrandReference,
  type PublicBrandReferenceReader,
} from "@kairo/domain/brand-brain-bootstrap";
import { SanitizingPublicBrandReferenceReader } from "@kairo/domain/brand-brain-sanitizing-reader";
import { projectInitialBrandDiscoveryPlan } from "@kairo/domain/brand-discovery-plan";
import { buildTopicGraph, type SectorPackId } from "@kairo/domain/brand-intelligence";
import { projectBrandIntelligenceSnapshot } from "@kairo/domain/brand-intelligence-snapshot";
import {
  projectBrandIntelligenceProfile,
  type BrandIntelligenceProfile,
} from "@kairo/domain/source-policy";
import { selectSectorIntelligencePack } from "@kairo/domain/sector-packs";
import type { HunterRunInput } from "@kairo/worker/hunter";
import type { HunterShadowExecutionContext } from "@kairo/worker/hunter-shadow-lane-adapters";
import { SourceIntelligenceBrandReferenceReader } from "./source-intelligence";

export interface EphemeralPublicBrandFixture {
  id: string;
  brandName: string;
  referenceUrls: readonly [string, ...string[]];
}

export const HUNTER_SHADOW_PUBLIC_BRAND_FIXTURES: readonly EphemeralPublicBrandFixture[] = Object.freeze([
  {
    id: "vercel-public",
    brandName: "Vercel",
    referenceUrls: [
      "https://vercel.com/about",
      "https://vercel.com/legal/acceptable-use-policy",
    ],
  },
  {
    id: "github-public",
    brandName: "GitHub",
    referenceUrls: [
      "https://github.com/about",
      "https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies",
    ],
  },
  {
    id: "openai-public",
    brandName: "OpenAI",
    referenceUrls: [
      "https://openai.com/about/",
      "https://openai.com/policies/usage-policies/",
    ],
  },
  {
    id: "anthropic-public",
    brandName: "Anthropic",
    referenceUrls: [
      "https://www.anthropic.com/company",
      "https://www.anthropic.com/news/usage-policy-update",
    ],
  },
]);

export async function buildEphemeralPublicBrandContexts(input: {
  runtime: AgentRuntimePort;
  limit: number;
  fixtures?: readonly EphemeralPublicBrandFixture[];
  reader?: PublicBrandReferenceReader;
  proposalGenerator?: BrandBrainProposalGenerator;
}): Promise<Array<{
  workspaceId: string;
  brandId: string;
  context: Omit<HunterShadowExecutionContext, "referenceTime">;
}>> {
  const limit = Math.max(0, input.limit);
  const fixtures = input.fixtures ?? HUNTER_SHADOW_PUBLIC_BRAND_FIXTURES;
  if (!limit || !fixtures.length) return [];

  const reader =
    input.reader ??
    new SanitizingPublicBrandReferenceReader(
      new SourceIntelligenceBrandReferenceReader(),
    );
  const proposalGenerator =
    input.proposalGenerator ?? SOURCE_BACKED_EPHEMERAL_PROPOSAL_GENERATOR;
  const contexts: Array<{
    workspaceId: string;
    brandId: string;
    context: Omit<HunterShadowExecutionContext, "referenceTime">;
  }> = [];

  const failures: string[] = [];
  for (const fixture of fixtures) {
    if (contexts.length >= limit) break;
    try {
      contexts.push(
        await buildEphemeralPublicBrandContext(
          fixture,
          reader,
          proposalGenerator,
        ),
      );
    } catch (error) {
      failures.push(
        fixture.id +
          ": " +
          (error instanceof Error ? error.message : "unknown public Brand fixture failure"),
      );
    }
  }
  if (contexts.length < limit) {
    throw new Error(
      "Ephemeral public Brand coverage produced " +
        contexts.length +
        " of " +
        limit +
        " required contexts; failures=" +
        failures.join(" | "),
    );
  }
  return contexts;
}

export const HUNTER_SHADOW_EPHEMERAL_BOOTSTRAP_MODE =
  "source-backed-deterministic" as const;

const SOURCE_BACKED_EPHEMERAL_PROPOSAL_GENERATOR: BrandBrainProposalGenerator = {
  async propose(input) {
    return sourceBackedEphemeralProposals(input);
  },
};

function sourceBackedEphemeralProposals(
  input: BrandBrainProposalInput,
): BrandBrainProposal[] {
  const primary =
    input.references.find((reference) => !isBoundaryReference(reference)) ??
    input.references[0];
  const boundary =
    input.references.find(isBoundaryReference) ??
    input.references.at(-1) ??
    primary;
  if (!primary || !boundary) return [];

  const primarySnippet = evidenceSnippet(primary);
  const audienceSnippet = evidenceAudienceSnippet(primary);
  const boundarySnippet = evidenceSnippet(boundary);
  const topics = evidenceTopics(input.brandName, primary).join(", ");
  const primarySourceIds = [primary.sourceId];
  const boundarySourceIds = [boundary.sourceId];

  return [
    {
      section: "identity",
      fieldKey: "identity.description",
      value: (input.brandName + ". " + primarySnippet).slice(0, 900),
      sourceIds: primarySourceIds,
    },
    {
      section: "identity",
      fieldKey: "identity.products-services",
      value: ("Products and services evidenced by the public source: " + primarySnippet).slice(0, 900),
      sourceIds: primarySourceIds,
    },
    {
      section: "audience",
      fieldKey: "audience.primary",
      value: ("Audience evidenced by the public source: " + audienceSnippet).slice(0, 700),
      sourceIds: primarySourceIds,
    },
    {
      section: "positioning",
      fieldKey: "positioning.value-proposition",
      value: ("Public positioning evidenced by the source: " + primarySnippet).slice(0, 900),
      sourceIds: primarySourceIds,
    },
    {
      section: "content-strategy",
      fieldKey: "content.core-topics",
      value: topics,
      sourceIds: primarySourceIds,
    },
    {
      section: "boundaries",
      fieldKey: "boundaries.excluded-topics",
      value: ("Public usage boundaries: " + boundarySnippet).slice(0, 900),
      sourceIds: boundarySourceIds,
    },
  ];
}

function isBoundaryReference(
  reference: PublicBrandReference & { sourceId: string },
): boolean {
  const text = [
    reference.url,
    reference.title ?? "",
    reference.summary ?? "",
    reference.excerpt,
  ].join(" ").toLowerCase();
  return /\b(?:policy|policies|acceptable use|usage|terms|safety|prohibited|restriction|restricted)\b/.test(text);
}

function evidenceSnippet(
  reference: PublicBrandReference & { sourceId: string },
): string {
  const text = [reference.title ?? "", reference.summary ?? "", reference.excerpt]
    .join(". ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return new URL(reference.url).hostname;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const useful =
    sentences.find((sentence) => sentence.trim().length >= 24) ??
    text;
  return useful.trim().slice(0, 620);
}

function evidenceAudienceSnippet(
  reference: PublicBrandReference & { sourceId: string },
): string {
  const text = [reference.title ?? "", reference.summary ?? "", reference.excerpt]
    .join(". ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.split(/(?<=[.!?])\s+/);
  const audience = sentences.find((sentence) =>
    /\b(?:developer|developers|team|teams|user|users|business|businesses|organization|organizations|company|companies|customer|customers|community|communities|creator|creators)\b/i.test(sentence)
  );
  return (audience ?? evidenceSnippet(reference)).trim().slice(0, 520);
}

function evidenceTopics(
  brandName: string,
  reference: PublicBrandReference & { sourceId: string },
): string[] {
  const text = [brandName, reference.title ?? "", reference.summary ?? "", reference.excerpt]
    .join(" ")
    .replace(/\s+/g, " ");
  const curated: Array<[RegExp, string]> = [
    [/\b(?:artificial intelligence|\bai\b|agents?)\b/i, "AI and agents"],
    [/\b(?:api|apis)\b/i, "APIs"],
    [/\b(?:developer|developers|developer tools|development)\b/i, "Developer tools"],
    [/\b(?:software|code|coding|programming)\b/i, "Software development"],
    [/\b(?:open[ -]source|repository|repositories|git)\b/i, "Open source and repositories"],
    [/\b(?:deploy|deployment|deployments)\b/i, "Deployment"],
    [/\b(?:frontend|web development|web platform)\b/i, "Web development"],
    [/\b(?:cloud|infrastructure|hosting)\b/i, "Cloud infrastructure"],
    [/\b(?:security|secure|safety)\b/i, "Security"],
    [/\b(?:collaboration|collaborate|workflow|workflows)\b/i, "Developer workflows"],
    [/\b(?:automation|automate)\b/i, "Automation"],
    [/\b(?:platform|platforms)\b/i, "Platform capabilities"],
  ];
  const matched = curated
    .filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label);
  if (matched.length >= 3) return unique(matched).slice(0, 6);

  const stop = new Set([
    "about", "their", "there", "these", "those", "with", "from", "that", "this",
    "your", "have", "more", "into", "using", "build", "builds", "public", "source",
    "company", "companies", "team", "teams", "users", "user", "where", "which",
  ]);
  const fallback = (text.match(/[A-Za-z][A-Za-z0-9-]{3,}/g) ?? [])
    .map((token) => token.replace(/[-_]+/g, " ").trim())
    .filter((token) => !stop.has(token.toLowerCase()))
    .map((token) => token[0]!.toUpperCase() + token.slice(1).toLowerCase());
  return unique([...matched, ...fallback, brandName]).slice(0, 6);
}

async function buildEphemeralPublicBrandContext(
  fixture: EphemeralPublicBrandFixture,
  reader: PublicBrandReferenceReader,
  proposalGenerator: BrandBrainProposalGenerator,
): Promise<{
  workspaceId: string;
  brandId: string;
  context: Omit<HunterShadowExecutionContext, "referenceTime">;
}> {
  const workspaceId = deterministicUuid("workspace:" + fixture.id);
  const brandId = deterministicUuid("brand:" + fixture.id);
  const accountId = "shadow-public-operator";
  const references = await Promise.all(
    fixture.referenceUrls.map(async (url) => {
      const reference = await reader.read(url);
      return {
        ...reference,
        sourceId: deterministicUuid("source:" + fixture.id + ":" + reference.url),
      };
    }),
  );

  const proposals = await proposalGenerator.propose({
    workspaceId,
    brandId,
    brandName: fixture.brandName,
    existingConfirmed: {},
    references,
  });
  const now = new Date().toISOString();
  const brain: BrandBrainFieldDto[] = proposals.map((proposal, index) => ({
    id: deterministicUuid("field:" + fixture.id + ":" + proposal.fieldKey),
    workspaceId,
    brandId,
    section: proposal.section,
    fieldKey: proposal.fieldKey,
    value: proposal.value,
    state: "inferred",
    sourceIds: [...proposal.sourceIds],
    version: 1,
    updatedAt: now,
  }));
  const sources: KnowledgeSourceDto[] = references.map((reference) => ({
    id: reference.sourceId,
    workspaceId,
    brandId,
    type: "website",
    status: "active",
    ...(reference.title ? { title: reference.title } : {}),
    sourceUrl: reference.url,
    ...(reference.contentType ? { contentType: reference.contentType } : {}),
    ...(reference.sizeBytes !== undefined ? { sizeBytes: reference.sizeBytes } : {}),
    contentHash: "sha256:" + createHash("sha256")
      .update(reference.url + "\n" + reference.excerpt)
      .digest("hex"),
    hasPrivateContent: false,
    createdAt: reference.retrievedAt,
    updatedAt: reference.retrievedAt,
  }));

  const activation = createBrandBrainActivationSnapshot(brain, sources);
  if (!activation.hunterReady) {
    throw new Error(
      "Ephemeral public Brand " +
      fixture.id +
      " did not satisfy canonical Hunter readiness: gaps=" +
      activation.readiness.gaps.join(",") +
      "; weak=" +
      activation.weakFields.join(","),
    );
  }

  const snapshot = projectBrandIntelligenceSnapshot({
    brand: { id: brandId, workspaceId, name: fixture.brandName },
    fields: brain,
    sources,
    activation,
  });
  const discoveryPlan = projectInitialBrandDiscoveryPlan(snapshot, 1);
  if (!discoveryPlan.topics.length) {
    throw new Error("Ephemeral public Brand " + fixture.id + " produced no Discovery topics");
  }
  const baseProfile = projectBrandIntelligenceProfile(brain);
  const intelligenceProfile = applyDiscoveryPlan(baseProfile, discoveryPlan);
  const pack = selectSectorIntelligencePack(intelligenceProfile);
  const intelligenceGraph = buildTopicGraph(brain, topicGraphPack(pack.id));
  const projectedBrand = {
    workspaceId,
    brandId,
    contextVersion: snapshot.snapshotVersion + "|" + discoveryPlan.planVersion,
    brandName: snapshot.brandName,
    ...(snapshot.context.positioning
      ? { positioning: snapshot.context.positioning }
      : {}),
    ...(snapshot.context.audience ? { audience: snapshot.context.audience } : {}),
    ...(snapshot.context.voice ? { voice: snapshot.context.voice } : {}),
    ...(snapshot.context.goals ? { goals: snapshot.context.goals } : {}),
    ...(snapshot.context.boundaries
      ? { boundaries: snapshot.context.boundaries }
      : {}),
  };

  const hunterInput: HunterRunInput = {
    accountId,
    brand: projectedBrand,
    intelligenceProfile,
    intelligenceGraph,
    maxEvidence: 20,
    snapshotVersion: snapshot.snapshotVersion,
    planVersion: discoveryPlan.planVersion,
  };

  return {
    workspaceId,
    brandId,
    context: {
      accountId,
      hunterInput,
      discoveryPlan,
    },
  };
}

function applyDiscoveryPlan(
  profile: BrandIntelligenceProfile,
  plan: ReturnType<typeof projectInitialBrandDiscoveryPlan>,
): BrandIntelligenceProfile {
  const topicNames = unique(plan.topics.map((topic) => topic.name));
  const topicAudiences = unique(plan.topics.map((topic) => topic.audience));
  const sourceClasses = unique(
    plan.topics.flatMap((topic) => topic.sourceClasses),
  );
  return {
    ...profile,
    topics: topicNames.length ? topicNames : profile.topics,
    audiences: unique([...topicAudiences, ...profile.audiences]),
    excludedTopics: unique([
      ...plan.excludedTopics,
      ...profile.excludedTopics,
    ]),
    ...(sourceClasses.length
      ? { sourceClasses }
      : profile.sourceClasses?.length
        ? { sourceClasses: profile.sourceClasses }
        : {}),
  };
}

function topicGraphPack(packId: string): SectorPackId {
  if (packId === "ai-technology") return "ai-tech";
  if (packId === "umrah-religious-travel") return "umrah";
  if (packId === "ias-upsc-education") return "ias-upsc";
  if (packId === "motorcycles") return "motorcycles";
  return "generic";
}

function deterministicUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-4" +
    hex.slice(13, 16) +
    "-a" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
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
