import { createHash } from "node:crypto";
import {
  SourceRouter,
  normalizeCanonicalUrl,
  prepareNormalizedSourceDocument,
  type JsonValue,
  type NormalizedSourceDocument,
  type RawSourceDocument,
  type SourceAdapter,
  type SourceFetchRequest,
  type SourceHealth,
  type SourceIdentity,
} from "@kairo/agent-contracts";
import type { PublicBrandReference, PublicBrandReferenceReader } from "@kairo/domain/brand-brain-bootstrap";
import { parseRssAtomFeed } from "@kairo/worker/public-discovery-adapters";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SourceProviderError extends Error {
  constructor(readonly kind: "unavailable" | "rate-limited" | "invalid-response" | "timeout", message: string) {
    super(message);
    this.name = "SourceProviderError";
  }
}

export interface WebsiteAdapterOptions {
  maxPages?: number;
  maxRecentPages?: number;
  reader: PublicBrandReferenceReader;
}

export class WebsiteAdapter implements SourceAdapter {
  readonly id = "website";
  readonly version = "website-v1";
  readonly priority = 20;
  private readonly maxPages: number;
  private readonly maxRecentPages: number;

  constructor(private readonly options: WebsiteAdapterOptions) {
    this.maxPages = boundedInteger(options.maxPages ?? 6, 1, 12, "maxPages");
    this.maxRecentPages = boundedInteger(options.maxRecentPages ?? 3, 0, 10, "maxRecentPages");
  }
  supports(url: URL) { return SourceRouter.identify(url).platform === "website"; }
  identify(url: URL) { return SourceRouter.identify(url); }
  async health(): Promise<SourceHealth> { return { status: "available" }; }

  async fetch(request: SourceFetchRequest): Promise<RawSourceDocument> {
    const deadline = Date.now() + request.timeoutMs;
    const read = (url: string) => withinDeadline(this.options.reader.read(url), deadline, "Website extraction timed out");
    const root = await read(request.url);
    const selected = rankBrandLinks(root.links ?? [], new URL(root.url)).slice(0, this.maxPages - 1);
    const pages = [root];
    const warnings: string[] = [];
    for (const link of selected) {
      try { pages.push(await read(link)); }
      catch { warnings.push(`Could not extract linked Brand page: ${link}`); }
    }
    const remaining = this.maxPages - pages.length;
    if (remaining > 0 && this.maxRecentPages > 0) {
      const recent = rankRecentLinks(pages.flatMap((page) => page.links ?? []), new URL(root.url), new Set(pages.map((page) => page.url)))
        .slice(0, Math.min(remaining, this.maxRecentPages));
      for (const link of recent) {
        try { pages.push(await read(link)); }
        catch { warnings.push(`Could not extract recent Brand content: ${link}`); }
      }
    }
    return raw(root.url, pages[0]!.retrievedAt, { pages: pages.map(compactReference) }, warnings);
  }

  async normalize(value: RawSourceDocument, identity: SourceIdentity): Promise<NormalizedSourceDocument> {
    const pages = arrayRecords(record(value.payload).pages).map(asReference).filter((page): page is PublicBrandReference => Boolean(page));
    const root = pages[0];
    const body = uniqueText(pages.map((page) => page.excerpt)).join("\n\n").slice(0, 200_000);
    const externalLinks = [...new Set(pages.flatMap((page) => page.links ?? []).map(safeCanonicalUrl).filter((url): url is string => Boolean(url)))].slice(0, 500);
    return prepareNormalizedSourceDocument({
      canonicalUrl: value.canonicalUrl, platform: identity.platform, sourceType: identity.sourceType,
      retrievedAt: value.retrievedAt, contentHash: value.contentHash, provider: this.id,
      providerVersion: this.version, parserVersion: this.version,
      provenance: pages.map((page) => ({ provider: this.id, providerVersion: this.version, sourceUrl: page.url, retrievedAt: page.retrievedAt })),
      extractionWarnings: value.warnings ?? [], trust: "untrusted-evidence",
      ...(root?.title ? { title: root.title } : {}),
      ...(root?.summary ? { description: root.summary } : {}),
      ...(body ? { body } : {}),
      ...(externalLinks.length ? { externalLinks } : {}),
      confidence: pages.length > 1 ? 0.95 : 0.8,
    });
  }
}

