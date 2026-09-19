import type {
  BrandBrainBuildResponse,
  BrandBrainSection,
  BuildBrandBrainRequest,
  GuidedBrandObjective,
  KnowledgeSourceDto,
} from "@kairo/contracts";
import { DomainValidationError, type KairoRepository } from "./index";
import { sanitizeBrandEvidenceAtBoundary } from "./brand-brain-evidence-boundary";
import { validateAndDeduplicateBrandBrainProposals } from "./brand-brain-write-gate";

export interface PublicBrandReference {
  url: string;
  title?: string;
  summary?: string;
  excerpt: string;
  retrievedAt: string;
  contentType?: string;
  sizeBytes?: number;
  links?: string[];
}

export interface PublicBrandReferenceReader {
  read(url: string): Promise<PublicBrandReference>;
}

export interface BrandBrainProposal {
  section: BrandBrainSection;
  fieldKey: string;
  value: string;
  sourceIds: string[];
}

export interface BrandBrainProposalInput {
  workspaceId: string;
  brandId: string;
  brandName: string;
  primaryObjective?: string;
  existingConfirmed: Record<string, string>;
  references: Array<PublicBrandReference & { sourceId: string }>;
}

export interface BrandBrainProposalGenerator {
  propose(input: BrandBrainProposalInput): Promise<BrandBrainProposal[]>;
}

const OBJECTIVE_LABELS: Record<GuidedBrandObjective, string> = {
  "grow-audience": "Grow audience",
  "build-authority": "Build authority",
  "generate-leads": "Generate leads",
  "build-community": "Build community",
  "promote-offer": "Promote an offer",
};

const PROPOSAL_FIELDS = new Map<string, BrandBrainSection>([
  ["identity.description", "identity"],
  ["identity.category", "identity"],
  ["identity.geography", "identity"],
  ["identity.language", "identity"],
  ["identity.sector", "identity"],
  ["identity.subsector", "identity"],
  ["identity.products-services", "identity"],
  ["identity.offers", "identity"],
  ["positioning.value-proposition", "positioning"],
  ["positioning.differentiation", "positioning"],
  ["positioning.market-position", "positioning"],
  ["audience.primary", "audience"],
  ["audience.pains", "audience"],
  ["audience.motivations", "audience"],
  ["audience.sophistication", "audience"],
  ["voice.tone", "voice"],
  ["voice.vocabulary", "voice"],
  ["voice.prohibited-wording", "voice"],
  ["voice.examples", "voice"],
  ["content.pillars", "content-strategy"],
  ["content.preferred-topics", "content-strategy"],
  ["content.channels", "content-strategy"],
  ["content.visual-direction", "content-strategy"],
  ["content.color-direction", "content-strategy"],
  ["content.typography-direction", "content-strategy"],
  ["content.imagery-direction", "content-strategy"],
  ["content.logo-guidance", "content-strategy"],
  ["content.authority-areas", "content-strategy"],
  ["content.core-topics", "content-strategy"],
  ["content.related-topics", "content-strategy"],
  ["content.preferred-formats", "content-strategy"],
  ["content.visual-patterns", "content-strategy"],
  ["content.terminology", "content-strategy"],
  ["content.competitors-watchlist", "content-strategy"],
  ["content.evergreen-topics", "content-strategy"],
  ["content.freshness-topics", "content-strategy"],
  ["goals.objectives", "goals"],
  ["boundaries.claims-to-avoid", "boundaries"],
  ["boundaries.prohibited-subjects", "boundaries"],
  ["boundaries.sensitive-subjects", "boundaries"],
  ["boundaries.excluded-topics", "boundaries"],
]);

const SOURCE_REQUIRED_PROPOSAL_FIELDS = new Set([
  "content.visual-direction",
  "content.color-direction",
  "content.typography-direction",
  "content.imagery-direction",
  "content.logo-guidance",
  "goals.objectives",
  "identity.sector", "identity.subsector", "identity.products-services", "identity.offers",
  "content.authority-areas", "content.core-topics", "content.related-topics", "content.preferred-formats",
  "content.visual-patterns", "content.terminology", "content.competitors-watchlist", "content.evergreen-topics", "content.freshness-topics",
  "boundaries.excluded-topics",
]);

