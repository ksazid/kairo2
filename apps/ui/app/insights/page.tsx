import { getContentData } from "../../lib/api";
import { contentFallback, toContentItems } from "../../lib/content";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { InsightsClient } from "./insights-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getContentData(params.brand), "/insights");
  const projected = toContentItems(data.details, data.reviews, data.commands);

  return <KairoShell
    active="Insights"
    authenticated={data.authenticated}
    brandId={data.brandId}
    brandName={data.brandName}
    workspaceClassName="insights-workspace"
    proTip="Compare channels and repeat the content patterns that produce meaningful results."
    proTipAction="Review top content"
    proTipHref="#insights-top-content"
  >
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <InsightsClient items={projected.length ? projected : contentFallback()} brandId={data.brandId} authenticated={data.authenticated}/>
  </KairoShell>;
}
