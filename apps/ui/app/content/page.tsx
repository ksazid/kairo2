import { getContentData } from "../../lib/api";
import { contentFallback, toContentItems } from "../../lib/content";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { ContentClient } from "./content-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function ContentPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getContentData(params.brand), "/content");
  const projected = toContentItems(data.details, data.reviews, data.commands);
  const items = projected.length ? projected : contentFallback();

  return <KairoShell
    active="Content"
    authenticated={data.authenticated}
    brandId={data.brandId}
    brandName={data.brandName}
    workspaceClassName="content-workspace"
    proTip="Use filters to quickly find content by status, format, or campaign."
    proTipAction="Learn more"
    proTipHref="#content-list"
  >
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <ContentClient initialItems={items} brandId={data.brandId}/>
  </KairoShell>;
}