const VISUAL_DIRECTION_VALUE_LIMIT = 2_000;

export class BrandBrainBootstrapService {
  constructor(
    private readonly repository: KairoRepository,
    private readonly generator: BrandBrainProposalGenerator | undefined,
    private readonly referenceReader: PublicBrandReferenceReader,
  ) {}

  async build(accountId: string, brandId: string, input: BuildBrandBrainRequest): Promise<BrandBrainBuildResponse> {
    const objective = input.primaryObjective ? objectiveLabel(input.primaryObjective) : undefined;
    const brand = await this.repository.getBrandForAccount(accountId, brandId);
    if (!brand) throw new DomainValidationError("Brand is not available for guided setup");

    const before = await this.repository.listBrandBrainFields(accountId, brandId);
    const existingByKey = new Map(before.map((field) => [field.fieldKey, field]));

    if (objective) {
      await this.repository.putConfirmedBrandBrainField(accountId, brandId, "goals.objectives", {
        section: "goals",
        value: objective,
        ...(existingByKey.get("goals.objectives") ? { expectedVersion: existingByKey.get("goals.objectives")!.version } : {}),
      });
    }

    const ownerBoundary = optionalText(input.ownerBoundary, 4_000);
    if (ownerBoundary) {
      const existing = existingByKey.get("boundaries.owner-directive");
      await this.repository.putConfirmedBrandBrainField(accountId, brandId, "boundaries.owner-directive", {
        section: "boundaries",
        value: ownerBoundary,
        ...(existing ? { expectedVersion: existing.version } : {}),
      });
    }

    const successfulReferences = await this.readReferences(accountId, brandId, [
      brand.publicSourceUrl,
      brand.publicProfileUrl,
      optionalUrl(input.publicReferenceUrl),
    ]);
    const privateExtracts = await this.readActiveKnowledgeExtracts(accountId, brandId, new Set(successfulReferences.map((item) => item.sourceId)));
    successfulReferences.push(...privateExtracts);
    let syntheticFallback = false;
    const fallbackUrl = brand.publicProfileUrl || brand.publicSourceUrl;
    const fallbackHost = publicHostname(fallbackUrl);
    const isSocialFallback = fallbackHost === "instagram.com" || fallbackHost === "www.instagram.com"
      || fallbackHost === "facebook.com" || fallbackHost === "www.facebook.com";
    const isSubstackFallback = fallbackHost === "substack.com" || fallbackHost === "www.substack.com"
      || fallbackHost === "on.substack.com" || fallbackHost.endsWith(".substack.com");
    if (!successfulReferences.length && fallbackUrl && fallbackHost) {
      try {
        const fallbackReference = sanitizeBrandEvidenceAtBoundary({
          url: fallbackUrl,
          title: brand.name,
          excerpt: `Public reference for ${brand.name}. Detailed source evidence is unavailable until the source is connected or refreshed.`,
          retrievedAt: new Date().toISOString(),
        });
        // Keep conservative fallback proposals source-backed so PostgreSQL can
        // persist them and the Brand Brain UI can render them as suggestions.
        const source = await this.ensureSource(accountId, brandId, fallbackReference, await this.repository.listKnowledgeSources(accountId, brandId));
        successfulReferences.push({ ...fallbackReference, sourceId: source.id });
        syntheticFallback = true;
      } catch {
        // A malformed persisted URL must not prevent the owner from continuing setup.
      }
    }

    if (!this.generator) {
      const fallback = fallbackProposals(successfulReferences);
      const brain = await this.persistFallback(accountId, brandId, fallback);
      return {
        brain,
        generatorStatus: fallback.length ? "generated" : "unavailable",
        proposedCount: fallback.length,
        skippedConfirmedCount: 0,
        sourceIds: syntheticFallback ? [] : successfulReferences.map((item) => item.sourceId).filter(Boolean),
      };
    }

    const current = await this.repository.listBrandBrainFields(accountId, brandId);
    const confirmed = Object.fromEntries(current.filter((field) => field.state === "confirmed").map((field) => [field.fieldKey, field.value]));
    let proposals: BrandBrainProposal[];
    try {
      proposals = await this.generator.propose({
        workspaceId: brand.workspaceId,
        brandId: brand.id,
        brandName: brand.name,
        ...(objective ? { primaryObjective: objective } : {}),
        existingConfirmed: confirmed,
        references: successfulReferences,
      });
    } catch {
      const fallback = fallbackProposals(successfulReferences);
      const brain = await this.persistFallback(accountId, brandId, fallback);
      return {
        brain,
        generatorStatus: fallback.length ? "generated" : "unavailable",
        proposedCount: fallback.length,
        skippedConfirmedCount: 0,
        sourceIds: syntheticFallback ? [] : successfulReferences.map((item) => item.sourceId).filter(Boolean),
      };
    }
    if (!proposals.length) {
      const fallback = fallbackProposals(successfulReferences);
      const brain = await this.persistFallback(accountId, brandId, fallback);
      return {
        brain,
        generatorStatus: fallback.length ? "generated" : "unavailable",
        proposedCount: fallback.length,
        skippedConfirmedCount: 0,
        sourceIds: syntheticFallback ? [] : successfulReferences.map((item) => item.sourceId).filter(Boolean),
      };
    }

    const liveFields = new Map((await this.repository.listBrandBrainFields(accountId, brandId)).map((field) => [field.fieldKey, field]));
    const inspectedSourceIds = successfulReferences.map((item) => item.sourceId);
    const inspectedSources = new Set(inspectedSourceIds);

    for (const proposal of proposals) {
      const section = PROPOSAL_FIELDS.get(proposal.fieldKey);
      if (!section || proposal.section !== section) throw new DomainValidationError("Brand Brain proposal is outside the guided allow-list");
    }

    const gatedProposals = validateAndDeduplicateBrandBrainProposals(proposals, {
      inspectedSourceIds: inspectedSources,
      syntheticFallback,
      sourceRequiredFields: SOURCE_REQUIRED_PROPOSAL_FIELDS,
      valueLimit: (fieldKey) => SOURCE_REQUIRED_PROPOSAL_FIELDS.has(fieldKey) ? VISUAL_DIRECTION_VALUE_LIMIT : 10_000,
    });
    let proposedCount = 0;
    let skippedConfirmedCount = 0;

    for (const proposal of gatedProposals) {
      const section = PROPOSAL_FIELDS.get(proposal.fieldKey)!;
      const existing = liveFields.get(proposal.fieldKey);
      if (existing?.state === "confirmed") {
        skippedConfirmedCount += 1;
        continue;
      }
      const written = await this.repository.recordInferredBrandBrainField(accountId, brandId, {
        section,
        fieldKey: proposal.fieldKey,
        value: proposal.value,
        sourceIds: proposal.sourceIds,
        ...(existing ? { expectedVersion: existing.version } : {}),
      });
      liveFields.set(proposal.fieldKey, written);
      proposedCount += 1;
    }

    return {
      brain: await this.repository.listBrandBrainFields(accountId, brandId),
      generatorStatus: "generated",
      proposedCount,
      skippedConfirmedCount,
      sourceIds: syntheticFallback ? [] : inspectedSourceIds.filter(Boolean),
    };
  }

