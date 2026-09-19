import type { AgentReachSearchBackend, RawPublicSearchResult } from "@kairo/worker/discovery-provider";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Agent Reach's approved public-search recipe uses Exa. This adapter owns the
 * fixed upstream binding: callers can supply only a query and bounded result
 * count, never a command line, URL, credential or source selector.
 */
export class ExaAgentReachSearchBackend implements AgentReachSearchBackend {
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch) {}

  async search(query: string, options: { maxResults: number; timeoutMs: number; signal: AbortSignal }): Promise<RawPublicSearchResult[]> {
    const response = await this.fetchImpl(EXA_SEARCH_URL, {
      method: "POST",
      signal: options.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: options.maxResults,
        contents: { highlights: { maxCharacters: 1_200 } },
      }),
    });
    if (!response.ok) throw new Error(`Agent Reach search upstream returned ${response.status}`);
    const payload = asRecord(await readBoundedJson(response));
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return results.flatMap((raw) => {
      const item = asRecord(raw);
      const title = text(item?.title);
      const url = text(item?.url);
      if (!title || !url) return [];
      const highlights = Array.isArray(item?.highlights)
        ? item.highlights.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join("\n")
        : undefined;
      return [{
        title,
        url,
        ...(highlights ? { summary: highlights.slice(0, 4_000) } : {}),
        platform: "web",
        ...(text(item?.author) ? { author: text(item?.author) } : {}),
        ...(text(item?.publishedDate) ? { publishedAt: text(item?.publishedDate) } : {}),
      } satisfies RawPublicSearchResult];
    }).slice(0, options.maxResults);
  }
}

export function agentReachSearchBackendFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): AgentReachSearchBackend | undefined {
  const apiKey = env.EXA_API_KEY?.trim();
  return apiKey ? new ExaAgentReachSearchBackend(apiKey, fetchImpl) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error("Agent Reach search response exceeds size limit");
  const value = await response.text();
  if (value.length > MAX_RESPONSE_BYTES) throw new Error("Agent Reach search response exceeds size limit");
  try { return JSON.parse(value); } catch { throw new Error("Agent Reach search returned invalid JSON"); }
}
