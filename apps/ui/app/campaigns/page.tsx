import { getContentData } from "../../lib/api";
import { campaignFallback, toCampaignItems } from "../../lib/campaigns";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { CampaignsClient } from "./campaigns-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getContentData(params.brand), "/campaigns");
  const projected = toCampaignItems(data.details, data.reviews, data.commands);
  const campaigns = projected.length ? projected : campaignFallback();

  return <KairoShell
    active="Campaigns"
    authenticated={data.authenticated}
    brandId={data.brandId}
    brandName={data.brandName}
    workspaceClassName="campaigns-workspace"
    proTip="Use filters to quickly find campaigns by status, objective, or date."
    proTipAction="Learn more"
    proTipHref="#campaign-list"
  >
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <CampaignsClient initialCampaigns={campaigns} brandId={data.brandId}/>
  </KairoShell>;
}
