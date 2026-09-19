import type { InvocationScope, JsonValue, ToolProvenance } from "./index";

export class SourceContractError extends Error {
  readonly code = "source_contract_error";
}

export type SourcePlatform = "website" | "web" | "instagram" | "facebook" | "linkedin" | "youtube" | "substack" | "rss" | "hacker-news" | "github" | "unsupported";
export type SourceHealthStatus = "available" | "degraded" | "unavailable";

export interface SourceIdentity { canonicalUrl: string; platform: SourcePlatform; sourceType: string }
export interface SourceHealth { status: SourceHealthStatus; reason?: string; checkedAt?: string }
export interface SourceFetchRequest { url: string; scope: InvocationScope; timeoutMs: number; forceRefresh?: boolean }
export interface RawSourceDocument { canonicalUrl: string; retrievedAt: string; contentHash: string; payload: JsonValue; warnings?: string[] }
export interface SourceImage { url: string; alt?: string; width?: number; height?: number }
export interface SourceVideoMetadata { url?: string; durationSeconds?: number; width?: number; height?: number; format?: string }
export interface RepresentativeFrame { timestampSeconds?: number; imageUrl?: string; ocrText?: string }

export interface NormalizedSourceDocument {
  canonicalUrl: string;
  platform: SourcePlatform;
  sourceType: string;
  profile?: string;
  publisher?: string;
  author?: string;
  title?: string;
  description?: string;
  body?: string;
  captions?: string;
  transcript?: string;
  publishedAt?: string;
  retrievedAt: string;
  images?: SourceImage[];
  video?: SourceVideoMetadata;
  representativeFrames?: RepresentativeFrame[];
  engagement?: Record<string, number>;
  tags?: string[];
  externalLinks?: string[];
  contentHash: string;
  provider: string;
  providerVersion: string;
  parserVersion: string;
  provenance: ToolProvenance[];
  confidence: number;
  extractionWarnings: string[];
  trust: "untrusted-evidence";
}

export interface SourceAdapter {
  readonly id: string;
  readonly version: string;
  readonly priority?: number;
  supports(url: URL): boolean;
  identify(url: URL): SourceIdentity;
  fetch(request: SourceFetchRequest): Promise<RawSourceDocument>;
  normalize(raw: RawSourceDocument, identity: SourceIdentity): Promise<NormalizedSourceDocument>;
  health(): Promise<SourceHealth>;
}

export interface NormalizedSourceCache {
  get(key: string): Promise<NormalizedSourceDocument | undefined>;
  set(key: string, value: NormalizedSourceDocument): Promise<void>;
  getLatest(key: string): Promise<NormalizedSourceDocument | undefined>;
  setLatest(key: string, value: NormalizedSourceDocument): Promise<void>;
}

export interface PublicContentFetchPort {
  fetch(request: SourceFetchRequest): Promise<{ document: NormalizedSourceDocument; adapterId: string; cacheHit: boolean }>;
}

export class InMemoryNormalizedSourceCache implements NormalizedSourceCache {
  private readonly values = new Map<string, NormalizedSourceDocument>();
  private readonly writtenAt = new Map<string, number>();
  constructor(private readonly maxEntries = 500, private readonly latestTtlMs = 15 * 60_000, private readonly now = () => Date.now()) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) throw new SourceContractError("maxEntries must be from 1 to 10000");
    if (!Number.isFinite(latestTtlMs) || latestTtlMs < 0) throw new SourceContractError("latestTtlMs must be non-negative");
  }
  async get(key: string) { const value = this.values.get(key); return value ? structuredClone(value) : undefined; }
  async set(key: string, value: NormalizedSourceDocument) {
    if (!this.values.has(key) && this.values.size >= this.maxEntries) {
      const oldest = this.values.keys().next().value as string;
      this.values.delete(oldest);
      this.writtenAt.delete(oldest);
    }
    this.values.set(key, structuredClone(value));
    this.writtenAt.set(key, this.now());
  }
  async getLatest(key: string) {
    const storageKey = `latest:${key}`;
    const writtenAt = this.writtenAt.get(storageKey);
    if (writtenAt === undefined || this.now() - writtenAt > this.latestTtlMs) {
      this.values.delete(storageKey);
      this.writtenAt.delete(storageKey);
      return undefined;
    }
    return this.get(storageKey);
  }
  async setLatest(key: string, value: NormalizedSourceDocument) { await this.set(`latest:${key}`, value); }
}

