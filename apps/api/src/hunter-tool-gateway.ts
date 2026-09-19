import { AgentReachDiscoveryProvider, DiscoveryProviderError, SourceRoutingToolGateway } from "@kairo/worker/discovery-provider";
import {
  BlueskyDiscoveryProvider,
  GitHubDiscoveryProvider,
  HackerNewsDiscoveryProvider,
  RssAtomDiscoveryProvider,
  type RssFeedDefinition,
  YouTubeDiscoveryProvider,
} from "@kairo/worker/public-discovery-adapters";
import { createSourceIntelligenceRouter } from "./source-intelligence";
import { RetryingDiscoverySourceProvider } from "@kairo/worker/retrying-discovery-provider";
import { DEFAULT_SOURCE_REGISTRY } from "@kairo/domain/source-registry";
import { agentReachSearchBackendFromEnv } from "./agent-reach-exa-backend";

/**
 * Runtime discovery wiring for Home recommendations.
 *
 * Agent Reach is available only when its approved server-side Exa binding is configured. Public
 * providers are independently routed; they are never presented as Agent Reach evidence.
 */
export function createHunterToolGateway(env: NodeJS.ProcessEnv = process.env) {
  const hackerNews = new RetryingDiscoverySourceProvider(new HackerNewsDiscoveryProvider());
  const bluesky = new RetryingDiscoverySourceProvider(new BlueskyDiscoveryProvider());
  const github = new RetryingDiscoverySourceProvider(new GitHubDiscoveryProvider());
  const feeds = rssFeedsFromEnv(env.KAIRO_HUNTER_RSS_FEEDS_JSON);
  const rss = new RetryingDiscoverySourceProvider(new RssAtomDiscoveryProvider({ feeds }));
  const youtubeKey = env.YOUTUBE_API_KEY?.trim();
  const youtube = youtubeKey ? new RetryingDiscoverySourceProvider(new YouTubeDiscoveryProvider({ apiKey: youtubeKey })) : undefined;
  const agentReachBackend = agentReachSearchBackendFromEnv(env);
  const agentReach = agentReachBackend
    ? new RetryingDiscoverySourceProvider(new AgentReachDiscoveryProvider(agentReachBackend))
    : new UnavailableDiscoverySourceProvider("Agent Reach is not configured");

  return new SourceRoutingToolGateway(agentReach, {
    "agent-reach": agentReach,
    "hacker-news": hackerNews,
    bluesky,
    github,
    rss,
    ...(youtube ? { youtube } : {}),
  }, createSourceIntelligenceRouter());
}

export function configuredHunterSourceRegistry(env: NodeJS.ProcessEnv = process.env) {
  const hasYouTube = Boolean(env.YOUTUBE_API_KEY?.trim());
  const hasRssFeeds = rssFeedsFromEnv(env.KAIRO_HUNTER_RSS_FEEDS_JSON).length > 0;
  const hasAgentReach = Boolean(env.EXA_API_KEY?.trim());
  return DEFAULT_SOURCE_REGISTRY.map((source) => ({
    ...source,
    enabled: source.enabled
      && (source.key !== "agent-reach" || hasAgentReach)
      && (source.key !== "youtube" || hasYouTube)
      && (source.key !== "rss" || hasRssFeeds),
  }));
}

class UnavailableDiscoverySourceProvider {
  constructor(private readonly message: string) {}
  async discover(): Promise<never> {
    throw new DiscoveryProviderError(this.message);
  }
}

function rssFeedsFromEnv(value: string | undefined): RssFeedDefinition[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      if (typeof value.url !== "string" || !/^https?:\/\//i.test(value.url)) return [];
      return [{ key: typeof value.key === "string" && value.key.trim() ? value.key.trim() : `feed-${index + 1}`, url: value.url,
        tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())) : [],
        ...(typeof value.publisher === "string" && value.publisher.trim() ? { publisher: value.publisher.trim() } : {}) }];
    });
  } catch { return []; }
}
