"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Crosshair,
  FileCheck2,
  Grid2X2,
  Instagram,
  Linkedin,
  Megaphone,
  MessageSquareText,
  MousePointer2,
  Play,
  PlaySquare,
  Plus,
  Rocket,
  Save,
  Sparkles,
  Users,
} from "lucide-react";
import type { CampaignItem } from "../../../lib/campaigns";
import { contentPreviewHref, type ContentItem } from "../../../lib/content";

type CampaignPhase = "draft" | "scheduled" | "published";

export function CampaignPreviewClient({ campaign, brandId, authenticated, campaignsHref }: { campaign: CampaignItem; brandId?: string; authenticated: boolean; campaignsHref: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [channel, setChannel] = useState<"Instagram" | "LinkedIn">("Instagram");
  const [phase, setPhase] = useState<CampaignPhase>(campaign.status === "published" ? "published" : campaign.status === "scheduled" ? "scheduled" : "draft");
  const [recommendations, setRecommendations] = useState(false);
  const [notice, setNotice] = useState("");
  const visibleAssets = campaign.assets.slice(0, 3);

  function openCampaignContent(action: "continue" | "schedule" | "publish") {
    const asset = campaign.assets[0];
    if (!asset) {
      setNotice("Add content before continuing this campaign.");
      return;
    }
    if (!authenticated) {
      setNotice("Choose an asset to continue in the v2 content workspace.");
      return;
    }
    router.push(contentPreviewHref(asset, brandId));
    if (action !== "continue") setNotice(`${action === "schedule" ? "Scheduling" : "Publishing"} is available after this asset passes review and is approved.`);
  }

  function schedule() {
    openCampaignContent("schedule");
  }

  function publish() {
    openCampaignContent("publish");
  }

  return <>
    <Link className="campaign-preview-back" href={campaignsHref}><ArrowLeft aria-hidden="true"/>Back to Campaigns</Link>
    <header className="campaign-preview-header">
      <div><span className={`campaign-preview-state state-${phase}`}>{phase === "draft" ? "DRAFT" : phase.toUpperCase()}</span><h1>{campaign.name}</h1><p><Crosshair aria-hidden="true"/>{campaign.previewObjective}</p><div><span><CalendarDays aria-hidden="true"/>{formatDate(campaign.startsAt)} – {formatDate(campaign.previewEndsAt)}</span><i>•</i><span className="campaign-preview-readiness"><b style={{ "--campaign-progress": `${Math.round((campaign.readyAssets / campaign.totalAssets) * 100)}%` } as React.CSSProperties}/>{campaign.readyAssets} of {campaign.totalAssets} assets ready</span></div></div>
      <aside><button className="campaign-continue" type="button" onClick={() => openCampaignContent("continue")}><Rocket/>Continue campaign</button><button type="button" aria-pressed={saved} onClick={() => setSaved((value) => !value)}>{saved ? <Save/> : <Bookmark/>}{saved ? "Saved" : "Save"}</button></aside>
    </header>

    {notice ? <p className="campaign-notice" role="status">{notice}</p> : null}

    <div className="campaign-preview-top">
      <section className="campaign-overview" id="campaign-overview">
        <header><h2>Campaign overview</h2><CircleHelp aria-label="Campaign overview information"/></header>
        <dl>
          <OverviewRow Icon={Crosshair} label="Objective" value={campaign.previewObjective}/>
          <OverviewRow Icon={Users} label="Audience" value={campaign.audience}/>
          <OverviewRow Icon={MessageSquareText} label="Shared message" value={campaign.message}/>
          <OverviewRow Icon={MousePointer2} label="Call to action" value={campaign.cta}/>
        </dl>
        <div className="campaign-quality"><header><h3>Campaign quality</h3><CircleHelp aria-label="Campaign quality information"/></header><div><span className="campaign-quality-score"><b>86</b><small>High</small></span><div><p>Great start! You’re on track for a high-performing campaign.</p><ul><li><Check/>Clear objective</li><li><Check/>Audience defined</li><li><Check/>Message aligned</li><li><Check/>At least 2 assets ready</li></ul></div><button type="button" onClick={() => setRecommendations((value) => !value)}>View recommendations</button></div>{recommendations ? <p className="campaign-recommendation"><Sparkles/>Add one channel-specific CTA and complete the final asset before publishing.</p> : null}</div>
      </section>

      <section className="campaign-content-set">
        <header><div><h2>Content set</h2><p>Coordinated assets for this campaign</p></div><span>{visibleAssets.length} assets</span></header>
        <div>{visibleAssets.map((asset) => <CampaignAsset key={asset.id} item={asset} brandId={brandId}/>)}</div>
        <Link className="campaign-add-asset" href={brandId ? `/?brand=${encodeURIComponent(brandId)}` : "/"}><Plus/>Add asset</Link>
      </section>
    </div>

    <section className="campaign-schedule">
      <header><nav aria-label="Campaign channel"><button type="button" aria-pressed={channel === "Instagram"} onClick={() => setChannel("Instagram")}><Instagram/>Instagram</button><button type="button" aria-pressed={channel === "LinkedIn"} onClick={() => setChannel("LinkedIn")}><Linkedin/>LinkedIn</button></nav><button type="button" onClick={() => setNotice(`${channel} schedule expanded.`)}><CalendarDays/>View full schedule</button></header>
      <div className="campaign-timeline">{visibleAssets.map((asset, index) => <div className="campaign-timeline-item" key={asset.id}><time>{timelineDate(index)}</time><Link href={contentPreviewHref(asset, brandId)}><FormatIcon item={asset}/><span><strong>{asset.title}</strong><small>{timelineTime(index)}</small></span></Link>{index < visibleAssets.length - 1 ? <i/> : null}</div>)}<div className="campaign-timeline-item add"><time>{timelineDate(3)}</time><Link href={brandId ? `/?brand=${encodeURIComponent(brandId)}` : "/"}><Plus/>Add content</Link></div></div>
    </section>

    <section className="campaign-publish-actions" aria-label="Campaign publishing actions">
      <button type="button" onClick={() => setNotice("All campaign assets are open for review.")}><FileCheck2/><span><strong>Review all</strong><small>Review assets and details</small></span></button>
      <button type="button" onClick={schedule}><CalendarDays/><span><strong>Schedule assets</strong><small>Review and schedule each approved asset</small></span></button>
      <button className="publish" type="button" onClick={publish}><Rocket/><span><strong>Publish assets</strong><small>Open each asset's publishing workflow</small></span></button>
    </section>
  </>;
}

function OverviewRow({ Icon, label, value }: { Icon: typeof Crosshair; label: string; value: string }) {
  return <div><dt><span><Icon aria-hidden="true"/></span>{label}</dt><dd>{value}</dd></div>;
}

function CampaignAsset({ item, brandId }: { item: ContentItem; brandId?: string }) {
  return <article><div className="campaign-asset-image"><img src={item.image} alt=""/>{item.format === "reel" ? <span><Play/></span> : null}</div><FormatIcon item={item}/><div><strong>{item.title}</strong><small>{item.formatLabel}</small><em className={`asset-state asset-${item.status}`}><i/>{item.status === "in-review" ? "Draft" : item.status === "draft" ? "Not started" : "Ready"}</em></div><Link href={contentPreviewHref(item, brandId)}>Open</Link><ChevronRight/></article>;
}

function FormatIcon({ item }: { item: ContentItem }) {
  const Icon = item.format === "carousel" ? Grid2X2 : item.format === "reel" ? PlaySquare : Instagram;
  return <span className="campaign-format-icon"><Icon aria-hidden="true"/></span>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function timelineDate(index: number) {
  return ["May 20, Mon", "May 24, Fri", "May 28, Tue", "May 31, Fri"][index] ?? "May 31, Fri";
}

function timelineTime(index: number) {
  return ["10:00 AM", "12:00 PM", "9:00 AM"][index] ?? "10:00 AM";
}
