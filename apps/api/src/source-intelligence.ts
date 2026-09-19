import { createHash } from "node:crypto";
import { InMemoryNormalizedSourceCache, SourceRouter, prepareNormalizedSourceDocument, type NormalizedSourceCache, type RawSourceDocument, type SourceAdapter, type SourceIdentity } from "@kairo/agent-contracts";
import type { PublicBrandReference, PublicBrandReferenceReader } from "@kairo/domain/brand-brain-bootstrap";
import { PublicBrandReferenceHttpReader } from "./public-brand-reference";
import { GitHubAdapter, HackerNewsAdapter, RssSubstackAdapter, WebsiteAdapter } from "./source-adapters";
import { FacebookAdapter, InstagramAdapter, ProfessionalNetworkAdapter, YouTubeAdapter } from "./social-source-adapters";
import { MediaAnalyzer, selectOnboardingEvidence, type OnboardingEvidenceCandidate } from "./media-intelligence";

const ADAPTER_VERSION = "secure-http-v2";
const PARSER_VERSION = "public-brand-reference-v2";
const DEDICATED_SOCIAL_PLATFORMS = new Set(["instagram", "facebook", "linkedin", "youtube"]);

export class SecureHttpSourceAdapter implements SourceAdapter {
  readonly id = "secure-http"; readonly version = ADAPTER_VERSION; readonly priority = -100;
  constructor(private readonly reader: PublicBrandReferenceReader, private readonly platformFallbacks: ReadonlySet<string> = new Set()) {}
  supports(url: URL) { const identity = SourceRouter.identify(url); return (url.protocol === "http:" || url.protocol === "https:") && (!DEDICATED_SOCIAL_PLATFORMS.has(identity.platform) || this.platformFallbacks.has(identity.platform)); }
  identify(url: URL) { return SourceRouter.identify(url); }
  async health() { return { status: "available" as const }; }
  async fetch(request: { url: string }) { const reference = await this.reader.read(request.url); const stableContent = JSON.stringify({ title: reference.title ?? "", summary: reference.summary ?? "", excerpt: reference.excerpt, contentType: reference.contentType ?? "" }); return { canonicalUrl: reference.url, retrievedAt: reference.retrievedAt, contentHash: `sha256:${createHash("sha256").update(stableContent).digest("hex")}`, payload: compactReference(reference) } satisfies RawSourceDocument; }
  async normalize(raw: RawSourceDocument, identity: SourceIdentity) { const value = raw.payload as Record<string, unknown>; const title = typeof value.title === "string" ? value.title : undefined; const summary = typeof value.summary === "string" ? value.summary : undefined; const body = typeof value.excerpt === "string" ? value.excerpt : undefined; return prepareNormalizedSourceDocument({ canonicalUrl: raw.canonicalUrl, platform: identity.platform, sourceType: identity.sourceType, ...(title ? { title } : {}), ...(summary ? { description: summary } : {}), ...(body ? { body } : {}), retrievedAt: raw.retrievedAt, contentHash: raw.contentHash, provider: this.id, providerVersion: this.version, parserVersion: PARSER_VERSION, provenance: [{ provider: this.id, providerVersion: this.version, sourceUrl: raw.canonicalUrl, retrievedAt: raw.retrievedAt }], confidence: body ? 1 : 0.5, extractionWarnings: raw.warnings ?? [] }); }
}

export interface SourceIntelligenceRouterOptions { reader?: PublicBrandReferenceReader; cache?: NormalizedSourceCache; youtubeApiKey?: string; linkedinPublicEnabled?: boolean; }
export function createSourceIntelligenceRouter(options: SourceIntelligenceRouterOptions = {}) {
  const reader = options.reader ?? new PublicBrandReferenceHttpReader();
  const youtubeApiKey = options.youtubeApiKey ?? process.env.YOUTUBE_API_KEY ?? process.env.KAIRO_YOUTUBE_API_KEY;
  const linkedinPublicEnabled = options.linkedinPublicEnabled ?? process.env.KAIRO_LINKEDIN_PUBLIC_EXTRACTION_ENABLED === "true";
  return new SourceRouter([new GitHubAdapter(), new HackerNewsAdapter({ linkedReader: reader }), new YouTubeAdapter({ reader, ...(youtubeApiKey ? { apiKey: youtubeApiKey } : {}) }), new RssSubstackAdapter(), new InstagramAdapter({ reader }), new FacebookAdapter({ reader }), ...(linkedinPublicEnabled ? [new ProfessionalNetworkAdapter({ reader })] : []), new WebsiteAdapter({ reader }), new SecureHttpSourceAdapter(reader, linkedinPublicEnabled ? new Set() : new Set(["linkedin"]))], options.cache ?? new InMemoryNormalizedSourceCache());
}

