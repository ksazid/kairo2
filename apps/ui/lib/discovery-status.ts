export type HunterRunStatus = {
  runId: string;
  trigger: "manual" | "scheduled";
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt?: string;
  evidenceCount: number;
  candidateCount: number;
  opportunityCount: number;
  sourcesScanned?: string[];
  degradedSources?: string[];
  failureCode?: string;
  failureMessage?: string;
};

export type HunterRefreshRun = {
  evidenceCount: number;
  candidateCount: number;
  opportunityCount: number;
  degradedSources?: string[];
};

export function discoveryEmptyState(input: {
  authenticated: boolean;
  brandId?: string;
  latestRun?: HunterRunStatus | null;
}) {
  if (!input.authenticated) return {
    title: "No preview ideas match",
    message: "Clear a filter or try a broader search.",
  };
  if (!input.brandId) return {
    title: "Choose a Brand",
    message: "Select a Brand before running discovery.",
  };
  if (!input.latestRun) return {
    title: "Ready to discover",
    message: "This Brand is eligible for Hunter, but no discovery run has completed yet. Run Refresh discovery to find real opportunities.",
  };
  if (input.latestRun.status === "running") return {
    title: "Discovery is running",
    message: "Hunter is scanning the Brand's approved sources. Refresh this page shortly to see the results.",
  };
  if (input.latestRun.status === "failed") return {
    title: "Last discovery run failed",
    message: "The Brand can still be discovery-ready even when the latest Hunter run fails. Run Refresh discovery to try again.",
  };
  if (input.latestRun.opportunityCount === 0) return {
    title: "No new discoveries found",
    message: "The latest Hunter run completed successfully, but it did not find a strong new opportunity. Kairo will not fill Discover with demo or weak matches.",
  };
  return {
    title: "No active discoveries",
    message: "Hunter found opportunities in the latest run, but none are currently available in this view. Run Refresh discovery to look for new ones.",
  };
}

export function discoveryRefreshMessage(run: HunterRefreshRun) {
  if (run.opportunityCount > 0) {
    return `Hunter found ${run.opportunityCount} new ${run.opportunityCount === 1 ? "opportunity" : "opportunities"}.`;
  }
  if (run.degradedSources?.length) {
    const sources = run.degradedSources.map((source) => source.replaceAll("-", " ")).join(", ");
    return `Hunter completed with no strong new opportunities. ${run.degradedSources.length} ${run.degradedSources.length === 1 ? "source was" : "sources were"} unavailable: ${sources}.`;
  }
  return "Hunter completed successfully with no strong new opportunities.";
}