export interface GitHubAdapterOptions { fetchImpl?: FetchLike; now?: () => Date; maxResponseBytes?: number }

export class GitHubAdapter implements SourceAdapter {
  readonly id = "github";
  readonly version = "github-rest-v1";
  readonly priority = 100;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxResponseBytes: number;
  constructor(options: GitHubAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 2_000_000, 8_000, 5_000_000, "maxResponseBytes");
  }
  supports(url: URL) { return SourceRouter.identify(url).platform === "github" && repoParts(url) !== undefined; }
  identify(url: URL) { return SourceRouter.identify(url); }
  async health(): Promise<SourceHealth> { return { status: "available" }; }

  async fetch(request: SourceFetchRequest): Promise<RawSourceDocument> {
    const parts = repoParts(new URL(request.url));
    if (!parts) throw new SourceProviderError("invalid-response", "GitHub repository URL is required");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    const api = `https://api.github.com/repos/${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.repo)}`;
    try {
      const repo = await this.json(api, controller.signal, true);
      const optional = await Promise.allSettled([
        this.json(`${api}/readme`, controller.signal), this.json(`${api}/languages`, controller.signal),
        this.json(`${api}/releases?per_page=5`, controller.signal), this.json(`${api}/events?per_page=15`, controller.signal),
      ]);
      const names = ["readme", "languages", "releases", "events"] as const;
      const payload: Record<string, JsonValue> = { repo };
      const warnings: string[] = [];
      optional.forEach((result, index) => {
        if (result.status === "fulfilled") payload[names[index]!] = result.value;
        else warnings.push(`GitHub optional ${names[index]} enrichment unavailable`);
      });
      return raw(`https://github.com/${parts.owner}/${parts.repo}`, this.now().toISOString(), payload as JsonValue, warnings);
    } catch (error) {
      if (controller.signal.aborted) throw new SourceProviderError("timeout", "GitHub extraction timed out");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async normalize(value: RawSourceDocument, identity: SourceIdentity): Promise<NormalizedSourceDocument> {
    const payload = record(value.payload);
    const repo = record(payload.repo);
    const readme = record(payload.readme);
    const releases = arrayRecords(payload.releases).slice(0, 5);
    const events = arrayRecords(payload.events).slice(0, 15);
    const description = text(repo.description);
    const readmeBody = decodeBase64(text(readme.content));
    const releaseText = releases.map((item) => [text(item.name) ?? text(item.tag_name), text(item.body)].filter(Boolean).join(": ")).filter(Boolean);
    const body = uniqueText([readmeBody, ...releaseText]).join("\n\n").slice(0, 200_000);
    const languages = Object.keys(record(payload.languages)).slice(0, 30);
    const topics = stringArray(repo.topics).slice(0, 50);
    const engagement = numericRecord({ stars: repo.stargazers_count, forks: repo.forks_count, watchers: repo.subscribers_count });
    const recentActivity = events.map((item) => text(item.type)).filter((item): item is string => Boolean(item));
    return normalized(value, identity, this.id, this.version, {
      profile: text(record(repo.owner).login), title: text(repo.full_name) ?? text(repo.name), ...(description ? { description } : {}),
      ...(body ? { body } : {}), tags: [...new Set([...topics, ...languages, ...recentActivity])].slice(0, 100), engagement,
      externalLinks: stringArray([repo.html_url, repo.homepage]).map(safeCanonicalUrl).filter((url): url is string => Boolean(url)), confidence: 1,
    });
  }

  private async json(url: string, signal: AbortSignal, required = false): Promise<JsonValue> {
    const response = await this.fetchImpl(url, { signal, headers: { accept: "application/vnd.github+json", "user-agent": "KairoSourceIntelligence/1.0" } });
    if (response.status === 403 || response.status === 429) throw new SourceProviderError("rate-limited", "GitHub public API rate limit reached");
    if (!response.ok) {
      if (!required && response.status === 404) return null;
      throw new SourceProviderError("unavailable", `GitHub API returned ${response.status}`);
    }
    return await readJson(response, this.maxResponseBytes);
  }
}

export interface HackerNewsAdapterOptions { fetchImpl?: FetchLike; now?: () => Date; maxComments?: number; linkedReader?: PublicBrandReferenceReader }

export class HackerNewsAdapter implements SourceAdapter {
  readonly id = "hacker-news";
  readonly version = "hn-v0-v1";
  readonly priority = 90;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxComments: number;
  constructor(private readonly options: HackerNewsAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxComments = boundedInteger(options.maxComments ?? 20, 0, 50, "maxComments");
  }
  supports(url: URL) { return SourceRouter.identify(url).platform === "hacker-news"; }
  identify(url: URL) { return SourceRouter.identify(url); }
  async health(): Promise<SourceHealth> { return { status: "available" }; }

  async fetch(request: SourceFetchRequest): Promise<RawSourceDocument> {
    const url = new URL(request.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      if (url.pathname === "/user") {
        const id = url.searchParams.get("id");
        if (!id) throw new SourceProviderError("invalid-response", "Hacker News user id is required");
        return raw(request.url, this.now().toISOString(), { user: await this.json(`user/${encodeURIComponent(id)}`, controller.signal) });
      }
      const id = url.searchParams.get("id");
      if (!id) throw new SourceProviderError("invalid-response", "Hacker News item id is required");
      const item = record(await this.json(`item/${encodeURIComponent(id)}`, controller.signal));
      const comments: JsonValue[] = [];
      for (const child of numberArray(item.kids).slice(0, this.maxComments)) comments.push(await this.json(`item/${child}`, controller.signal));
      let article: PublicBrandReference | undefined;
      const linked = text(item.url);
      if (linked && this.options.linkedReader) {
        try { article = await this.options.linkedReader.read(linked); } catch { /* linked article failure degrades to HN evidence */ }
      }
      return raw(request.url, this.now().toISOString(), { item, comments, ...(article ? { article: compactReference(article) } : {}) });
    } catch (error) {
      if (controller.signal.aborted) throw new SourceProviderError("timeout", "Hacker News extraction timed out");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async normalize(value: RawSourceDocument, identity: SourceIdentity): Promise<NormalizedSourceDocument> {
    const payload = record(value.payload);
    const user = record(payload.user);
    if (Object.keys(user).length) {
      const about = stripHtml(text(user.about) ?? "");
      return normalized(value, identity, this.id, this.version, { profile: text(user.id), title: text(user.id), ...(about ? { body: about } : {}), engagement: numericRecord({ karma: user.karma }), confidence: 1 });
    }
    const item = record(payload.item);
    const article = asReference(payload.article);
    const comments = arrayRecords(payload.comments).map((comment) => stripHtml(text(comment.text) ?? "")).filter(Boolean);
    const itemText = stripHtml(text(item.text) ?? "");
    const body = uniqueText([article?.excerpt, itemText, ...comments]).join("\n\n").slice(0, 200_000);
    const sourceUrl = text(item.url);
    return normalized(value, identity, this.id, this.version, {
      title: text(item.title), author: text(item.by), ...(body ? { body } : {}),
      ...(typeof item.time === "number" ? { publishedAt: new Date(item.time * 1000).toISOString() } : {}),
      engagement: numericRecord({ score: item.score, comments: item.descendants }),
      externalLinks: sourceUrl && safeCanonicalUrl(sourceUrl) ? [safeCanonicalUrl(sourceUrl)!] : [], confidence: 1,
    });
  }

  private async json(path: string, signal: AbortSignal): Promise<JsonValue> {
    const response = await this.fetchImpl(`https://hacker-news.firebaseio.com/v0/${path}.json`, { signal, headers: { accept: "application/json" } });
    if (response.status === 429) throw new SourceProviderError("rate-limited", "Hacker News rate limit reached");
    if (!response.ok) throw new SourceProviderError("unavailable", `Hacker News API returned ${response.status}`);
    return await readJson(response, 1_000_000);
  }
}

export interface RssSubstackAdapterOptions { fetchImpl?: FetchLike; now?: () => Date; maxEntries?: number; maxResponseBytes?: number }

export class RssSubstackAdapter implements SourceAdapter {
  readonly id = "rss-substack";
  readonly version = "rss-atom-v2";
  readonly priority = 80;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxEntries: number;
  private readonly maxResponseBytes: number;
  constructor(options: RssSubstackAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxEntries = boundedInteger(options.maxEntries ?? 20, 1, 50, "maxEntries");
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 2_000_000, 8_000, 5_000_000, "maxResponseBytes");
  }
  supports(url: URL) { const identity = SourceRouter.identify(url); return identity.platform === "rss" || (identity.platform === "substack" && identity.sourceType === "publication"); }
  identify(url: URL) { return SourceRouter.identify(url); }
  async health(): Promise<SourceHealth> { return { status: "available" }; }

  async fetch(request: SourceFetchRequest): Promise<RawSourceDocument> {
    const identity = SourceRouter.identify(request.url);
    const fetchUrl = identity.platform === "substack" ? new URL("/feed", request.url).toString() : request.url;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await this.fetchImpl(fetchUrl, { signal: controller.signal, headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
      if (response.status === 429) throw new SourceProviderError("rate-limited", "Feed provider rate limit reached");
      if (!response.ok) throw new SourceProviderError("unavailable", `Feed returned ${response.status}`);
      const xml = await readText(response, this.maxResponseBytes);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SourceProviderError("invalid-response", "Unsafe XML declarations are not supported");
      const entries = parseRssAtomFeed(xml, fetchUrl).slice(0, this.maxEntries);
      return raw(request.url, this.now().toISOString(), { entries: entries.map((entry) => ({ ...entry })), fetchUrl } as JsonValue);
    } catch (error) {
      if (controller.signal.aborted) throw new SourceProviderError("timeout", "Feed extraction timed out");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async normalize(value: RawSourceDocument, identity: SourceIdentity): Promise<NormalizedSourceDocument> {
    const entries = arrayRecords(record(value.payload).entries);
    const first = entries[0] ?? {};
    const body = entries.map((entry) => [text(entry.title), text(entry.summary)].filter(Boolean).join("\n")).filter(Boolean).join("\n\n").slice(0, 200_000);
    return normalized(value, identity, this.id, this.version, {
      title: text(first.publisher) ?? text(first.title), publisher: text(first.publisher), author: text(first.author),
      ...(body ? { body } : {}), ...(text(first.publishedAt) ? { publishedAt: text(first.publishedAt)! } : {}),
      tags: [...new Set(entries.flatMap((entry) => stringArray(entry.tags)))].slice(0, 100),
      externalLinks: entries.map((entry) => safeCanonicalUrl(text(entry.url))).filter((url): url is string => Boolean(url)), confidence: entries.length ? 0.95 : 0.5,
    });
  }
}

function normalized(rawValue: RawSourceDocument, identity: SourceIdentity, provider: string, version: string, fields: Partial<NormalizedSourceDocument> & { confidence: number }) {
  return prepareNormalizedSourceDocument({
    canonicalUrl: rawValue.canonicalUrl, platform: identity.platform, sourceType: identity.sourceType, retrievedAt: rawValue.retrievedAt,
    contentHash: rawValue.contentHash, provider, providerVersion: version, parserVersion: version,
    provenance: [{ provider, providerVersion: version, sourceUrl: rawValue.canonicalUrl, retrievedAt: rawValue.retrievedAt }],
    extractionWarnings: rawValue.warnings ?? [], ...fields,
  });
}

function raw(canonicalUrl: string, retrievedAt: string, payload: JsonValue, warnings: string[] = []): RawSourceDocument {
  return { canonicalUrl, retrievedAt, contentHash: `sha256:${createHash("sha256").update(JSON.stringify(stableHashValue(payload))).digest("hex")}`, payload, ...(warnings.length ? { warnings } : {}) };
}

function rankBrandLinks(links: readonly string[], root: URL): string[] {
  const priorities = [/\babout\b/i, /\b(products?|services?|solutions?)\b/i, /\bpricing\b/i, /\b(resources?|blog|news|insights?)\b/i];
  return [...new Set(links.map(safeCanonicalUrl).filter((link): link is string => Boolean(link)))].filter((link) => { try { return new URL(link).hostname === root.hostname; } catch { return false; } })
    .map((link, index) => ({ link, index, score: priorities.findIndex((pattern) => pattern.test(new URL(link).pathname)) }))
    .filter((item) => item.score >= 0).sort((a, b) => a.score - b.score || a.index - b.index).map((item) => item.link);
}

function rankRecentLinks(links: readonly string[], root: URL, visited: ReadonlySet<string>): string[] {
  return [...new Set(links.map(safeCanonicalUrl).filter((link): link is string => Boolean(link)))]
    .filter((link) => { try { const url = new URL(link); return url.hostname === root.hostname && !visited.has(link) && /\/(blog|news|resources?|insights?|articles?)\//i.test(url.pathname); } catch { return false; } })
    .sort((a, b) => recentPathScore(b) - recentPathScore(a) || a.localeCompare(b));
}
function recentPathScore(value: string) { const path = new URL(value).pathname; return /\/20\d{2}\//.test(path) ? 2 : /\d{4}[-/]\d{1,2}/.test(path) ? 1 : 0; }
function stableHashValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stableHashValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "retrievedAt").map(([key, item]) => [key, stableHashValue(item as JsonValue)])) as JsonValue;
  return value;
}
async function withinDeadline<T>(promise: Promise<T>, deadline: number, message: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new SourceProviderError("timeout", message);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new SourceProviderError("timeout", message)), remaining); })]); }
  finally { if (timer) clearTimeout(timer); }
}

