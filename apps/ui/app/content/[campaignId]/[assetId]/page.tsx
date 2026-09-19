import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Facebook, Grid2X2, Instagram, Linkedin, PlaySquare } from "lucide-react";
import { getContentData } from "../../../../lib/api";
import { contentFallback, toContentItems } from "../../../../lib/content";
import { campaignFallback } from "../../../../lib/campaigns";
import { requirePageAuthentication } from "../../../../lib/page-auth";
import { KairoShell } from "../../../kairo-shell";
import { ContentPreviewClient } from "./content-preview-client";

type Params = Promise<{ campaignId: string; assetId: string }>;
type SearchParams = Promise<{ brand?: string }>;

export default async function ContentPreviewPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ campaignId, assetId }, query] = await Promise.all([params, searchParams]);
  const data = requirePageAuthentication(await getContentData(query.brand), `/content/${encodeURIComponent(campaignId)}/${encodeURIComponent(assetId)}`);
  const projected = toContentItems(data.details, data.reviews, data.commands);
  const items = projected.length ? projected : [...contentFallback(), ...campaignFallback().flatMap((campaign) => campaign.assets)];
  const item = items.find((candidate) => candidate.id === assetId && candidate.campaignId === campaignId);
  if (!item) notFound();
  const review = data.reviews[item.id]?.review;
  const approval = data.reviews[item.id]?.approval;
  const currentVersionId = data.details.flatMap((detail) => detail.assets).find((entry) => entry.asset.id === item.id)?.versions.at(-1)?.id;
  const eligibleAccounts = data.channelAccounts.filter((account) => account.channel === item.rawChannel && account.status === "connected");
  const approvedAccount = approval?.destination ? eligibleAccounts.find((account) => account.channel === approval.destination!.channel && account.accountRef === approval.destination!.accountRef) : undefined;
  const contentHref = data.brandId ? `/content?brand=${encodeURIComponent(data.brandId)}` : "/content";
  const ChannelIcon = item.channel === "Facebook" ? Facebook : item.channel === "LinkedIn" ? Linkedin : Instagram;
  const FormatIcon = item.format === "carousel" ? Grid2X2 : item.format === "reel" ? PlaySquare : undefined;

  return <KairoShell active="Content" authenticated={data.authenticated} brandId={data.brandId} brandName={data.brandName} workspaceClassName="content-preview-workspace" proTip="Review the visual, caption and destination before approving content." proTipAction="Back to Content" proTipHref={contentHref}>
    <Link className="content-preview-back" href={contentHref}><ArrowLeft aria-hidden="true"/>Back to Content</Link>
    <header className="content-preview-header">
      <div><h1>{item.title}</h1><p>{item.summary}</p><div className="content-preview-meta"><span><ChannelIcon aria-hidden="true"/>{item.channel}</span><span>{FormatIcon ? <FormatIcon aria-hidden="true"/> : null}{item.formatLabel}</span><span className={`content-status status-${item.status}`}><i/>{item.statusLabel}</span><small>Last updated {formatDate(item.updatedAt)} by Kairo</small></div></div>
      {data.authenticated ? <a href="#caption-editor">Edit in preview</a> : <Link href="/">Create content</Link>}
    </header>
    <ContentPreviewClient item={item} authenticated={data.authenticated} actionContext={data.brandId ? { brandId: data.brandId, reviewStatus: review && review.versionId === currentVersionId ? review.status : null, approved: Boolean(approval && approval.versionId === currentVersionId), eligibleAccounts, ...(approvedAccount ? { approvedAccountId: approvedAccount.id } : {}) } : undefined}/>
  </KairoShell>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
