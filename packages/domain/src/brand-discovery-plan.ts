import { ConcurrencyConflictError, DomainValidationError, ResourceNotFoundError } from "./index";
import type { BrandIntelligenceSnapshot } from "./brand-intelligence-snapshot";

export const BRAND_DISCOVERY_PLAN_SCHEMA_VERSION = "1" as const;

export interface BrandDiscoveryTopic {
  id: string;
  name: string;
  priority: "High" | "Medium";
  audience: string;
  entities: string[];
  sourceClasses: string[];
}

export type BrandDiscoveryPlanState = "initial" | "customized";

export interface BrandDiscoveryPlan {
  schemaVersion: typeof BRAND_DISCOVERY_PLAN_SCHEMA_VERSION;
  workspaceId: string;
  brandId: string;
  revision: number;
  planVersion: string;
  snapshotVersion: string;
  state: BrandDiscoveryPlanState;
  topics: BrandDiscoveryTopic[];
  excludedTopics: string[];
  updatedAt: string | null;
}

export interface BrandDiscoveryPlanRepository {
  getLatest(accountId: string, brandId: string): Promise<BrandDiscoveryPlan | undefined>;
  append(accountId: string, plan: BrandDiscoveryPlan): Promise<BrandDiscoveryPlan>;
}

export interface UpdateBrandDiscoveryTopicInput {
  expectedRevision: number;
  name?: string;
  audience?: string;
  entities?: string[];
  sourceClasses?: string[];
}

export class BrandDiscoveryPlanService {
  constructor(private readonly repository: BrandDiscoveryPlanRepository) {}

  async ensure(accountId: string, snapshot: BrandIntelligenceSnapshot): Promise<BrandDiscoveryPlan> {
    const current = await this.repository.getLatest(accountId, snapshot.brandId);
    if (!current) return this.repository.append(accountId, projectInitialBrandDiscoveryPlan(snapshot, 1));
    if (current.snapshotVersion === snapshot.snapshotVersion || current.state === "customized") return current;
    return this.repository.append(accountId, projectInitialBrandDiscoveryPlan(snapshot, current.revision + 1));
  }

  async get(accountId: string, brandId: string): Promise<BrandDiscoveryPlan | undefined> {
    return this.repository.getLatest(accountId, brandId);
  }

  async updateTopic(accountId: string, brandId: string, topicId: string, input: UpdateBrandDiscoveryTopicInput): Promise<BrandDiscoveryPlan> {
    const current = await this.repository.getLatest(accountId, brandId);
    if (!current) throw new ResourceNotFoundError("Discovery Plan not found");
    const expectedRevision = positiveRevision(input.expectedRevision);
    if (current.revision !== expectedRevision) throw new ConcurrencyConflictError("Discovery Plan changed; refresh before editing this topic");
    const index = current.topics.findIndex((topic) => topic.id === topicId);
    if (index < 0) throw new ResourceNotFoundError("Discovery topic not found");

    const topic = current.topics[index]!;
    const next: BrandDiscoveryTopic = {
      ...topic,
      ...(input.name !== undefined ? { name: requiredText(input.name, "topic name", 180) } : {}),
      ...(input.audience !== undefined ? { audience: requiredText(input.audience, "target audience", 240) } : {}),
      ...(input.entities !== undefined ? { entities: normalizeEntities(input.entities) } : {}),
      ...(input.sourceClasses !== undefined ? { sourceClasses: normalizeSourceClasses(input.sourceClasses) } : {}),
    };
    const topics = current.topics.map((item, itemIndex) => itemIndex === index ? next : item);
    const revision = current.revision + 1;
    return this.repository.append(accountId, {
      ...current,
      revision,
      planVersion: planVersion(current.snapshotVersion, revision),
      state: "customized",
      topics,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Creates the first persistent-shape Discovery Plan from canonical Brand intelligence.
 * Hunter later consumes the exact planVersion + snapshotVersion pair. Onboarding never
 * invents run results to make Discovery Intelligence useful.
 */
export function projectInitialBrandDiscoveryPlan(snapshot: BrandIntelligenceSnapshot, revision = 1): BrandDiscoveryPlan {
  const field = (key: string) => snapshot.fields.find((item) => item.fieldKey === key && item.state !== "stale")?.value.trim() ?? "";
  const audience = field("audience.primary") || "Brand audience";
  const geography = field("identity.geography");
  const sector = field("identity.sector") || field("identity.category");
  const topics = unique([
    ...splitList(field("content.preferred-topics")),
    ...splitList(field("content.core-topics")),
    ...splitList(field("content.pillars")),
    ...splitList(field("content.authority-areas")),
    ...splitList(field("content.related-topics")),
  ]).slice(0, 6);

  const fallbackTopics = unique([sector, field("identity.products-services"), field("positioning.value-proposition")]).filter(Boolean).slice(0, 3);
  const chosen = topics.length ? topics : fallbackTopics;
  const channelClasses = sourceClasses(splitList(field("content.channels")));

  return {
    schemaVersion: BRAND_DISCOVERY_PLAN_SCHEMA_VERSION,
    workspaceId: snapshot.workspaceId,
    brandId: snapshot.brandId,
    revision: positiveRevision(revision),
    planVersion: planVersion(snapshot.snapshotVersion, revision),
    snapshotVersion: snapshot.snapshotVersion,
    state: "initial",
    topics: chosen.map((name, index) => ({
      id: slug(name, index),
      name,
      priority: index < 3 ? "High" : "Medium",
      audience,
      entities: unique([name, geography ? `${name} ${geography}` : "", sector ? `${name} ${sector}` : ""]).filter(Boolean).slice(0, 5),
      sourceClasses: channelClasses,
    })),
    excludedTopics: unique([
      ...splitList(field("boundaries.excluded-topics")),
      ...splitList(field("boundaries.prohibited-subjects")),
      ...splitList(field("boundaries.claims-to-avoid")),
      ...splitList(field("boundaries.owner-directive")),
    ]).slice(0, 20),
    updatedAt: snapshot.updatedAt,
  };
}

function planVersion(snapshotVersion: string, revision: number): string {
  return `${snapshotVersion}:discovery:${positiveRevision(revision)}`;
}

function positiveRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new DomainValidationError("revision must be a positive integer");
  return value as number;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(`${field} is required`);
  if (normalized.length > max) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function normalizeEntities(values: unknown): string[] {
  if (!Array.isArray(values)) throw new DomainValidationError("entities must be a list");
  const normalized = unique(values.map((value) => requiredText(value, "entity", 180))).slice(0, 12);
  if (!normalized.length) throw new DomainValidationError("at least one search entity is required");
  return normalized;
}

function normalizeSourceClasses(values: unknown): string[] {
  if (!Array.isArray(values)) throw new DomainValidationError("sourceClasses must be a list");
  return unique(values.map((value) => requiredText(value, "source class", 120))).slice(0, 20);
}

function sourceClasses(channels: string[]): string[] {
  const values = new Set<string>(["Official sources", "Industry news"]);
  for (const channel of channels.map((value) => value.toLowerCase())) {
    if (channel.includes("linkedin")) values.add("LinkedIn");
    if (channel.includes("youtube")) values.add("YouTube");
    if (channel.includes("instagram")) values.add("Instagram");
    if (channel.includes("reddit")) values.add("Community discussions");
  }
  return [...values];
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,;|·•]+/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 180);
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

function slug(value: string, index: number): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
  return normalized || `topic-${index + 1}`;
}
