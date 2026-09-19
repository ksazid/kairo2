import type { DiscoveryEvidence, DiscoveryRequest, DiscoverySourceProvider } from "@kairo/agent-contracts";
import { preparePublicSignal } from "@kairo/domain/discovery";

export type PublicDiscoveryFailureKind =
  | "unavailable"
  | "rate-limited"
  | "upstream"
  | "invalid-response"
  | "timeout";

export class PublicDiscoveryAdapterError extends Error {
  readonly code = "public_discovery_adapter_error";
  constructor(readonly kind: PublicDiscoveryFailureKind, message: string) {
    super(message);
    this.name = "PublicDiscoveryAdapterError";
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RssFeedDefinition {
  key: string;
  url: string;
  tags: readonly string[];
  publisher?: string;
  enabled?: boolean;
}

export interface GitHubDiscoveryProviderOptions { fetchImpl?: FetchLike; now?: () => Date; }

export class GitHubDiscoveryProvider implements DiscoverySourceProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  constructor(options: GitHubDiscoveryProviderOptions = {}) { this.fetchImpl = options.fetchImpl ?? fetch; this.now = options.now ?? (() => new Date()); }
  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const normalized = validateDiscoveryRequest(request);
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", normalized.query);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(normalized.maxResults));
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { accept: "application/vnd.github+json", "user-agent": "KairoHunter/1.0" } });
      if (response.status === 403 || response.status === 429) throw new PublicDiscoveryAdapterError("rate-limited", "GitHub discovery rate limit reached");
      if (!response.ok) throw new PublicDiscoveryAdapterError("upstream", `GitHub discovery returned ${response.status}`);
      const payload = asRecord(await readJson(response, 2_000_000)); const items = Array.isArray(payload?.items) ? payload.items : [];
      const retrievedAt = this.now().toISOString(); const result: DiscoveryEvidence[] = [];
      for (const raw of items) {
        const item = asRecord(raw); const title = asText(item?.full_name); const sourceUrl = safeExternalUrl(asText(item?.html_url));
        if (!title || !sourceUrl) continue;
        const prepared = tryPrepareEvidence({ title, ...(asText(item?.description) ? { summary: asText(item?.description)! } : {}), sourceUrl,
          platform: "github", publisher: "GitHub", ...(asText(item?.updated_at) ? { publishedAt: asText(item?.updated_at)! } : {}),
          retrievedAt, provider: "github", providerVersion: "rest-search-v1" });
        if (prepared) result.push(prepared);
      }
      return result.slice(0, normalized.maxResults);
    } catch (error) {
      if (controller.signal.aborted) throw new PublicDiscoveryAdapterError("timeout", "GitHub discovery timed out");
      if (error instanceof PublicDiscoveryAdapterError) throw error;
      throw new PublicDiscoveryAdapterError("invalid-response", "GitHub discovery response could not be processed");
    } finally { clearTimeout(timeout); }
  }
}

export interface RssAtomDiscoveryProviderOptions {
  feeds: readonly RssFeedDefinition[];
  fetchImpl?: FetchLike;
  now?: () => Date;
  maxFeedsPerRequest?: number;
  maxResponseBytes?: number;
}

