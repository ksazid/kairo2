"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileImage,
  Grid2X2,
  Instagram,
  Linkedin,
  MoreHorizontal,
  PlaySquare,
  Plus,
  Search,
} from "lucide-react";
import { campaignHref, filterCampaigns, type CampaignItem, type CampaignStatus } from "../../lib/campaigns";
import { DEFAULT_LISTING_VIEW, normalizeListingView, type ListingView } from "../../lib/listing-view";
import { ListingViewToggle } from "../listing-view-toggle";

const preferenceKey = "kairo:campaign-view";
const statuses: Array<{ value: "all" | CampaignStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "in-progress", label: "In progress" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
];

export function CampaignsClient({ initialCampaigns, brandId }: { initialCampaigns: CampaignItem[]; brandId?: string }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CampaignStatus>("all");
  const [view, setView] = useState<ListingView>(DEFAULT_LISTING_VIEW);
  const visible = useMemo(() => filterCampaigns(initialCampaigns, { query, status }), [initialCampaigns, query, status]);

  useEffect(() => setView(normalizeListingView(window.localStorage.getItem(preferenceKey))), []);

  function chooseView(next: ListingView) {
    setView(next);
    window.localStorage.setItem(preferenceKey, next);
  }

  return <>
    <header className="campaigns-page-header">
      <div><h1>Campaigns</h1><p>Coordinate content around one clear goal.</p></div>
      <div className="campaigns-header-actions"><ListingViewToggle value={view} onChange={chooseView}/><Link href={brandId ? `/?brand=${encodeURIComponent(brandId)}&format=campaign` : "/?format=campaign"}><Plus aria-hidden="true"/>Create campaign</Link></div>
    </header>

    <section className="campaigns-toolbar" aria-label="Campaign filters">
      <label className="campaigns-search"><Search aria-hidden="true"/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search campaigns by name or objective" aria-label="Search campaigns"/></label>
      <div className="campaigns-status-tabs" role="group" aria-label="Campaign status">{statuses.map((item) => <button type="button" key={item.value} aria-pressed={status === item.value} onClick={() => setStatus(item.value)}>{item.label}</button>)}</div>
      <button className="campaigns-date-filter" type="button"><CalendarDays aria-hidden="true"/>All dates<ChevronDown aria-hidden="true"/></button>
    </section>

    <section id="campaign-list" aria-label="Campaigns">
      {visible.length ? view === "table" ? <CampaignTable items={visible} brandId={brandId}/> : <CampaignGrid items={visible} brandId={brandId}/> : <div className="content-empty"><Search aria-hidden="true"/><h2>No campaigns match these filters</h2><p>Clear the search or choose another status.</p><button type="button" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</button></div>}
    </section>

    <footer className="content-pagination"><span>Showing 1–{visible.length} of {visible.length} campaigns</span><nav aria-label="Campaign pages"><button type="button" disabled aria-label="Previous page"><ChevronLeft/></button><button className="active" type="button" aria-current="page">1</button><button type="button" disabled aria-label="Next page"><ChevronRight/></button></nav></footer>
  </>;
}

function CampaignTable({ items, brandId }: { items: CampaignItem[]; brandId?: string }) {
  return <div className="campaign-table" role="table" aria-label="Campaign library" data-testid="campaign-table-view">
    <div className="campaign-table-head" role="row"><span role="columnheader">Campaign</span><span role="columnheader">Objective</span><span role="columnheader">Progress</span><span role="columnheader">Date range</span><span role="columnheader">Status</span><span role="columnheader">Actions</span></div>
    <div role="rowgroup">{items.map((item) => <article className="campaign-table-row" role="row" key={item.id}>
      <CampaignIdentity item={item} role="cell"/>
      <p className="campaign-objective" role="cell">{item.objective}</p>
      <CampaignProgress item={item} role="cell"/>
      <div className="campaign-dates" role="cell"><time dateTime={item.startsAt}>{datePart(item.startsAt)}</time><span>–</span><time dateTime={item.endsAt}>{datePart(item.endsAt, true)}</time></div>
      <span className={`campaign-status campaign-status-${item.status}`} role="cell"><i/>{item.statusLabel}</span>
      <CampaignActions item={item} brandId={brandId} role="cell"/>
    </article>)}</div>
  </div>;
}

function CampaignGrid({ items, brandId }: { items: CampaignItem[]; brandId?: string }) {
  return <div className="campaign-grid" data-testid="campaign-grid-view">{items.map((item) => <article className="campaign-card" key={item.id}>
    <Link className="campaign-card-media" href={campaignHref(item.id, brandId)}><img src={item.image} alt={item.name}/><span className={`campaign-status campaign-status-${item.status}`}><i/>{item.statusLabel}</span></Link>
    <div className="campaign-card-body"><div><h2><Link href={campaignHref(item.id, brandId)}>{item.name}</Link></h2><p>{item.objective}</p></div><CampaignProgress item={item}/><CampaignBadges item={item}/><div className="campaign-card-dates"><CalendarDays/>{datePart(item.startsAt)} – {datePart(item.endsAt, true)}</div><CampaignActions item={item} brandId={brandId}/></div>
  </article>)}</div>;
}

function CampaignIdentity({ item, role }: { item: CampaignItem; role?: "cell" }) {
  return <div className="campaign-identity" role={role}><img src={item.image} alt=""/><div><strong>{item.name}</strong><CampaignBadges item={item}/></div></div>;
}

function CampaignBadges({ item }: { item: CampaignItem }) {
  return <div className="campaign-badges"><span><FileImage/>Post</span><span><PlaySquare/>Reel</span><span><Grid2X2/>Carousel</span><span className="campaign-channel"><Instagram/>Instagram</span><span className="campaign-channel linkedin"><Linkedin/>LinkedIn</span></div>;
}

function CampaignProgress({ item, role }: { item: CampaignItem; role?: "cell" }) {
  const percentage = Math.min(100, Math.round((item.readyAssets / Math.max(1, item.totalAssets)) * 100));
  return <div className="campaign-progress" role={role}><span style={{ "--campaign-progress": `${percentage}%` } as React.CSSProperties}><b>{item.readyAssets}/{item.totalAssets}</b></span><small>{item.readyAssets} of {item.totalAssets} assets ready</small></div>;
}

function CampaignActions({ item, brandId, role }: { item: CampaignItem; brandId?: string; role?: "cell" }) {
  return <div className="campaign-actions" role={role}><Link href={campaignHref(item.id, brandId)}><Eye/>Open campaign</Link><button type="button" aria-label={`More actions for ${item.name}`}><MoreHorizontal/></button></div>;
}

function datePart(value: string, includeYear = false) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", ...(includeYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(value));
}