  private async persistFallback(accountId: string, brandId: string, proposals: BrandBrainProposal[]) {
    for (const proposal of proposals) {
      const section = PROPOSAL_FIELDS.get(proposal.fieldKey);
      if (!section || proposal.section !== section) throw new DomainValidationError("Brand Brain proposal is outside the guided allow-list");
    }
    const inspectedSources = new Set(proposals.flatMap((proposal) => proposal.sourceIds));
    const gatedProposals = validateAndDeduplicateBrandBrainProposals(proposals, {
      inspectedSourceIds: inspectedSources,
      syntheticFallback: false,
      sourceRequiredFields: SOURCE_REQUIRED_PROPOSAL_FIELDS,
      valueLimit: (fieldKey) => SOURCE_REQUIRED_PROPOSAL_FIELDS.has(fieldKey) ? VISUAL_DIRECTION_VALUE_LIMIT : 10_000,
    });

    for (const proposal of gatedProposals) {
      const existing = (await this.repository.listBrandBrainFields(accountId, brandId)).find((field) => field.fieldKey === proposal.fieldKey);
      if (existing?.state === "confirmed") continue;
      await this.repository.recordInferredBrandBrainField(accountId, brandId, {
        section: proposal.section, fieldKey: proposal.fieldKey, value: proposal.value, sourceIds: proposal.sourceIds,
        ...(existing ? { expectedVersion: existing.version } : {}),
      });
    }
    return this.repository.listBrandBrainFields(accountId, brandId);
  }