export class RssAtomDiscoveryProvider implements DiscoverySourceProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxFeedsPerRequest: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: RssAtomDiscoveryProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxFeedsPerRequest = boundedPositiveInteger(options.maxFeedsPerRequest ?? 3, "maxFeedsPerRequest", 20);
    this.maxResponseBytes = boundedPositiveInteger(options.maxResponseBytes ?? 2_000_000, "maxResponseBytes", 5_000_000);
    for (const feed of options.feeds) validateFeed(feed);
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const normalized = validateDiscoveryRequest(request);
    const queryTokens = tokens(normalized.query);
    const feeds = this.options.feeds
      .filter((feed) => feed.enabled !== false && feedMatches(feed, queryTokens))
      .slice(0, this.maxFeedsPerRequest);
    if (!feeds.length) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
    const retrievedAt = this.now().toISOString();
    const evidence: DiscoveryEvidence[] = [];
    try {
      for (const feed of feeds) {
        try {
          const response = await this.fetchImpl(feed.url, {
            method: "GET",
            signal: controller.signal,
            headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" },
          });
          if (!response.ok) continue;
          const xml = await readBoundedText(response, this.maxResponseBytes);
          if (/<!DOCTYPE|<!ENTITY/i.test(xml)) continue;
          const entries = parseRssAtomFeed(xml, feed.url);
          for (const entry of entries) {
            if (!entry.title || !entry.url) continue;
            if (!textMatches(`${entry.title} ${entry.summary ?? ""}`, queryTokens)) continue;
            const prepared = tryPrepareEvidence({
              title: entry.title,
              ...(entry.summary ? { summary: entry.summary } : {}),
              sourceUrl: entry.url,
              platform: "rss",
              ...(feed.publisher ? { publisher: feed.publisher } : entry.publisher ? { publisher: entry.publisher } : {}),
              ...(entry.author ? { author: entry.author } : {}),
              ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
              retrievedAt,
              provider: "rss",
              providerVersion: "rss-atom-v1",
            });
            if (prepared) evidence.push(prepared);
            if (evidence.length >= normalized.maxResults) return evidence;
          }
        } catch (error) {
          if (controller.signal.aborted) throw new PublicDiscoveryAdapterError("timeout", "RSS/Atom discovery timed out");
          // A malformed/unavailable feed is isolated; another configured feed may still succeed.
        }
      }
      return evidence.slice(0, normalized.maxResults);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface HackerNewsDiscoveryProviderOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
  maxItemsToInspect?: number;
  cacheTtlMs?: number;
}