export class SourceRouter implements PublicContentFetchPort {
  private readonly adapters: SourceAdapter[];
  constructor(adapters: readonly SourceAdapter[], private readonly cache?: NormalizedSourceCache) {
    this.adapters = [...adapters].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  static identify(input: string | URL): SourceIdentity {
    const canonicalUrl = normalizeCanonicalUrl(input.toString());
    const url = new URL(canonicalUrl);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.toLowerCase();
    if (host === "instagram.com") return identity(canonicalUrl, "instagram", path.startsWith("/reel/") ? "reel" : path.startsWith("/p/") ? "post" : "profile");
    if (host === "facebook.com" || host === "fb.watch") return identity(canonicalUrl, "facebook", /\/(reel|watch)\//.test(path) ? "reel" : /\/posts?\//.test(path) ? "post" : "page");
    if (host === "linkedin.com") return identity(canonicalUrl, "linkedin", path.startsWith("/company/") ? "company" : path.startsWith("/posts/") || path.includes("/feed/update/") ? "post" : "profile");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return identity(canonicalUrl, "youtube", host === "youtu.be" || path === "/watch" || path.startsWith("/shorts/") ? (path.startsWith("/shorts/") ? "short" : "video") : "channel");
    if (host.endsWith(".substack.com") || host === "substack.com") return identity(canonicalUrl, "substack", path.startsWith("/p/") ? "post" : "publication");
    if (host === "news.ycombinator.com") return identity(canonicalUrl, "hacker-news", path === "/item" ? "discussion" : path === "/user" ? "profile" : "story-list");
    if (host === "github.com") return identity(canonicalUrl, "github", path.split("/").filter(Boolean).length >= 2 ? "repository" : "profile");
    if (/\/(feed|rss|atom)(\.xml)?\/?$/.test(path) || /\.(rss|atom|xml)$/.test(path)) return identity(canonicalUrl, "rss", "feed");
    if (path === "/" || path === "") return identity(canonicalUrl, "website", "website");
    return identity(canonicalUrl, "web", "article");
  }

  async fetch(request: SourceFetchRequest): Promise<{ document: NormalizedSourceDocument; adapterId: string; cacheHit: boolean }> {
    const canonicalUrl = normalizeCanonicalUrl(request.url);
    const url = new URL(canonicalUrl);
    const adapters = this.adapters.filter((adapter) => adapter.supports(url));
    if (!adapters.length) throw new SourceContractError("No source adapter supports this URL");
    const failures: string[] = [];
    for (const adapter of adapters) {
      const health = await adapter.health();
      if (health.status === "unavailable") { failures.push(`${adapter.id}: ${health.reason ?? "unavailable"}`); continue; }
      try {
        const latestKey = sourceLatestCacheKey(request.scope, canonicalUrl, adapter.version);
        const latest = request.forceRefresh ? undefined : await this.cache?.getLatest(latestKey);
        if (latest) return { document: latest, adapterId: adapter.id, cacheHit: true };
        const raw = await adapter.fetch({ ...request, url: canonicalUrl });
        const key = sourceCacheKey(request.scope, raw.canonicalUrl, raw.contentHash, adapter.version);
        const cached = await this.cache?.get(key);
        if (cached) return { document: cached, adapterId: adapter.id, cacheHit: true };
        const document = prepareNormalizedSourceDocument(await adapter.normalize(raw, adapter.identify(url)));
        await this.cache?.set(key, document);
        await this.cache?.setLatest(latestKey, document);
        return { document, adapterId: adapter.id, cacheHit: false };
      } catch (error) {
        failures.push(`${adapter.id}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }
    throw new SourceContractError(`Source fetch unavailable (${failures.join("; ")})`);
  }
}

export function prepareNormalizedSourceDocument(input: Omit<NormalizedSourceDocument, "trust"> & { trust?: "untrusted-evidence" }): NormalizedSourceDocument {
  const canonicalUrl = normalizeCanonicalUrl(input.canonicalUrl);
  const platforms: readonly SourcePlatform[] = ["website", "web", "instagram", "facebook", "linkedin", "youtube", "substack", "rss", "hacker-news", "github", "unsupported"];
  if (!platforms.includes(input.platform)) throw new SourceContractError("platform is not supported");
  const sourceType = boundedOptionalText(input.sourceType, 120, "sourceType");
  if (!sourceType) throw new SourceContractError("sourceType is required");
  const retrievedAt = isoDate(input.retrievedAt, "retrievedAt");
  const confidence = finiteRange(input.confidence, 0, 1, "confidence");
  if (!input.contentHash.trim() || input.contentHash.length > 200) throw new SourceContractError("contentHash is required and bounded");
  if (!input.provider.trim() || !input.providerVersion.trim() || !input.parserVersion.trim()) throw new SourceContractError("provider and parser versions are required");
  const warnings = boundedStrings(input.extractionWarnings, 50, 500, "extractionWarnings");
  const provenance = input.provenance.map((entry) => ({ ...entry, sourceUrl: entry.sourceUrl ? normalizeCanonicalUrl(entry.sourceUrl) : canonicalUrl, retrievedAt: isoDate(entry.retrievedAt, "provenance.retrievedAt") }));
  if (!provenance.length) throw new SourceContractError("provenance is required");
  const title = boundedOptionalText(input.title, 1_000, "title");
  const description = boundedOptionalText(input.description, 10_000, "description");
  const body = boundedOptionalText(input.body, 200_000, "body");
  const captions = boundedOptionalText(input.captions, 200_000, "captions");
  const transcript = boundedOptionalText(input.transcript, 500_000, "transcript");
  const tags = input.tags ? boundedStrings(input.tags, 200, 200, "tags") : undefined;
  const externalLinks = input.externalLinks?.slice(0, 500).map(normalizeCanonicalUrl);
  return structuredClone({
    ...input,
    canonicalUrl,
    sourceType,
    retrievedAt,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(body ? { body } : {}),
    ...(captions ? { captions } : {}),
    ...(transcript ? { transcript } : {}),
    ...(tags ? { tags } : {}),
    ...(externalLinks ? { externalLinks } : {}),
    confidence,
    extractionWarnings: warnings,
    provenance,
    trust: "untrusted-evidence",
  });
}

export function normalizeCanonicalUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new SourceContractError("source URL must be valid"); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new SourceContractError("source URL must be credential-free HTTP(S)");
  for (const key of url.searchParams.keys()) {
    if (/(^|[-_])(api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret|cookie|session|signature|sig)([-_]|$)/i.test(key)) {
      throw new SourceContractError("source URL must not contain credential-like query parameters");
    }
  }
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hostname = url.hostname.toLowerCase();
  const sorted = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  url.search = "";
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function sourceCacheKey(scope: InvocationScope, canonicalUrl: string, contentHash: string, adapterVersion: string): string {
  const scopeKey = scope.visibility === "global-public" ? "global-public" : `brand-private:${scope.workspaceId}:${scope.brandId}`;
  return `${scopeKey}|${normalizeCanonicalUrl(canonicalUrl)}|${contentHash}|${adapterVersion}`;
}

export function sourceLatestCacheKey(scope: InvocationScope, canonicalUrl: string, adapterVersion: string): string {
  const scopeKey = scope.visibility === "global-public" ? "global-public" : `brand-private:${scope.workspaceId}:${scope.brandId}`;
  return `${scopeKey}|${normalizeCanonicalUrl(canonicalUrl)}|${adapterVersion}`;
}

function identity(canonicalUrl: string, platform: SourcePlatform, sourceType: string): SourceIdentity { return { canonicalUrl, platform, sourceType }; }
function isoDate(value: string, field: string) { const parsed = new Date(value); if (!value || Number.isNaN(parsed.valueOf())) throw new SourceContractError(`${field} must be an ISO date`); return parsed.toISOString(); }
function finiteRange(value: number, min: number, max: number, field: string) { if (!Number.isFinite(value) || value < min || value > max) throw new SourceContractError(`${field} must be from ${min} to ${max}`); return value; }
function boundedStrings(values: readonly string[], maxItems: number, maxLength: number, field: string) { if (values.length > maxItems) throw new SourceContractError(`${field} has too many items`); return values.map((value) => { const text = value.trim(); if (!text || text.length > maxLength) throw new SourceContractError(`${field} contains an invalid item`); return text; }); }
function boundedOptionalText(value: string | undefined, maxLength: number, field: string) { if (value === undefined) return undefined; const text = value.trim(); if (!text || text.length > maxLength) throw new SourceContractError(`${field} is invalid`); return text; }