  private async readActiveKnowledgeExtracts(
    accountId: string,
    brandId: string,
    excludedSourceIds: ReadonlySet<string>,
  ): Promise<Array<PublicBrandReference & { sourceId: string }>> {
    if (!this.repository.listActiveKnowledgeExtractsForBrandBrain) return [];
    const extracts = await this.repository.listActiveKnowledgeExtractsForBrandBrain(accountId, brandId);
    return extracts
      .filter((item) => !excludedSourceIds.has(item.sourceId) && item.excerpt.trim())
      .slice(0, 5)
      .flatMap((item) => {
        try {
          const internalUrl = `kairo-knowledge://${encodeURIComponent(item.sourceId)}`;
          const sanitized = sanitizeBrandEvidenceAtBoundary({
            url: item.sourceUrl ?? `https://kairo.invalid/knowledge/${encodeURIComponent(item.sourceId)}`,
            ...(item.title ? { title: item.title } : {}),
            excerpt: item.excerpt,
            retrievedAt: item.updatedAt,
            ...(item.contentType ? { contentType: item.contentType } : {}),
          }, "untrusted_knowledge");
          return [{
            sourceId: item.sourceId,
            ...sanitized,
            url: item.sourceUrl ? sanitized.url : internalUrl,
          }];
        } catch {
          // Unsafe or malformed knowledge evidence cannot cross into Brand Brain.
          return [];
        }
      });
  }

  private async readReferences(
    accountId: string,
    brandId: string,
    candidates: Array<string | undefined>,
  ): Promise<Array<PublicBrandReference & { sourceId: string }>> {
    const unique = [...new Set(candidates.filter((value): value is string => Boolean(value)).map((value) => value.trim()).filter(Boolean))];
    const existingSources = await this.repository.listKnowledgeSources(accountId, brandId);
    const result: Array<PublicBrandReference & { sourceId: string }> = [];

    for (const candidate of unique.slice(0, 3)) {
      try {
        const reference = sanitizeBrandEvidenceAtBoundary(await this.referenceReader.read(candidate));
        const source = await this.ensureSource(accountId, brandId, reference, existingSources);
        result.push({ ...reference, sourceId: source.id });
      } catch {
        // Public-reference failure or unsafe evidence is isolated. Existing Brand context can still remain available.
      }
    }
    return result;
  }

  private async ensureSource(
    accountId: string,
    brandId: string,
    reference: PublicBrandReference,
    existingSources: KnowledgeSourceDto[],
  ): Promise<KnowledgeSourceDto> {
    const existing = existingSources.find((source) => source.status === "active" && source.sourceUrl === reference.url);
    if (existing) return existing;
    const isPdf = reference.contentType?.toLowerCase() === "application/pdf";
    const created = await this.repository.createKnowledgeSource(accountId, brandId, {
      type: isPdf ? "document" : "url",
      status: "active",
      title: reference.title ?? (isPdf ? "Public Brand PDF" : "Public Brand reference"),
      sourceUrl: reference.url,
      ...(reference.contentType ? { contentType: reference.contentType } : {}),
      ...(reference.sizeBytes ? { sizeBytes: reference.sizeBytes } : {}),
    });
    existingSources.push(created);
    return created;
  }
}

