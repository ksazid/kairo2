import type { DiscoveryEvidence, ToolGatewayPort } from "@kairo/agent-contracts";
import type { HunterRetrievalIntent } from "@kairo/domain/hunter-retrieval";
import type { ShadowDiscoverySearchPort } from "./hunter-shadow-retrieval";

export interface GatewayShadowSearchOptions {
  timeoutMs?: number;
  maxSourcesPerIntent?: number;
}

export class GatewayShadowSearchPort implements ShadowDiscoverySearchPort {
  private readonly timeoutMs: number;
  private readonly maxSourcesPerIntent: number;

  constructor(private readonly gateway: ToolGatewayPort, options: GatewayShadowSearchOptions = {}) {
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 12_000, "timeoutMs", 100, 120_000);
    this.maxSourcesPerIntent = boundedInteger(options.maxSourcesPerIntent ?? 2, "maxSourcesPerIntent", 1, 4);
  }

  async search(intent: HunterRetrievalIntent): Promise<readonly DiscoveryEvidence[]> {
    const sources = sourceKeysForIntent(intent).slice(0, this.maxSourcesPerIntent);
    const combined: DiscoveryEvidence[] = [];
    let successCount = 0;
    for (const source of sources) {
      try {
        const result = await this.gateway.invoke<DiscoveryEvidence[]>({
          capability: "public-content-search",
          scope: { visibility: "global-public" },
          input: { query: intent.query, maxResults: intent.maxResults, source },
          timeoutMs: this.timeoutMs,
        });
        successCount += 1;
        combined.push(...result.output.slice(0, intent.maxResults));
      } catch {
        // One unavailable source must not collapse the shadow retrieval intent.
      }
    }
    if (!successCount) throw new Error("No shadow discovery source completed successfully");
    return combined.slice(0, intent.maxResults * this.maxSourcesPerIntent);
  }
}

export function sourceKeysForIntent(intent: HunterRetrievalIntent): string[] {
  const preferred: string[] = [];
  for (const sourceClass of intent.sourceClasses) {
    const normalized = sourceClass.trim().toLowerCase();
    if (normalized.includes("youtube") || normalized === "video") preferred.push("youtube");
    if (normalized.includes("github")) preferred.push("github");
    if (normalized.includes("hacker")) preferred.push("hacker-news");
    if (normalized.includes("rss") || normalized.includes("official") || normalized.includes("news")) preferred.push("rss");
    if (normalized.includes("community") || normalized.includes("social")) preferred.push("agent-reach");
  }

  const defaults: Record<string, readonly string[]> = {
    "brand-core": ["agent-reach", "rss"],
    "audience-problem": ["agent-reach", "rss"],
    "category-competitor": ["agent-reach", "rss"],
    "rising-breaking": ["hacker-news", "rss", "agent-reach"],
    outlier: ["youtube", "agent-reach"],
    authority: ["rss", "agent-reach"],
    evergreen: ["agent-reach", "rss"],
    "adjacent-exploration": ["agent-reach"],
    "cross-source-confirmation": ["agent-reach", "rss"],
  };
  return unique([...preferred, ...(defaults[intent.generator] ?? ["agent-reach"])]).slice(0, 4);
}

function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(field + " must be an integer from " + min + " to " + max);
  return value as number;
}