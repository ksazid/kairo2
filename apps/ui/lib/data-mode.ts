export type KairoDataMode = "live" | "preview" | "empty" | "collecting" | "unavailable";

export type DataModeState = {
  mode: KairoDataMode;
  label: string;
  message: string;
  usesSampleData: boolean;
  isLive: boolean;
};

export type InsightCollectionStatus = {
  status: "queued" | "running" | "complete" | "failed" | "unavailable";
  permission?: "required" | "granted" | "unknown";
  freshness?: "fresh" | "delayed" | "not-due" | "due" | "unavailable";
};

export function resolveDiscoveryDataMode(input: {
  authenticated: boolean;
  brandId?: string;
  realItemCount: number;
  hunterReady?: boolean;
  readinessScore?: number;
  latestRunStatus?: "running" | "succeeded" | "failed";
}): DataModeState {
  if (!input.authenticated) return {
    mode: "preview",
    label: "Sample preview",
    message: "These example opportunities show how Discover works before you connect and prepare a Brand.",
    usesSampleData: true,
    isLive: false,
  };
  if (!input.brandId) return {
    mode: "empty",
    label: "Choose a Brand",
    message: "Select a Brand to see readiness, run Hunter, and replace examples with real opportunities.",
    usesSampleData: false,
    isLive: false,
  };
  if (input.realItemCount > 0) return {
    mode: "live",
    label: "Live Hunter data",
    message: "These opportunities came from Hunter for this Brand.",
    usesSampleData: false,
    isLive: true,
  };

  const score = typeof input.readinessScore === "number" ? ` Brand readiness is ${Math.round(input.readinessScore)}%.` : "";
  if (input.latestRunStatus === "running") return {
    mode: "collecting",
    label: "Hunter is running · Sample preview",
    message: `Kairo is collecting real opportunities now.${score} Sample cards remain visible until strong real results arrive.`,
    usesSampleData: true,
    isLive: false,
  };
  if (input.latestRunStatus === "failed") return {
    mode: "unavailable",
    label: "Hunter unavailable · Sample preview",
    message: `The latest Hunter run did not complete.${score} Sample cards remain visible and are never treated as Brand evidence.`,
    usesSampleData: true,
    isLive: false,
  };
  if (input.hunterReady === false) return {
    mode: "preview",
    label: "Brand not ready · Sample preview",
    message: `Complete the missing Brand context before Hunter runs.${score} These cards are examples only.`,
    usesSampleData: true,
    isLive: false,
  };
  if (input.hunterReady === true) return {
    mode: "preview",
    label: "Hunter ready · Sample preview",
    message: `This Brand is ready for Hunter.${score} Run Discovery to replace these examples with real opportunities.`,
    usesSampleData: true,
    isLive: false,
  };
  return {
    mode: "preview",
    label: "Sample preview",
    message: `Kairo is checking Brand readiness.${score} Example opportunities remain clearly separated from Brand evidence.`,
    usesSampleData: true,
    isLive: false,
  };
}

export function resolveInsightsDataMode(input: {
  authenticated: boolean;
  brandId?: string;
  hasLiveMetrics: boolean;
  statuses?: InsightCollectionStatus[];
}): DataModeState {
  if (!input.authenticated) return {
    mode: "preview",
    label: "Insights preview · Sample data",
    message: "This sample dashboard shows what Kairo can surface after publishing and performance collection begin.",
    usesSampleData: true,
    isLive: false,
  };
  if (!input.brandId) return {
    mode: "empty",
    label: "Choose a Brand",
    message: "Select a Brand to inspect performance readiness and future live metrics.",
    usesSampleData: false,
    isLive: false,
  };
  if (input.hasLiveMetrics) return {
    mode: "live",
    label: "Live Brand data",
    message: "Metrics shown here are backed by collected Brand performance data.",
    usesSampleData: false,
    isLive: true,
  };

  const statuses = input.statuses ?? [];
  if (statuses.some((item) => item.permission === "required")) return {
    mode: "unavailable",
    label: "Insights unavailable · Sample data",
    message: "Instagram needs to be reconnected before Kairo can collect live performance. Sample values remain clearly labelled.",
    usesSampleData: true,
    isLive: false,
  };
  if (statuses.some((item) => item.status === "running" || item.status === "queued" || item.freshness === "due")) return {
    mode: "collecting",
    label: "Collecting live metrics · Sample data",
    message: "Real performance collection is in progress. Sample values stay visible until enough normalized evidence is available.",
    usesSampleData: true,
    isLive: false,
  };
  if (statuses.some((item) => item.status === "complete")) return {
    mode: "preview",
    label: "Metrics collected · Sample dashboard",
    message: "Kairo has collected provider metrics, but the evidence gate is not complete yet. The dashboard stays explicitly sample until enough normalized metrics are available.",
    usesSampleData: true,
    isLive: false,
  };
  return {
    mode: "preview",
    label: "Insights preview · Sample data",
    message: "Publish content and connect a supported channel to replace this sample dashboard with live performance data.",
    usesSampleData: true,
    isLive: false,
  };
}