export class SourceIntelligenceBrandReferenceReader implements PublicBrandReferenceReader {
  private readonly analyzer = new MediaAnalyzer();
  private readonly limits = onboardingLimitsFromEnv();
  constructor(private readonly router = createSourceIntelligenceRouter()) {}
  async read(url: string): Promise<PublicBrandReference> {
    const initial = (await this.router.fetch({ url, scope: { visibility: "global-public" }, timeoutMs: 10_000 })).document;
    const candidates: OnboardingEvidenceCandidate[] = [
      { url: initial.canonicalUrl, contentHash: initial.contentHash, kind: "initial" },
      ...(initial.externalLinks ?? []).flatMap((link): OnboardingEvidenceCandidate[] => {
        const kind = classifyOnboardingLink(link);
        return kind ? [{ url: link, kind }] : [];
      }),
    ];
    const selected = selectOnboardingEvidence(candidates, { recent: this.limits.recent, deep: this.limits.deep, total: this.limits.total });
    const documents = [initial]; let usedBytes = Buffer.byteLength(initial.body ?? initial.description ?? initial.title ?? "");
    for (const candidate of selected.slice(1)) {
      if (usedBytes >= this.limits.maxBytes) break;
      try {
        const document = (await this.router.fetch({ url: candidate.url, scope: { visibility: "global-public" }, timeoutMs: 8_000 })).document;
        if (document.video?.durationSeconds && document.video.durationSeconds > this.limits.maxVideoDuration) continue;
        const bytes = Buffer.byteLength(document.body ?? document.transcript ?? document.description ?? "");
        if (usedBytes + bytes > this.limits.maxBytes) continue;
        documents.push(document); usedBytes += bytes;
      } catch { /* one unavailable source does not block onboarding */ }
    }
    const analyses = await Promise.all(documents.slice(0, this.limits.deep + 1).map((document) => this.analyzer.analyze(document)));
    const excerpt = [...documents.map((document) => document.body ?? document.transcript ?? document.description ?? document.title), ...analyses.flatMap((analysis) => [analysis.thesis, ...analysis.claims, ...analysis.visualStyle])]
      .filter((value): value is string => Boolean(value?.trim())).join("\n\n").slice(0, this.limits.maxBytes);
    if (!excerpt) throw new Error("Public Brand reference contained no usable text");
    return { url: initial.canonicalUrl, ...(initial.title ? { title: initial.title } : {}), ...(initial.description ? { summary: initial.description } : {}), excerpt, retrievedAt: initial.retrievedAt,
      links: documents.flatMap((document) => document.externalLinks ?? []).filter(isHttpUrl).slice(0, 100) };
  }
}
function compactReference(reference: PublicBrandReference) { return { ...(reference.title ? { title: reference.title } : {}), ...(reference.summary ? { summary: reference.summary } : {}), excerpt: reference.excerpt, ...(reference.contentType ? { contentType: reference.contentType } : {}), ...(reference.sizeBytes !== undefined ? { sizeBytes: reference.sizeBytes } : {}), ...(reference.links?.length ? { links: reference.links } : {}) }; }
function classifyOnboardingLink(value: string): OnboardingEvidenceCandidate["kind"] | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const path = url.pathname;
    if (/\babout\b/i.test(path)) return "about";
    if (/\b(products?|services?|pricing)\b/i.test(path)) return "product";
    if (/\b(blog|news|resources?|insights?|reel|shorts?)\b/i.test(path)) return "recent";
    return "deep";
  } catch { return undefined; }
}
function isHttpUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function onboardingLimitsFromEnv() {
  const integer = (name: string, fallback: number, min: number, max: number) => { const parsed = Number(process.env[name] ?? fallback); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; };
  const recent = integer("BRAND_ONBOARDING_MAX_RECENT_ITEMS", 20, 0, 50); const deep = integer("BRAND_ONBOARDING_MAX_DEEP_ITEMS", 5, 0, 20);
  return { recent, deep, total: Math.min(64, recent + deep + 7), maxVideoDuration: integer("BRAND_ONBOARDING_MAX_VIDEO_DURATION", 1_200, 30, 14_400), maxBytes: integer("BRAND_ONBOARDING_MAX_BYTES", 2_000_000, 8_000, 10_000_000) };
}