export class HackerNewsDiscoveryProvider implements DiscoverySourceProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxItemsToInspect: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly baseUrl = "https://hacker-news.firebaseio.com/v0";

  constructor(options: HackerNewsDiscoveryProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxItemsToInspect = boundedPositiveInteger(options.maxItemsToInspect ?? 30, "maxItemsToInspect", 100);
    this.cacheTtlMs = boundedPositiveInteger(options.cacheTtlMs ?? 60_000, "cacheTtlMs", 3_600_000);
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const normalized = validateDiscoveryRequest(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
    try {
      const [top, fresh] = await Promise.all([
        this.getJson(`${this.baseUrl}/topstories.json`, controller.signal),
        this.getJson(`${this.baseUrl}/newstories.json`, controller.signal),
      ]);
      const ids = uniqueIds([...(Array.isArray(top) ? top : []), ...(Array.isArray(fresh) ? fresh : [])])
        .slice(0, this.maxItemsToInspect);
      const queryTokens = tokens(normalized.query);
      const candidates: Array<{ score: number; time: number; evidence: DiscoveryEvidence }> = [];
      const retrievedAt = this.now().toISOString();

      for (const id of ids) {
        const raw = await this.getJson(`${this.baseUrl}/item/${id}.json`, controller.signal);
        const item = asRecord(raw);
        if (!item || item.type !== "story" || item.deleted === true || item.dead === true) continue;
        const title = asText(item.title);
        if (!title) continue;
        const haystack = `${title} ${asText(item.text) ?? ""} ${asText(item.url) ?? ""}`;
        const score = relevanceScore(haystack, queryTokens);
        if (queryTokens.size && score === 0) continue;
        const sourceUrl = safeExternalUrl(asText(item.url)) ?? `https://news.ycombinator.com/item?id=${id}`;
        const time = typeof item.time === "number" && Number.isFinite(item.time) ? item.time : 0;
        const prepared = tryPrepareEvidence({
          title,
          ...(asText(item.text) ? { summary: stripMarkup(asText(item.text)!) } : {}),
          sourceUrl,
          platform: "hacker-news",
          publisher: "Hacker News",
          ...(asText(item.by) ? { author: asText(item.by)! } : {}),
          ...(time > 0 ? { publishedAt: new Date(time * 1000).toISOString() } : {}),
          retrievedAt,
          provider: "hacker-news",
          providerVersion: "v0",
        });
        if (prepared) candidates.push({ score, time, evidence: prepared });
      }

      return candidates
        .sort((a, b) => b.score - a.score || b.time - a.time || a.evidence.title.localeCompare(b.evidence.title))
        .slice(0, normalized.maxResults)
        .map((item) => item.evidence);
    } catch (error) {
      if (controller.signal.aborted) throw new PublicDiscoveryAdapterError("timeout", "Hacker News discovery timed out");
      if (error instanceof PublicDiscoveryAdapterError) throw error;
      throw new PublicDiscoveryAdapterError("upstream", "Hacker News discovery failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    const cached = this.cache.get(url);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;
    const response = await this.fetchImpl(url, { method: "GET", signal, headers: { accept: "application/json" } });
    if (response.status === 429) throw new PublicDiscoveryAdapterError("rate-limited", "Hacker News provider rate limited the request");
    if (!response.ok) throw new PublicDiscoveryAdapterError("upstream", "Hacker News provider returned an error");
    const value = await readJson(response, 1_000_000);
    this.cache.set(url, { expiresAt: now + this.cacheTtlMs, value });
    return value;
  }
}

export interface BlueskyDiscoveryProviderOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export class BlueskyDiscoveryProvider implements DiscoverySourceProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: BlueskyDiscoveryProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const normalized = validateDiscoveryRequest(request);
    const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts");
    url.searchParams.set("q", normalized.query);
    url.searchParams.set("limit", String(normalized.maxResults));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (response.status === 429) throw new PublicDiscoveryAdapterError("rate-limited", "Bluesky provider rate limited the request");
      if (response.status >= 500) throw new PublicDiscoveryAdapterError("upstream", "Bluesky provider is unavailable");
      if (!response.ok) throw new PublicDiscoveryAdapterError("upstream", "Bluesky provider returned an error");
      const payload = asRecord(await readJson(response, 2_000_000));
      const posts = Array.isArray(payload?.posts) ? payload.posts : [];
      const retrievedAt = this.now().toISOString();
      const result: DiscoveryEvidence[] = [];

      for (const raw of posts) {
        const post = asRecord(raw);
        const author = asRecord(post?.author);
        const record = asRecord(post?.record);
        const uri = asText(post?.uri);
        const handle = asText(author?.handle);
        const text = asText(record?.text);
        if (!uri || !handle || !text) continue;
        const rkey = uri.split("/").filter(Boolean).at(-1);
        if (!rkey) continue;
        const prepared = tryPrepareEvidence({
          title: truncate(text.replace(/\s+/g, " ").trim(), 300),
          ...(text.length > 300 ? { summary: truncate(text.replace(/\s+/g, " ").trim(), 2_000) } : {}),
          sourceUrl: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`,
          platform: "bluesky",
          publisher: "Bluesky",
          author: handle,
          ...(asText(record?.createdAt) ? { publishedAt: asText(record?.createdAt)! } : {}),
          retrievedAt,
          provider: "bluesky",
          providerVersion: "app.bsky.feed.searchPosts",
        });
        if (prepared) result.push(prepared);
        if (result.length >= normalized.maxResults) break;
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new PublicDiscoveryAdapterError("timeout", "Bluesky discovery timed out");
      if (error instanceof PublicDiscoveryAdapterError) throw error;
      throw new PublicDiscoveryAdapterError("invalid-response", "Bluesky response could not be processed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface YouTubeDiscoveryProviderOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export class YouTubeDiscoveryProvider implements DiscoverySourceProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly apiKey: string;

  constructor(options: YouTubeDiscoveryProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.apiKey = options.apiKey?.trim() ?? "";
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const normalized = validateDiscoveryRequest(request);
    if (!this.apiKey) throw new PublicDiscoveryAdapterError("unavailable", "YouTube discovery is unavailable because its optional API key is not configured");

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("q", normalized.query);
    url.searchParams.set("maxResults", String(normalized.maxResults));
    url.searchParams.set("key", this.apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (response.status === 429 || response.status === 403) {
        throw new PublicDiscoveryAdapterError("rate-limited", "YouTube discovery quota or rate limit was reached");
      }
      if (response.status >= 500) throw new PublicDiscoveryAdapterError("upstream", "YouTube provider is unavailable");
      if (!response.ok) throw new PublicDiscoveryAdapterError("upstream", "YouTube provider returned an error");
      const payload = asRecord(await readJson(response, 2_000_000));
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const retrievedAt = this.now().toISOString();
      const result: DiscoveryEvidence[] = [];

      for (const raw of items) {
        const item = asRecord(raw);
        const id = asRecord(item?.id);
        const snippet = asRecord(item?.snippet);
        if (id?.kind !== "youtube#video") continue;
        const videoId = asText(id?.videoId);
        const title = asText(snippet?.title);
        if (!videoId || !title) continue;
        const description = asText(snippet?.description);
        const prepared = tryPrepareEvidence({
          title: stripMarkup(title),
          ...(description ? { summary: truncate(stripMarkup(description), 2_000) } : {}),
          sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          platform: "youtube",
          ...(asText(snippet?.channelTitle) ? { publisher: asText(snippet?.channelTitle)! } : {}),
          ...(asText(snippet?.publishedAt) ? { publishedAt: asText(snippet?.publishedAt)! } : {}),
          retrievedAt,
          provider: "youtube",
          providerVersion: "v3/search.list",
        });
        if (prepared) result.push(prepared);
        if (result.length >= normalized.maxResults) break;
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new PublicDiscoveryAdapterError("timeout", "YouTube discovery timed out");
      if (error instanceof PublicDiscoveryAdapterError) throw error;
      throw new PublicDiscoveryAdapterError("invalid-response", "YouTube response could not be processed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface ParsedFeedEntry {
  title?: string;
  url?: string;
  summary?: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  tags?: string[];
}

export function parseRssAtomFeed(xml: string, baseUrl: string): ParsedFeedEntry[] {
  const rssItems = blocks(xml, "item");
  if (rssItems.length) {
    const channel = firstTag(xml, "title");
    return rssItems.map((item) => ({
      title: cleanXmlText(firstTag(item, "title")),
      url: resolveHttpUrl(cleanXmlText(firstTag(item, "link")), baseUrl),
      summary: cleanXmlText(firstTag(item, "description") ?? firstTag(item, "content:encoded")),
      author: cleanXmlText(firstTag(item, "dc:creator") ?? firstTag(item, "author")),
      publisher: cleanXmlText(channel),
      publishedAt: normalizeDate(cleanXmlText(firstTag(item, "pubDate") ?? firstTag(item, "dc:date"))),
      tags: categoryValues(item),
    }));
  }

  const atomEntries = blocks(xml, "entry");
  if (atomEntries.length) {
    const publisher = cleanXmlText(firstTag(xml, "title"));
    return atomEntries.map((entry) => ({
      title: cleanXmlText(firstTag(entry, "title")),
      url: resolveHttpUrl(atomLink(entry), baseUrl),
      summary: cleanXmlText(firstTag(entry, "summary") ?? firstTag(entry, "content")),
      author: cleanXmlText(firstTag(firstTag(entry, "author") ?? "", "name") ?? firstTag(entry, "author")),
      publisher,
      publishedAt: normalizeDate(cleanXmlText(firstTag(entry, "published") ?? firstTag(entry, "updated"))),
      tags: categoryValues(entry),
    }));
  }
  throw new PublicDiscoveryAdapterError("invalid-response", "RSS/Atom feed contains no supported entries");
}

function attributeValue(value: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeEntities(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i").exec(value)?.[1] ?? "") || undefined;
}

function categoryValues(xml: string): string[] {
  const values: string[] = [];
  for (const match of xml.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category\s*>|<category\b([^>]*)\/\s*>/gi)) {
    const attrs = match[1] ?? match[3] ?? "";
    const value = cleanXmlText(match[2]) ?? attributeValue(attrs, "term");
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= 20) break;
  }
  return values;
}

function blocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "gi"))]
    .map((match) => match[1] ?? "");
}

function firstTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i").exec(xml);
  return match?.[1];
}

function atomLink(entry: string): string | undefined {
  const links = [...entry.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  for (const match of links) {
    const attrs = match[1] ?? "";
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && (!rel || rel === "alternate")) return decodeEntities(href);
  }
  return undefined;
}

function cleanXmlText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const cleaned = decodeEntities(withoutCdata.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  return cleaned || undefined;
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return named[entity.toLowerCase()] ?? full;
  });
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function resolveHttpUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return isPublicHttpUrl(url) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return isPublicHttpUrl(url) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function validateFeed(feed: RssFeedDefinition): void {
  if (!feed || typeof feed !== "object" || !feed.key.trim()) throw new PublicDiscoveryAdapterError("invalid-response", "RSS feed key is required");
  if (!Array.isArray(feed.tags)) throw new PublicDiscoveryAdapterError("invalid-response", `RSS feed ${feed.key} tags must be an array`);
  let url: URL;
  try { url = new URL(feed.url); } catch { throw new PublicDiscoveryAdapterError("invalid-response", `RSS feed ${feed.key} URL is invalid`); }
  if (!isPublicHttpUrl(url)) throw new PublicDiscoveryAdapterError("invalid-response", `RSS feed ${feed.key} must use a public HTTP(S) URL`);
}

function isPublicHttpUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host.includes(":")) return false;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a = 0, b = 0] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  return true;
}

function validateDiscoveryRequest(request: DiscoveryRequest): DiscoveryRequest {
  const query = request?.query?.trim();
  if (!query) throw new PublicDiscoveryAdapterError("invalid-response", "Discovery query is required");
  if (request.scope?.visibility !== "global-public") throw new PublicDiscoveryAdapterError("invalid-response", "Public discovery requires global-public scope");
  if (!Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 20) {
    throw new PublicDiscoveryAdapterError("invalid-response", "maxResults must be an integer from 1 to 20");
  }
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 120_000) {
    throw new PublicDiscoveryAdapterError("invalid-response", "timeoutMs must be an integer from 100 to 120000");
  }
  return { ...request, query };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new PublicDiscoveryAdapterError("invalid-response", "Provider response exceeded size limit");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new PublicDiscoveryAdapterError("invalid-response", "Provider response exceeded size limit");
  return text;
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await readBoundedText(response, maxBytes);
  try { return JSON.parse(text) as unknown; } catch { throw new PublicDiscoveryAdapterError("invalid-response", "Provider returned invalid JSON"); }
}

function tryPrepareEvidence(input: Parameters<typeof preparePublicSignal>[0]): DiscoveryEvidence | undefined {
  try {
    const prepared = preparePublicSignal(input);
    return {
      title: prepared.title,
      ...(prepared.summary ? { summary: prepared.summary } : {}),
      sourceUrl: prepared.sourceUrl,
      platform: prepared.platform,
      ...(prepared.publisher ? { publisher: prepared.publisher } : {}),
      ...(prepared.author ? { author: prepared.author } : {}),
      ...(prepared.publishedAt ? { publishedAt: prepared.publishedAt } : {}),
      retrievedAt: prepared.retrievedAt,
      provider: prepared.provider,
      ...(prepared.providerVersion ? { providerVersion: prepared.providerVersion } : {}),
      ...(prepared.contentHash ? { contentHash: prepared.contentHash } : {}),
    };
  } catch {
    return undefined;
  }
}

function feedMatches(feed: RssFeedDefinition, queryTokens: ReadonlySet<string>): boolean {
  if (!queryTokens.size) return true;
  const feedTokens = tokens(`${feed.key} ${feed.tags.join(" ")} ${feed.publisher ?? ""}`);
  for (const token of queryTokens) if (feedTokens.has(token)) return true;
  return false;
}

function textMatches(value: string, queryTokens: ReadonlySet<string>): boolean {
  if (!queryTokens.size) return true;
  const valueTokens = tokens(value);
  for (const token of queryTokens) if (valueTokens.has(token)) return true;
  return false;
}

function relevanceScore(value: string, queryTokens: ReadonlySet<string>): number {
  if (!queryTokens.size) return 1;
  const valueTokens = tokens(value);
  let score = 0;
  for (const token of queryTokens) if (valueTokens.has(token)) score += 1;
  return score;
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1) ?? []);
}

function uniqueIds(values: unknown[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    if (!Number.isInteger(value) || (value as number) <= 0 || seen.has(value as number)) continue;
    seen.add(value as number);
    result.push(value as number);
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd();
}

function boundedPositiveInteger(value: number, field: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new PublicDiscoveryAdapterError("invalid-response", `${field} must be an integer from 1 to ${max}`);
  return value;
}
