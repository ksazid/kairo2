import { getContentData } from "../../lib/api";
import { contentFallback, toContentItems } from "../../lib/content";
import { resolveInsightsDataMode } from "../../lib/data-mode";
import { hasSufficientLiveMetrics } from "../../lib/insights-live";
import { getInsightsMetricData, getInstagramInsightCollectionStatus } from "../../lib/insights-status";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { InsightsClient } from "./insights-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getContentData(params.brand), "/insights");
  const projected = toContentItems(data.details, data.reviews, data.commands);
  const [statuses, liveRows] = data.authenticated
    ? await Promise.all([
        getInstagramInsightCollectionStatus(data.brandId),
        getInsightsMetricData(data.brandId),
      ])
    : [undefined, []];

  const hasLiveMetrics = hasSufficientLiveMetrics(liveRows);
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
    proTip={dataState.isLive ? "Compare real channel and content evidence, then repeat patterns that hold up." : "This dashboard is a sample until enough real performance evidence is available."}
    proTipAction="Review top content"
    proTipHref="#insights-top-content"
  >
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <InsightsClient items={items} brandId={data.brandId} authenticated={data.authenticated} dataState={dataState} liveRows={liveRows}/>
  </KairoShell>;
}