function objectiveLabel(value: unknown): string {
  if (typeof value !== "string" || !(value in OBJECTIVE_LABELS)) throw new DomainValidationError("primaryObjective is not supported");
  return OBJECTIVE_LABELS[value as GuidedBrandObjective];
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new DomainValidationError("ownerBoundary must be text");
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new DomainValidationError("ownerBoundary is too long");
  return normalized;
}

function fallbackProposals(references: Array<PublicBrandReference & { sourceId: string }>): BrandBrainProposal[] {
  const github = references.find((reference) => {
    try { return new URL(reference.url).hostname.toLowerCase() === "github.com"; } catch { return false; }
  });
  const social = references.find((reference) => {
    try { return ["instagram.com", "facebook.com", "www.instagram.com", "www.facebook.com"].includes(new URL(reference.url).hostname.toLowerCase()); } catch { return false; }
  });
  const substack = references.find((reference) => {
    try { const host = new URL(reference.url).hostname.toLowerCase(); return host === "substack.com" || host === "www.substack.com" || host === "on.substack.com" || host.endsWith(".substack.com"); } catch { return false; }
  });
  const reference = github ?? social ?? substack ?? references[0];
  if (!reference) return [];
  const isSocial = reference === social;
  const isSubstack = reference === substack;
  const isGithub = reference === github;
  const title = reference.title?.trim()
    || (isSocial ? "Public social profile"
      : isSubstack ? "Public newsletter"
        : isGithub ? "Public GitHub repository"
          : "Public Brand website");
  const excerpt = reference.excerpt.trim().replace(/\s+/g, " ").slice(0, 800);
  const sourceIds = [reference.sourceId];
  if (isSocial) return [
    { section: "identity", fieldKey: "identity.description", value: excerpt ? `${title}. ${excerpt}` : title, sourceIds },
    { section: "identity", fieldKey: "identity.category", value: "Public social profile — category not yet confirmed", sourceIds },
    { section: "audience", fieldKey: "audience.primary", value: "The Brand's audience, to be confirmed from connected or readable source evidence", sourceIds },
    { section: "voice", fieldKey: "voice.tone", value: "To be confirmed from the Brand's published content", sourceIds },
    { section: "content-strategy", fieldKey: "content.pillars", value: "Topics and themes from the Brand's published content, to be confirmed", sourceIds },
    { section: "content-strategy", fieldKey: "content.preferred-topics", value: "Brand-relevant topics grounded in connected or readable source evidence", sourceIds },
    { section: "content-strategy", fieldKey: "content.channels", value: "The connected social profile and other channels confirmed by the Brand owner", sourceIds },
  ];
  if (isSubstack) return [
    { section: "identity", fieldKey: "identity.description", value: excerpt ? `${title}. ${excerpt}` : title, sourceIds },
    { section: "identity", fieldKey: "identity.category", value: "Independent publishing and newsletter media", sourceIds },
    { section: "audience", fieldKey: "audience.primary", value: "Readers interested in the publication's subject and perspective", sourceIds },
    { section: "voice", fieldKey: "voice.tone", value: "Clear, thoughtful and editorial", sourceIds },
    { section: "content-strategy", fieldKey: "content.pillars", value: "Editorial stories, analysis, practical guidance and community perspectives", sourceIds },
    { section: "content-strategy", fieldKey: "content.preferred-topics", value: "Publication themes, timely analysis, useful explainers and reader questions", sourceIds },
    { section: "content-strategy", fieldKey: "content.channels", value: "Substack, email newsletters, web articles and social communities", sourceIds },
  ];
  if (!isSocial && !isSubstack && !github) return [
    { section: "identity", fieldKey: "identity.description", value: conciseWebsiteDescription(title, excerpt), sourceIds },
    { section: "identity", fieldKey: "identity.category", value: deriveWebsiteCategory(title, excerpt), sourceIds },
    { section: "identity", fieldKey: "identity.products-services", value: deriveWebsiteOfferings(title, excerpt), sourceIds },
    { section: "positioning", fieldKey: "positioning.value-proposition", value: deriveWebsitePositioning(title, excerpt), sourceIds },
    { section: "audience", fieldKey: "audience.primary", value: deriveWebsiteAudience(title, excerpt), sourceIds },
    { section: "voice", fieldKey: "voice.tone", value: "Clear, useful and audience-focused", sourceIds },
    { section: "content-strategy", fieldKey: "content.pillars", value: deriveWebsitePillars(title, excerpt), sourceIds },
    { section: "content-strategy", fieldKey: "content.preferred-topics", value: deriveWebsitePreferredTopics(title, excerpt), sourceIds },
    { section: "content-strategy", fieldKey: "content.channels", value: "Website, email, social communities and relevant professional channels", sourceIds },
    { section: "boundaries", fieldKey: "boundaries.excluded-topics", value: "No excluded topics identified in the public reference; confirm before Hunter activation", sourceIds },
  ];
  return [
    { section: "identity", fieldKey: "identity.description", value: excerpt ? `${title}. ${excerpt}` : title, sourceIds },
    { section: "identity", fieldKey: "identity.category", value: "Open-source software and developer tools", sourceIds },
    { section: "audience", fieldKey: "audience.primary", value: "Software developers and technical practitioners interested in this repository's subject", sourceIds },
    { section: "voice", fieldKey: "voice.tone", value: "Clear, practical and technically precise", sourceIds },
    { section: "content-strategy", fieldKey: "content.pillars", value: "Open-source software, developer tutorials, implementation examples and project updates", sourceIds },
    { section: "content-strategy", fieldKey: "content.preferred-topics", value: "Repository capabilities, APIs, usage examples, releases and developer workflows", sourceIds },
    { section: "content-strategy", fieldKey: "content.channels", value: "Developer communities, technical blogs, LinkedIn and YouTube", sourceIds },
  ];
}

