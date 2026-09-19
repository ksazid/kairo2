import type { DiscoveryEvidence, DiscoveryRequest, DiscoverySourceProvider } from "@kairo/agent-contracts";
import { preparePublicSignal } from "@kairo/domain/discovery";

export type ResearchEvidenceFailureKind =
  | "unavailable"
  | "rate-limited"
  | "upstream"
  | "invalid-response"
  | "timeout";

export class ResearchEvidenceAdapterError extends Error {
  readonly code = "research_evidence_adapter_error";
  constructor(readonly kind: ResearchEvidenceFailureKind, message: string) {
    super(message);
    this.name = "ResearchEvidenceAdapterError";
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface CommonOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
  maxResponseBytes?: number;
  contactEmail?: string;
}

export interface OpenAlexResearchEvidenceProviderOptions extends CommonOptions {
  apiKey?: string;
}

export class OpenAlexResearchEvidenceProvider implements DiscoverySourceProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxResponseBytes: number;
  private readonly apiKey: string;

  constructor(options: OpenAlexResearchEvidenceProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxResponseBytes = boundedPositiveInteger(options.maxResponseBytes ?? 2_000_000, "maxResponseBytes", 5_000_000);
    this.apiKey = options.apiKey?.trim() ?? "";
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const normalized = validateResearchRequest(request);
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", normalized.query);
    url.searchParams.set("per_page", String(normalized.maxResults));
    url.searchParams.set("select", "id,doi,display_name,publication_date,abstract_inverted_index,authorships,primary_location");
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      classifyHttpFailure(response, "OpenAlex");
      const payload = asRecord(await readJson(response, this.maxResponseBytes));
      if (!payload || !Array.isArray(payload.results)) {
        throw new ResearchEvidenceAdapterError("invalid-response", "OpenAlex returned an invalid result envelope");
      }

      const retrievedAt = this.now().toISOString();
      const evidence: DiscoveryEvidence[] = [];
      for (const raw of payload.results) {
        const work = asRecord(raw);
        if (!work) continue;
        const title = asText(work.display_name);
        const sourceUrl = canonicalDoiUrl(asText(work.doi)) ?? safeHttpsUrl(asText(work.id));
        if (!title || !sourceUrl) continue;
        const summary = reconstructOpenAlexAbstract(work.abstract_inverted_index);
        const publisher = openAlexPublisher(work.primary_location);
        const author = openAlexAuthors(work.authorships);
        const publishedAt = isoDate(asText(work.publication_date));
        const prepared = tryPrepareEvidence({
          title: truncate(title, 500),
          ...(summary ? { summary: truncate(summary, 2_000) } : {}),
          sourceUrl,
          platform: "research",
          ...(publisher ? { publisher: truncate(publisher, 300) } : {}),
          ...(author ? { author: truncate(author, 500) } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          retrievedAt,
          provider: "openalex",
          providerVersion: "works-v1",
        });
        if (prepared) evidence.push(prepared);
        if (evidence.length >= normalized.maxResults) break;
      }
      return evidence;
    } catch (error) {
      if (controller.signal.aborted) throw new ResearchEvidenceAdapterError("timeout", "OpenAlex research evidence request timed out");
      if (error instanceof ResearchEvidenceAdapterError) throw error;
      throw new ResearchEvidenceAdapterError("invalid-response", "OpenAlex research evidence response could not be processed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface CrossrefResearchEvidenceProviderOptions extends CommonOptions {
  userAgent?: string;
}

export class CrossrefResearchEvidenceProvider implements DiscoverySourceProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly maxResponseBytes: number;
  private readonly contactEmail: string;
  private readonly userAgent: string;

  constructor(options: CrossrefResearchEvidenceProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxResponseBytes = boundedPositiveInteger(options.maxResponseBytes ?? 2_000_000, "maxResponseBytes", 5_000_000);
    this.contactEmail = options.contactEmail?.trim() ?? "";
    this.userAgent = options.userAgent?.trim() || "Kairo/0.1";
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const normalized = validateResearchRequest(request);
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.bibliographic", normalized.query);
    url.searchParams.set("rows", String(normalized.maxResults));
    if (this.contactEmail) url.searchParams.set("mailto", this.contactEmail);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": this.userAgent },
      });
      classifyHttpFailure(response, "Crossref");
      const payload = asRecord(await readJson(response, this.maxResponseBytes));
      const message = asRecord(payload?.message);
      if (!message || !Array.isArray(message.items)) {
        throw new ResearchEvidenceAdapterError("invalid-response", "Crossref returned an invalid result envelope");
      }

      const retrievedAt = this.now().toISOString();
      const evidence: DiscoveryEvidence[] = [];
      for (const raw of message.items) {
        const work = asRecord(raw);
        if (!work) continue;
        const title = firstText(work.title);
        const doiUrl = canonicalDoiUrl(asText(work.DOI));
        const sourceUrl = doiUrl ?? safeHttpsUrl(asText(work.URL));
        if (!title || !sourceUrl) continue;
        const abstract = asText(work.abstract);
        const summary = abstract ? stripMarkup(abstract) : undefined;
        const publisher = asText(work.publisher);
        const author = crossrefAuthors(work.author);
        const publishedAt = crossrefPublishedAt(work);
        const prepared = tryPrepareEvidence({
          title: truncate(title, 500),
          ...(summary ? { summary: truncate(summary, 2_000) } : {}),
          sourceUrl,
          platform: "research",
          ...(publisher ? { publisher: truncate(publisher, 300) } : {}),
          ...(author ? { author: truncate(author, 500) } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          retrievedAt,
          provider: "crossref",
          providerVersion: "rest-v1",
        });
        if (prepared) evidence.push(prepared);
        if (evidence.length >= normalized.maxResults) break;
      }
      return evidence;
    } catch (error) {
      if (controller.signal.aborted) throw new ResearchEvidenceAdapterError("timeout", "Crossref research evidence request timed out");
      if (error instanceof ResearchEvidenceAdapterError) throw error;
      throw new ResearchEvidenceAdapterError("invalid-response", "Crossref research evidence response could not be processed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateResearchRequest(request: DiscoveryRequest): DiscoveryRequest {
  const query = request?.query?.trim();
  if (!query) throw new ResearchEvidenceAdapterError("invalid-response", "Research evidence query is required");
  if (request.scope?.visibility !== "global-public") {
    throw new ResearchEvidenceAdapterError("invalid-response", "Public research evidence requires global-public scope");
  }
  if (!Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 20) {
    throw new ResearchEvidenceAdapterError("invalid-response", "maxResults must be an integer from 1 to 20");
  }
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 120_000) {
    throw new ResearchEvidenceAdapterError("invalid-response", "timeoutMs must be an integer from 100 to 120000");
  }
  return { ...request, query };
}

function classifyHttpFailure(response: Response, provider: string): void {
  if (response.status === 429) throw new ResearchEvidenceAdapterError("rate-limited", `${provider} rate limited the research evidence request`);
  if (response.status === 401 || response.status === 403) throw new ResearchEvidenceAdapterError("unavailable", `${provider} research evidence access is unavailable`);
  if (response.status >= 500) throw new ResearchEvidenceAdapterError("upstream", `${provider} research evidence service is unavailable`);
  if (!response.ok) throw new ResearchEvidenceAdapterError("upstream", `${provider} research evidence request failed`);
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ResearchEvidenceAdapterError("invalid-response", "Research evidence response exceeded size limit");
  }
  try { return JSON.parse(text) as unknown; }
  catch { throw new ResearchEvidenceAdapterError("invalid-response", "Research evidence provider returned invalid JSON"); }
}

function reconstructOpenAlexAbstract(value: unknown): string | undefined {
  const index = asRecord(value);
  if (!index) return undefined;
  const positioned: Array<{ position: number; token: string }> = [];
  for (const [token, rawPositions] of Object.entries(index)) {
    if (!Array.isArray(rawPositions)) continue;
    for (const rawPosition of rawPositions) {
      if (typeof rawPosition === "number" && Number.isInteger(rawPosition) && rawPosition >= 0 && rawPosition < 10_000) {
        positioned.push({ position: rawPosition, token });
      }
    }
  }
  if (!positioned.length) return undefined;
  positioned.sort((a, b) => a.position - b.position || a.token.localeCompare(b.token));
  return positioned.slice(0, 400).map((item) => item.token).join(" ").replace(/\s+/g, " ").trim() || undefined;
}

function openAlexPublisher(value: unknown): string | undefined {
  const location = asRecord(value);
  const source = asRecord(location?.source);
  return asText(source?.display_name);
}

function openAlexAuthors(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.flatMap((raw) => {
    const authorship = asRecord(raw);
    const author = asRecord(authorship?.author);
    const name = asText(author?.display_name);
    return name ? [name] : [];
  }).slice(0, 5);
  return names.length ? names.join("; ") : undefined;
}

function crossrefAuthors(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.flatMap((raw) => {
    const author = asRecord(raw);
    const given = asText(author?.given);
    const family = asText(author?.family);
    const name = [given, family].filter(Boolean).join(" ").trim();
    return name ? [name] : [];
  }).slice(0, 5);
  return names.length ? names.join("; ") : undefined;
}

function crossrefPublishedAt(work: Record<string, unknown>): string | undefined {
  return datePartsToIso(work.published) ?? datePartsToIso(work["published-print"]) ?? datePartsToIso(work["published-online"]);
}

function datePartsToIso(value: unknown): string | undefined {
  const record = asRecord(value);
  const parts = Array.isArray(record?.["date-parts"]) ? record!["date-parts"] : undefined;
  const first = Array.isArray(parts?.[0]) ? parts[0] : undefined;
  if (!first || typeof first[0] !== "number" || !Number.isInteger(first[0])) return undefined;
  const year = first[0];
  const month = typeof first[1] === "number" && Number.isInteger(first[1]) ? first[1] : 1;
  const day = typeof first[2] === "number" && Number.isInteger(first[2]) ? first[2] : 1;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function isoDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function canonicalDoiUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
  if (!/^10\.\d{4,9}\/[\S]+$/i.test(normalized)) return undefined;
  return `https://doi.org/${normalized}`;
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch { return undefined; }
}

function firstText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return asText(value);
  for (const item of value) {
    const text = asText(item);
    if (text) return text;
  }
  return undefined;
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function boundedPositiveInteger(value: number, field: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${field} must be an integer from 1 to ${max}`);
  return value;
}
