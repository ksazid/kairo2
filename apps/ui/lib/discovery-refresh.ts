import type { BrandBrainRuntimeData } from "./brand-brain-runtime";
import type { HomeOpportunity, ManualHunterRun } from "./api";

export type DiscoveryRefreshResponse = {
  run: ManualHunterRun;
  opportunities: HomeOpportunity[];
  activation: BrandBrainRuntimeData;
};

export async function refreshDiscovery(brandId: string, fetchImpl: typeof fetch = fetch): Promise<DiscoveryRefreshResponse> {
  const response = await fetchImpl("/api/discover/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brandId }),
  });
  const body = await response.json() as DiscoveryRefreshResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Kairo could not refresh discovery.");
  return body;
}

export function discoveryRefreshNotice(run: ManualHunterRun): string {
  if (run.opportunityCount > 0) return `Discovery complete. ${run.opportunityCount} ${run.opportunityCount === 1 ? "opportunity" : "opportunities"} saved.`;
  if (run.degradedSources?.length) return `Discovery completed with no strong new opportunities. ${run.degradedSources.length} ${run.degradedSources.length === 1 ? "source was" : "sources were"} unavailable.`;
  return "Discovery completed with no strong new opportunities.";
}