function conciseWebsiteDescription(title: string, excerpt: string): string {
  const normalized = excerpt.replace(/\s+/g, " ").trim();
  if (!normalized) return title;
  const firstUsefulSentence = normalized
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => sentence.length >= 24 && sentence.length <= 280) ?? normalized.slice(0, 260);
  const withoutRepeatedTitle = firstUsefulSentence
    .replace(new RegExp(`^${escapeRegExp(title)}[.!|:\\-–— ]*`, "i"), "")
    .trim();
  const description = withoutRepeatedTitle || firstUsefulSentence;
  return `${title}. ${description}`.slice(0, 320).replace(/\s+([,.;:!?])/g, "$1").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveWebsiteOfferings(title: string, excerpt: string): string {
  const text = `${title} ${excerpt}`;
  if (isVehicleRentalText(text)) return "Vehicle rental and fleet booking services, including online reservations";
  if (isAutomotiveText(text)) return "Automotive, vehicle or mobility products and related owner services";
  if (isDeveloperSoftwareText(text)) return "Programming language, developer tooling, documentation and software ecosystem resources";
  if (isFoodHospitalityText(text)) return "Food, dining, menu and restaurant services for customers and guests";
  return `${title} products or services described in the public reference: ${excerpt.slice(0, 300)}`;
}

function deriveWebsiteCategory(title: string, excerpt: string): string {
  const text = `${title} ${excerpt}`;
  if (isVehicleRentalText(text)) return "Vehicle rental, fleet and mobility services";
  if (isAutomotiveText(text)) return "Automotive, vehicles and mobility";
  if (isDeveloperSoftwareText(text)) return "Software, developer tools and technology";
  if (isFoodHospitalityText(text)) return "Restaurant, food and hospitality";
  return "Business or organization website";
}

