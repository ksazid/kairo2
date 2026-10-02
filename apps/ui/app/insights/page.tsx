import { getContentData } from "../../lib/api";
import { contentFallback, toContentItems } from "../../lib/content";
import { resolveInsightsDataMode } from "../../lib/data-mode";
import { getInstagramInsightCollectionStatus } from "../../lib/insights-status";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { InsightsClient } from "./insights-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getContentData(params.brand), "/insights");
  const projected = toContentItems(data.details, data.reviews, data.commands);
  const statuses = data.authenticated ? await getInstagramInsightCollectionStatus(data.brandId) : undefined;

  // INS-01 keeps the preview truthful. INS-02 will supply aggregated normalized metrics
  // and flip this flag only when the values rendered by Insights are actually live.
  const hasLiveMetrics = false;
  const dataState = resolveInsightsDataMode({
    authenticated: data.authenticated,
    brandId: data.brandId,
    hasLiveMetrics,
    statuses,
  });
  const items = dataState.usesSampleData ? contentFallback() : projected;

  return <KairoShell
    active="Insights"
    authenticated={data.authenticated}
    brandId={data.brandId}
    brandName={data.brandName}
    workspaceClassName="insights-workspace"
    proTip={dataState.isLive ? "Compare channels and repeat the content patterns that produce meaningful results." : "This dashboard is a sample until real performance metrics are available."}
    proTipAction="Review top content"
    proTipHref="#insights-top-content"
  >
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <InsightsClient items={items} brandId={data.brandId} authenticated={data.authenticated} dataState={dataState}/>
  </KairoShell>;
}
