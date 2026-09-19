import type {
  DiscoveryEvidence,
  DiscoveryRequest,
  DiscoverySourceProvider,
  PublicContentFetchPort,
  ToolGatewayPort,
  ToolRequest,
  ToolResult,
} from "@kairo/agent-contracts";
import { preparePublicSignal } from "@kairo/domain/discovery";

export const AGENT_REACH_PIN = "93ae1d18c37b707dec053c7c4f9d91cd8ef8943d";

export class DiscoveryProviderError extends Error {
  readonly code = "discovery_provider_error";
}

export interface RawPublicSearchResult {
  title: string;
  url: string;
  summary?: string;
  platform?: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  contentHash?: string;
}

export interface AgentReachSearchBackend {
  /** Fixed public search operation. No executable or argument-vector input is accepted. */
  search(query: string, options: { maxResults: number; timeoutMs: number; signal: AbortSignal }): Promise<RawPublicSearchResult[]>;
}

export class AgentReachDiscoveryProvider implements DiscoverySourceProvider {
  constructor(
    private readonly backend: AgentReachSearchBackend,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const query = request.query.trim();
    if (!query) throw new DiscoveryProviderError("Discovery query is required");
    if (!Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 20) {
      throw new DiscoveryProviderError("maxResults must be an integer from 1 to 20");
    }
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 120_000) {
      throw new DiscoveryProviderError("timeoutMs must be an integer from 100 to 120000");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const raw = await this.backend.search(query, {
        maxResults: request.maxResults,
        timeoutMs: request.timeoutMs,
        signal: controller.signal,
      });
      const retrievedAt = this.now().toISOString();
      return raw.slice(0, request.maxResults).map((result) => {
        const prepared = preparePublicSignal({
          title: result.title,
          ...(result.summary ? { summary: result.summary } : {}),
          sourceUrl: result.url,
          platform: result.platform ?? "web",
          ...(result.publisher ? { publisher: result.publisher } : {}),
          ...(result.author ? { author: result.author } : {}),
          ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
          retrievedAt,
          provider: "agent-reach",
          providerVersion: AGENT_REACH_PIN,
          ...(result.contentHash ? { contentHash: result.contentHash } : {}),
        });
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
          providerVersion: prepared.providerVersion,
          ...(prepared.contentHash ? { contentHash: prepared.contentHash } : {}),
        } satisfies DiscoveryEvidence;
      });
    } catch (error) {
      if (controller.signal.aborted) throw new DiscoveryProviderError("Discovery provider timed out");
      if (error instanceof DiscoveryProviderError) throw error;
      throw new DiscoveryProviderError(`Discovery provider failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Kairo-owned provider router. Provider credentials stay inside concrete adapters; the ToolRequest
 * carries only the public source key, query and bounded result count.
 */
export class SourceRoutingToolGateway implements ToolGatewayPort {
  private readonly providers: ReadonlyMap<string, DiscoverySourceProvider>;

  constructor(
    private readonly fallback: DiscoverySourceProvider,
    providers: Readonly<Record<string, DiscoverySourceProvider>> = {},
    private readonly fetcher?: PublicContentFetchPort,
  ) {
    this.providers = new Map(
      Object.entries(providers).map(([key, provider]) => [normalizeSourceKey(key), provider]),
    );
  }

  async invoke<TOutput>(request: ToolRequest): Promise<ToolResult<TOutput>> {
    if (request.capability === "public-content-fetch") {
      if (!this.fetcher) throw new DiscoveryProviderError("public-content-fetch is not configured");
      const url = typeof request.input.url === "string" ? request.input.url.trim() : "";
      if (!url) throw new DiscoveryProviderError("public-content-fetch requires url");
      const result = await this.fetcher.fetch({ url, scope: request.scope, timeoutMs: request.timeoutMs });
      return { output: result as TOutput, provenance: result.document.provenance };
    }
    if (request.capability !== "public-content-search") throw new DiscoveryProviderError("Tool capability is not implemented by this gateway");
    const query = typeof request.input.query === "string" ? request.input.query.trim() : "";
    if (!query) throw new DiscoveryProviderError("public-content-search requires query");
    const requestedMax = request.input.maxResults;
    const maxResults = typeof requestedMax === "number" ? requestedMax : 8;
    const requestedSource = typeof request.input.source === "string" ? request.input.source.trim() : "";
    const source = requestedSource ? normalizeSourceKey(requestedSource) : "agent-reach";
    const provider = source === "agent-reach" ? this.fallback : this.providers.get(source);
    if (!provider) throw new DiscoveryProviderError(`Discovery source ${source} is not registered`);

    const evidence = await provider.discover({ query, scope: request.scope, maxResults, timeoutMs: request.timeoutMs });
    return {
      output: evidence as TOutput,
      provenance: evidence.map((item) => ({
        provider: item.provider,
        ...(item.providerVersion ? { providerVersion: item.providerVersion } : {}),
        sourceUrl: item.sourceUrl,
        retrievedAt: item.retrievedAt,
      })),
    };
  }
}

/** Backward-compatible Agent-Reach-only gateway retained for existing callers. */
export class KairoToolGateway extends SourceRoutingToolGateway {
  constructor(discovery: DiscoverySourceProvider) {
    super(discovery);
  }
}

function normalizeSourceKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) throw new DiscoveryProviderError("Discovery source key is invalid");
  return normalized;
}
