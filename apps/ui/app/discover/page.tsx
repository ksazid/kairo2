import { getHomeData } from "../../lib/api";
import { getBrandBrainActivation } from "../../lib/brand-brain-api";
import { resolveDiscoveryDataMode } from "../../lib/data-mode";
import { discoverPreviewFallback, toDiscoverCards } from "../../lib/discover";
import { getLatestHunterRun } from "../../lib/hunter-run-status";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { DiscoverClient } from "./discover-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getHomeData(params.brand), "/discover");
  const [latestRun, activation] = await Promise.all([
    data.authenticated ? getLatestHunterRun(data.brandId) : undefined,
    data.authenticated && data.brandId ? getBrandBrainActivation(data.brandId).catch(() => undefined) : undefined,
  ]);
  const dataState = resolveDiscoveryDataMode({
    authenticated: data.authenticated,
    brandId: data.brandId,
    realItemCount: data.opportunities.length,
    hunterReady: activation?.hunterReady,
    readinessScore: activation?.readiness.brandIntelligenceScore,
    latestRunStatus: latestRun?.status,
  });
  const opportunities = dataState.usesSampleData ? discoverPreviewFallback() : data.opportunities;
  const cards = toDiscoverCards(opportunities);

  return <KairoShell active="Discover" authenticated={data.authenticated} brandId={data.brandId} brandName={data.brandName} workspaceClassName="discover-workspace">
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <DiscoverClient
      initialCards={cards}
      brandId={data.brandId}
      authenticated={data.authenticated}
      latestRun={latestRun}
      initialDataState={dataState}
      hunterReady={activation?.hunterReady}
      readinessScore={activation?.readiness.brandIntelligenceScore}
    />
  </KairoShell>;
}
