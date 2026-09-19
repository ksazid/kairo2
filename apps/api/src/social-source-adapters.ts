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
  type SourcePlatform,
} from "@kairo/agent-contracts";
import type { PublicBrandReference, PublicBrandReferenceReader } from "@kairo/domain/brand-brain-bootstrap";
import { SourceProviderError } from "./source-adapters";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SocialPlatform = Extract<SourcePlatform, "instagram" | "facebook" | "linkedin">;

export interface AuthorizedSocialEvidenceProvider {
  health(): Promise<SourceHealth>;
  readPublicEvidence(url: string): Promise<PublicBrandReference>;
}
export interface PublicSocialAdapterOptions { reader: PublicBrandReferenceReader; authorizedProvider?: AuthorizedSocialEvidenceProvider; }

abstract class PublicSocialAdapter implements SourceAdapter {
  abstract readonly id: string;
  abstract readonly version: string;
  abstract readonly platform: SocialPlatform;
  readonly priority = 70;
  constructor(protected readonly options: PublicSocialAdapterOptions) {}
  supports(url: URL) { return SourceRouter.identify(url).platform === this.platform; }
  identify(url: URL) { return SourceRouter.identify(url); }
  async health(): Promise<SourceHealth> { return { status: "available" }; }

  async fetch(request: SourceFetchRequest): Promise<RawSourceDocument> {
    const canonicalUrl = canonicalizePublicSocialUrl(request.url);
    let reference: PublicBrandReference | undefined;
    const warnings: string[] = [];
    if (this.options.authorizedProvider) {
      const health = await this.options.authorizedProvider.health();
      if (health.status !== "unavailable") {
        try { reference = await this.options.authorizedProvider.readPublicEvidence(canonicalUrl); }
        catch { warnings.push("Authorized social enrichment unavailable; used public evidence fallback"); }
      }
    }
    reference ??= await this.options.reader.read(canonicalUrl);
    if (isBlockedPublicEvidence(this.platform, reference)) throw new SourceProviderError("unavailable", `${platformName(this.platform)} public evidence is blocked or login-only`);
    return raw(canonicalUrl, reference.retrievedAt, { reference: compactReference({ ...reference, url: canonicalUrl }) }, warnings);
  }

  async normalize(value: RawSourceDocument, identity: SourceIdentity): Promise<NormalizedSourceDocument> {
    const reference = asReference(record(value.payload).reference);
    if (!reference) throw new SourceProviderError("invalid-response", `${platformName(this.platform)} public evidence was malformed`);
    const body = reference.excerpt.trim();
    const links = (reference.links ?? []).map(safeCanonicalUrl).filter((item): item is string => Boolean(item)).slice(0, 100);
    return normalized(value, identity, this.id, this.version, {
      ...(profileFromIdentity(identity) ? { profile: profileFromIdentity(identity) } : {}),
      ...(reference.title ? { title: reference.title } : {}),
      ...(reference.summary ? { description: reference.summary } : {}),
      ...(body ? { body } : {}),
      ...(links.length ? { externalLinks: links } : {}),
      confidence: body.length >= 120 ? 0.8 : 0.65,
    });
  }
}

export class InstagramAdapter extends PublicSocialAdapter { readonly id = "instagram-public"; readonly version = "instagram-public-v1"; readonly platform = "instagram" as const; }
export class FacebookAdapter extends PublicSocialAdapter { readonly id = "facebook-public"; readonly version = "facebook-public-v1"; readonly platform = "facebook" as const; }
export class ProfessionalNetworkAdapter extends PublicSocialAdapter { readonly id = "linkedin-public"; readonly version = "linkedin-public-v1"; readonly platform = "linkedin" as const; }

export interface YouTubeAdapterOptions { reader: PublicBrandReferenceReader; apiKey?: string; fetchImpl?: FetchLike; now?: () => Date; maxResponseBytes?: number; }

