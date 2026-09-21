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
  type BrandBrainProposalGenerator,
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
import { BrandBrainBuilder } from "@kairo/worker/brand-brain-builder";
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
    input.proposalGenerator ?? new BrandBrainBuilder(input.runtime);
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