function deriveWebsitePositioning(title: string, excerpt: string): string {
  const text = `${title} ${excerpt}`;
  if (isVehicleRentalText(text)) return `${title} provides vehicle rental, booking and mobility services for customers and fleets.`;
  if (isAutomotiveText(text)) return `${title} provides vehicle, mobility or ownership value for drivers and riders.`;
  if (isDeveloperSoftwareText(text)) return `${title} provides software capabilities, documentation and ecosystem resources for developers and technical teams.`;
  if (isFoodHospitalityText(text)) return `${title} provides food, menu and dining experiences for customers and guests.`;
  const claim = excerpt.match(/[^.!?]*(?:lowest|best|trusted|quality|value|specialist|expert)[^.!?]*/i)?.[0]?.trim();
  return claim ? `${title}: ${claim}` : `${title} provides the products or services described in its public reference.`;
}

function deriveWebsiteAudience(title: string, excerpt: string): string {
  const text = `${title} ${excerpt}`;
  if (isVehicleRentalText(text)) return "People and businesses seeking vehicle rental, mobility or fleet services";
  if (isAutomotiveText(text)) return "Drivers, riders, owners and people researching vehicles or mobility";
  if (isDeveloperSoftwareText(text)) return "Software developers, learners and technical teams using the language, tools or platform";
  if (isFoodHospitalityText(text)) return "Diners, guests and customers looking for food, menus or restaurant experiences";
  return `Customers seeking ${title.toLowerCase()} products or services`;
}

function deriveWebsitePillars(title: string, excerpt: string): string {
  const text = `${title} ${excerpt}`;
  if (isDeveloperSoftwareText(text)) return "Software development, programming tutorials, documentation, releases and community updates";
  if (isVehicleRentalText(text)) return "Vehicle selection, rental booking guidance, mobility and fleet updates";
  if (isAutomotiveText(text)) return "Vehicles, ownership guidance, driving or riding insights and mobility updates";
  if (isFoodHospitalityText(text)) return "Menus, food, dining experiences, customer guidance and venue updates";
  return "Brand story, products or services, practical guidance and customer value";
}

function deriveWebsitePreferredTopics(title: string, excerpt: string): string {
  const text = `${title} ${excerpt}`;
  if (isDeveloperSoftwareText(text)) return "Programming capabilities, developer tutorials, documentation, releases and ecosystem news";
  if (isVehicleRentalText(text)) return "Vehicle availability, rental booking, trip planning, mobility guidance and fleet updates";
  if (isAutomotiveText(text)) return "Vehicle features, ownership, maintenance, driving or riding guidance and mobility news";
  if (isFoodHospitalityText(text)) return "Menus, seasonal food, dining guidance, customer questions and restaurant updates";
  return "What the Brand offers, customer questions, useful advice and relevant updates";
}

function isDeveloperSoftwareText(value: string): boolean {
  return /\b(?:software|platform|platforms|api|apis|saas|app|apps|application|applications|programming|developer|developers|documentation|library|libraries|framework|frameworks|database|databases|open[ -]source)\b/i.test(value);
}

function isVehicleRentalText(value: string): boolean {
  return /\b(?:rental|rentals|rent|hire|booking|fleet|fleets)\b/i.test(value)
    && /\b(?:vehicle|vehicles|car|cars|motorcycle|motorcycles|bike|bikes|mobility)\b/i.test(value);
}

function isAutomotiveText(value: string): boolean {
  return /\b(?:vehicle|vehicles|automotive|car|cars|motorcycle|motorcycles|bike|bikes|mobility|driver|drivers|rider|riders)\b/i.test(value);
}

function isFoodHospitalityText(value: string): boolean {
  return /\b(?:restaurant|restaurants|menu|menus|food|cafe|cafes|dining|chef|chefs|cuisine)\b/i.test(value);
}

function publicHostname(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname.toLowerCase() : "";
  } catch { return ""; }
}

function optionalUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new DomainValidationError("publicReferenceUrl must be a URL");
  const text = value.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsafe");
    return url.toString();
  } catch {
    throw new DomainValidationError("publicReferenceUrl must be a valid public HTTP(S) URL");
  }
}
