import { notFound } from "next/navigation";
import { getContentData } from "../../../lib/api";
import { campaignFallback, toCampaignItems } from "../../../lib/campaigns";
import { requirePageAuthentication } from "../../../lib/page-auth";
import { KairoShell } from "../../kairo-shell";
import { CampaignPreviewClient } from "./campaign-preview-client";

type Params = Promise<{ campaignId: string }>;
type SearchParams = Promise<{ brand?: string }>;

export default async function CampaignPreviewPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ campaignId }, query] = await Promise.all([params, searchParams]);
  const data = requirePageAuthentication(await getContentData(query.brand), `/campaigns/${encodeURIComponent(campaignId)}`);
  const projected = toCampaignItems(data.details, data.reviews, data.commands);
  const campaigns = projected.length ? projected : campaignFallback();
  const campaign = campaigns.find((candidate) => candidate.id === campaignId);
  if (!campaign) notFound();
  const campaignsHref = data.brandId ? `/campaigns?brand=${encodeURIComponent(data.brandId)}` : "/campaigns";

  return <KairoShell
    active="Campaigns"
    authenticated={data.authenticated}
    brandId={data.brandId}
    brandName={data.brandName}
    workspaceClassName="campaign-preview-workspace"
    proTip="Great campaigns start with a clear objective and consistent message across channels."
    proTipAction="Learn more"
    proTipHref="#campaign-overview"
  >
    <CampaignPreviewClient campaign={campaign} brandId={data.brandId} authenticated={data.authenticated} campaignsHref={campaignsHref}/>
  </KairoShell>;
}
