import { getHomeData } from "../../lib/api";
import { discoverFallback, toDiscoverCards } from "../../lib/discover";
import { getLatestHunterRun } from "../../lib/hunter-run-status";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { DiscoverClient } from "./discover-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getHomeData(params.brand), "/discover");
  const latestRun = data.authenticated ? await getLatestHunterRun(data.brandId) : undefined;
  const opportunities = data.authenticated ? data.opportunities : (data.opportunities.length ? data.opportunities : discoverFallback);
  const cards = toDiscoverCards(opportunities);

  return <KairoShell active="Discover" authenticated={data.authenticated} brandId={data.brandId} brandName={data.brandName} workspaceClassName="discover-workspace">
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <DiscoverClient initialCards={cards} brandId={data.brandId} authenticated={data.authenticated} latestRun={latestRun}/>
  </KairoShell>;
}