function compactReference(reference: PublicBrandReference): JsonValue { return { url: reference.url, ...(reference.title ? { title: reference.title } : {}), ...(reference.summary ? { summary: reference.summary } : {}), excerpt: reference.excerpt, retrievedAt: reference.retrievedAt, ...(reference.links ? { links: reference.links } : {}) }; }
function asReference(value: unknown): PublicBrandReference | undefined { const item = record(value); const url = text(item.url); const excerpt = text(item.excerpt); const retrievedAt = text(item.retrievedAt); return url && excerpt && retrievedAt ? { url, excerpt, retrievedAt, ...(text(item.title) ? { title: text(item.title)! } : {}), ...(text(item.summary) ? { summary: text(item.summary)! } : {}), links: stringArray(item.links) } : undefined; }
function repoParts(url: URL) { const [owner, repo] = url.pathname.split("/").filter(Boolean); return owner && repo ? { owner, repo: repo.replace(/\.git$/i, "") } : undefined; }
function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function arrayRecords(value: unknown): Record<string, any>[] { return Array.isArray(value) ? value.map(record) : []; }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : []; }
function numberArray(value: unknown): number[] { return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : []; }
function numericRecord(value: Record<string, unknown>): Record<string, number> { return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))); }
function decodeBase64(value: string | undefined): string | undefined { if (!value) return undefined; try { return Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8").slice(0, 150_000); } catch { return undefined; } }
function stripHtml(value: string) { return value.replace(/<[^>]*>/g, " ").replace(/&(?:#x?[0-9a-f]+|\w+);/gi, " ").replace(/\s+/g, " ").trim(); }
function uniqueText(values: Array<string | undefined>) { return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]; }
function safeCanonicalUrl(value: string | undefined) { if (!value) return undefined; try { return normalizeCanonicalUrl(value); } catch { return undefined; } }
function boundedInteger(value: number, min: number, max: number, name: string) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be from ${min} to ${max}`); return value; }
async function readText(response: Response, maxBytes: number) { const declared = Number(response.headers.get("content-length") ?? 0); if (declared > maxBytes) throw new SourceProviderError("invalid-response", "Source response exceeded size limit"); const value = await response.text(); if (Buffer.byteLength(value) > maxBytes) throw new SourceProviderError("invalid-response", "Source response exceeded size limit"); return value; }
async function readJson(response: Response, maxBytes: number): Promise<JsonValue> { try { return JSON.parse(await readText(response, maxBytes)) as JsonValue; } catch (error) { if (error instanceof SourceProviderError) throw error; throw new SourceProviderError("invalid-response", "Source returned invalid JSON"); } }
