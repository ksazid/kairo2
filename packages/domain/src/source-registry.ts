import type { DiscoverySourceDefinition } from "./source-policy";

/**
 * Capability/budget metadata only. Brand-private context never belongs in this registry.
 * Providers other than Agent Reach are planned capabilities until VS-12B/VS-12C.
 */
export const DEFAULT_SOURCE_REGISTRY = [
  {
    key: "github",
    capabilities: ["discovery"],
    enabled: true,
    requiresCredential: false,
    maxQueriesPerRun: 2,
  },
  {
    key: "agent-reach",
    capabilities: ["discovery"],
    enabled: true,
    requiresCredential: false,
    maxQueriesPerRun: 2,
  },
  {
    key: "rss",
    capabilities: ["discovery"],
    enabled: true,
    requiresCredential: false,
    maxQueriesPerRun: 3,
  },
  {
    key: "youtube",
    capabilities: ["discovery"],
    enabled: true,
    requiresCredential: true,
    maxQueriesPerRun: 2,
  },
  {
    key: "hacker-news",
    capabilities: ["discovery"],
    enabled: true,
    requiresCredential: false,
    maxQueriesPerRun: 2,
  },
  {
    key: "bluesky",
    capabilities: ["discovery"],
    enabled: true,
    requiresCredential: false,
    maxQueriesPerRun: 2,
  },
  {
    key: "openalex",
    capabilities: ["research"],
    enabled: true,
    requiresCredential: false,
    maxQueriesPerRun: 2,
  },
  {
    key: "crossref",
    capabilities: ["verification"],
    enabled: true,
    requiresCredential: false,
    maxQueriesPerRun: 2,
  },
] as const satisfies readonly DiscoverySourceDefinition[];