export class YouTubeAdapter implements SourceAdapter {
  readonly id = "youtube";
  readonly version = "youtube-v3-public-v1";
  readonly priority = 85;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxResponseBytes: number;
  constructor(private readonly options: YouTubeAdapterOptions) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 2_000_000, 8_000, 5_000_000, "maxResponseBytes");
  }
  supports(url: URL) { return SourceRouter.identify(url).platform === "youtube"; }
  identify(url: URL) { return SourceRouter.identify(url); }
  async health(): Promise<SourceHealth> { return { status: "available", ...(this.apiKey ? {} : { reason: "official API key not configured; bounded public fallback enabled" }) }; }

  async fetch(request: SourceFetchRequest): Promise<RawSourceDocument> {
    const canonicalUrl = canonicalizePublicSocialUrl(request.url);
    const identity = SourceRouter.identify(canonicalUrl);
    const warnings: string[] = [];
    if (this.apiKey) {
      try {
        const apiPayload = await this.fetchOfficial({ ...request, url: canonicalUrl }, identity);
        if (apiPayload) return raw(canonicalUrl, this.now().toISOString(), { api: apiPayload }, warnings);
      } catch (error) {
        if (error instanceof SourceProviderError && (error.kind === "rate-limited" || error.kind === "unavailable" || error.kind === "invalid-response")) warnings.push(`Official YouTube API unavailable; used bounded public fallback: ${error.message}`);
        else throw error;
      }
    } else warnings.push("Official YouTube API key is not configured; used bounded public fallback");

    const reference = await this.options.reader.read(canonicalUrl);
    if (isBlockedPublicEvidence("youtube", reference)) throw new SourceProviderError("unavailable", "YouTube public evidence is blocked or unusable");
    return raw(canonicalUrl, reference.retrievedAt, { reference: compactReference({ ...reference, url: canonicalUrl }) }, warnings);
  }

  async normalize(value: RawSourceDocument, identity: SourceIdentity): Promise<NormalizedSourceDocument> {
    const payload = record(value.payload);
    const api = record(payload.api);
    if (Object.keys(api).length) return this.normalizeApi(value, identity, api);
    const reference = asReference(payload.reference);
    if (!reference) throw new SourceProviderError("invalid-response", "YouTube public evidence was malformed");
    return normalized(value, identity, this.id, this.version, {
      ...(profileFromIdentity(identity) ? { profile: profileFromIdentity(identity) } : {}),
      ...(reference.title ? { title: reference.title } : {}),
      ...(reference.summary ? { description: reference.summary } : {}),
      body: reference.excerpt,
      externalLinks: (reference.links ?? []).map(safeCanonicalUrl).filter((item): item is string => Boolean(item)).slice(0, 100),
      confidence: 0.7,
    });
  }

  private async fetchOfficial(request: SourceFetchRequest, identity: SourceIdentity): Promise<JsonValue | undefined> {
    const input = new URL(request.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      if (identity.sourceType === "video" || identity.sourceType === "short") {
        const videoId = youtubeVideoId(input);
        if (!videoId) return undefined;
        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.searchParams.set("part", "snippet,statistics,contentDetails");
        url.searchParams.set("id", videoId);
        url.searchParams.set("key", this.apiKey);
        const result = await this.json(url, controller.signal);
        const item = arrayRecords(record(result).items)[0];
        if (!item) throw new SourceProviderError("invalid-response", "YouTube video was not returned by the official API");
        return { kind: "video", item } as JsonValue;
      }
      const channelLookup = youtubeChannelLookup(input);
      if (!channelLookup) return undefined;
      const url = new URL("https://www.googleapis.com/youtube/v3/channels");
      url.searchParams.set("part", "snippet,statistics,contentDetails");
      if (channelLookup.kind === "id") url.searchParams.set("id", channelLookup.value);
      else url.searchParams.set("forHandle", channelLookup.value);
      url.searchParams.set("key", this.apiKey);
      const result = await this.json(url, controller.signal);
      const item = arrayRecords(record(result).items)[0];
      if (!item) throw new SourceProviderError("invalid-response", "YouTube channel was not returned by the official API");
      return { kind: "channel", item } as JsonValue;
    } catch (error) {
      if (controller.signal.aborted) throw new SourceProviderError("timeout", "YouTube extraction timed out");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  private normalizeApi(value: RawSourceDocument, identity: SourceIdentity, api: Record<string, any>): NormalizedSourceDocument {
    const item = record(api.item); const snippet = record(item.snippet); const statistics = record(item.statistics); const kind = text(api.kind);
    const title = text(snippet.title); const description = text(snippet.description); const tags = stringArray(snippet.tags).slice(0, 100);
    const engagement = numericRecord({ views: numeric(statistics.viewCount), likes: numeric(statistics.likeCount), comments: numeric(statistics.commentCount), subscribers: numeric(statistics.subscriberCount), videos: numeric(statistics.videoCount) });
    return normalized(value, identity, this.id, this.version, {
      ...(kind === "video" && text(snippet.channelTitle) ? { publisher: text(snippet.channelTitle)! } : {}),
      ...(kind === "channel" && title ? { profile: title, publisher: title } : {}),
      ...(title ? { title } : {}), ...(description ? { description, body: description } : {}),
      ...(text(snippet.publishedAt) ? { publishedAt: text(snippet.publishedAt)! } : {}), ...(tags.length ? { tags } : {}), ...(Object.keys(engagement).length ? { engagement } : {}), confidence: 1,
    });
  }

  private async json(url: URL, signal: AbortSignal): Promise<JsonValue> {
    const response = await this.fetchImpl(url, { signal, headers: { accept: "application/json" } });
    if (response.status === 403 || response.status === 429) throw new SourceProviderError("rate-limited", "YouTube quota or rate limit reached");
    if (response.status >= 500) throw new SourceProviderError("unavailable", "YouTube official API is unavailable");
    if (!response.ok) throw new SourceProviderError("invalid-response", `YouTube official API returned ${response.status}`);
    return await readJson(response, this.maxResponseBytes);
  }
}

function normalized(rawValue: RawSourceDocument, identity: SourceIdentity, provider: string, version: string, fields: Partial<NormalizedSourceDocument> & { confidence: number }): NormalizedSourceDocument {
  return prepareNormalizedSourceDocument({ canonicalUrl: rawValue.canonicalUrl, platform: identity.platform, sourceType: identity.sourceType, retrievedAt: rawValue.retrievedAt, contentHash: rawValue.contentHash, provider, providerVersion: version, parserVersion: version, provenance: [{ provider, providerVersion: version, sourceUrl: rawValue.canonicalUrl, retrievedAt: rawValue.retrievedAt }], extractionWarnings: rawValue.warnings ?? [], ...fields });
}
function raw(canonicalUrl: string, retrievedAt: string, payload: JsonValue, warnings: string[] = []): RawSourceDocument { return { canonicalUrl: normalizeCanonicalUrl(canonicalUrl), retrievedAt, contentHash: `sha256:${createHash("sha256").update(JSON.stringify(stableHashValue(payload))).digest("hex")}`, payload, ...(warnings.length ? { warnings } : {}) }; }
function compactReference(reference: PublicBrandReference): JsonValue { return { url: reference.url, ...(reference.title ? { title: reference.title } : {}), ...(reference.summary ? { summary: reference.summary } : {}), excerpt: reference.excerpt, retrievedAt: reference.retrievedAt, ...(reference.links?.length ? { links: reference.links } : {}) }; }
function asReference(value: unknown): PublicBrandReference | undefined { const item = record(value); const url = text(item.url); const excerpt = text(item.excerpt); const retrievedAt = text(item.retrievedAt); if (!url || !excerpt || !retrievedAt) return undefined; return { url, excerpt, retrievedAt, ...(text(item.title) ? { title: text(item.title)! } : {}), ...(text(item.summary) ? { summary: text(item.summary)! } : {}), ...(stringArray(item.links).length ? { links: stringArray(item.links) } : {}) }; }
function isBlockedPublicEvidence(platform: SocialPlatform | "youtube", reference: PublicBrandReference): boolean { const haystack = [reference.title, reference.summary, reference.excerpt].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " "); if (!haystack.trim()) return true; const patterns: Record<SocialPlatform | "youtube", RegExp[]> = { linkedin: [/sign in.*linkedin/, /join linkedin/, /linkedin login/, /authwall/, /sign up.*linkedin/], instagram: [/login.*instagram/, /log in.*instagram/, /sign up.*instagram/, /instagram login/], facebook: [/log into facebook/, /facebook login/, /sign up for facebook/, /you must log in/], youtube: [/before you continue to youtube/, /sign in.*youtube/] }; return patterns[platform].some((pattern) => pattern.test(haystack)); }
function profileFromIdentity(identity: SourceIdentity): string | undefined { try { const url = new URL(identity.canonicalUrl); const parts = url.pathname.split("/").filter(Boolean); if (identity.platform === "instagram") return parts[0]; if (identity.platform === "linkedin") return parts[1] ?? parts[0]; if (identity.platform === "facebook") return parts[0]; if (identity.platform === "youtube" && parts[0]?.startsWith("@")) return parts[0].slice(1); return undefined; } catch { return undefined; } }
function youtubeVideoId(url: URL): string | undefined { const host = url.hostname.replace(/^www\./, "").toLowerCase(); if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0]; if (url.pathname.toLowerCase() === "/watch") return text(url.searchParams.get("v")); const parts = url.pathname.split("/").filter(Boolean); if (parts[0]?.toLowerCase() === "shorts") return parts[1]; return undefined; }
function youtubeChannelLookup(url: URL): { kind: "id" | "handle"; value: string } | undefined { const parts = url.pathname.split("/").filter(Boolean); if (parts[0]?.toLowerCase() === "channel" && parts[1]) return { kind: "id", value: parts[1] }; if (parts[0]?.startsWith("@") && parts[0].length > 1) return { kind: "handle", value: parts[0].slice(1) }; return undefined; }
function canonicalizePublicSocialUrl(input: string): string { const url = new URL(normalizeCanonicalUrl(input)); for (const key of [...url.searchParams.keys()]) { if (/^utm_/i.test(key) || ["fbclid", "gclid", "dclid", "msclkid", "srsltid", "mc_cid", "mc_eid", "igsh", "igshid", "mibextid", "si", "feature"].includes(key.toLowerCase())) url.searchParams.delete(key); } return normalizeCanonicalUrl(url.toString()); }
function platformName(platform: SocialPlatform): string { return platform === "linkedin" ? "LinkedIn" : platform === "instagram" ? "Instagram" : "Facebook"; }
function safeCanonicalUrl(value: string | undefined): string | undefined { if (!value) return undefined; try { return normalizeCanonicalUrl(value); } catch { return undefined; } }
function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function arrayRecords(value: unknown): Record<string, any>[] { return Array.isArray(value) ? value.map(record) : []; }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : []; }
function numeric(value: unknown): number | undefined { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value); return undefined; }
function numericRecord(value: Record<string, unknown>): Record<string, number> { return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))); }
function boundedInteger(value: number, min: number, max: number, name: string) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be from ${min} to ${max}`); return value; }
function stableHashValue(value: JsonValue): JsonValue { if (Array.isArray(value)) return value.map(stableHashValue); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "retrievedAt").map(([key, item]) => [key, stableHashValue(item as JsonValue)])) as JsonValue; return value; }
async function readText(response: Response, maxBytes: number) { const declared = Number(response.headers.get("content-length") ?? 0); if (declared > maxBytes) throw new SourceProviderError("invalid-response", "Source response exceeded size limit"); const value = await response.text(); if (Buffer.byteLength(value) > maxBytes) throw new SourceProviderError("invalid-response", "Source response exceeded size limit"); return value; }
async function readJson(response: Response, maxBytes: number): Promise<JsonValue> { try { return JSON.parse(await readText(response, maxBytes)) as JsonValue; } catch (error) { if (error instanceof SourceProviderError) throw error; throw new SourceProviderError("invalid-response", "Source returned invalid JSON"); } }
