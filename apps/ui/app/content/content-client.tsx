"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Facebook,
  FileImage,
  Grid2X2,
  Instagram,
  Linkedin,
  MoreHorizontal,
  Play,
  PlaySquare,
  Plus,
  Search,
} from "lucide-react";
import { contentPreviewHref, filterContent, type ContentFormat, type ContentItem, type ContentStatus } from "../../lib/content";
import { DEFAULT_LISTING_VIEW, normalizeListingView, type ListingView } from "../../lib/listing-view";
import { ListingViewToggle } from "../listing-view-toggle";

const listingPreferenceKey = "kairo:list-view";
const statuses: Array<{ value: "all" | ContentStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "in-review", label: "In review" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
];
const formats: Array<{ value: "all" | ContentFormat; label: string; Icon: typeof Grid2X2 }> = [
  { value: "all", label: "All formats", Icon: Grid2X2 },
  { value: "image", label: "Post", Icon: FileImage },
  { value: "reel", label: "Reel", Icon: PlaySquare },
  { value: "carousel", label: "Carousel", Icon: Grid2X2 },
];

export function ContentClient({ initialItems, brandId }: { initialItems: ContentItem[]; brandId?: string }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ContentStatus>("all");
  const [format, setFormat] = useState<"all" | ContentFormat>("all");
  const [view, setView] = useState<ListingView>(DEFAULT_LISTING_VIEW);
  const visible = useMemo(() => filterContent(initialItems, { query, status, format }), [format, initialItems, query, status]);

  useEffect(() => setView(normalizeListingView(window.localStorage.getItem(listingPreferenceKey))), []);

  function chooseView(next: ListingView) {
    setView(next);
    window.localStorage.setItem(listingPreferenceKey, next);
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setFormat("all");
  }

  return <>
    <header className="content-page-header">
      <div><h1>Content</h1><p>Manage every generated asset in one place.</p></div>
      <div className="content-header-actions">
        <ListingViewToggle value={view} onChange={chooseView}/>
        <Link href={brandId ? `/?brand=${encodeURIComponent(brandId)}` : "/"}><Plus aria-hidden="true"/>Create content</Link>
      </div>
    </header>

    <section className="content-toolbar" aria-label="Content filters">
      <label className="content-search"><Search aria-hidden="true"/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search content by title or campaign" aria-label="Search Content"/></label>
      <div className="content-status-tabs" role="group" aria-label="Content status">{statuses.map((item) => <button key={item.value} type="button" aria-pressed={status === item.value} onClick={() => setStatus(item.value)}>{item.label}</button>)}</div>
      <div className="content-format-tabs" role="group" aria-label="Content format">{formats.map(({ value, label, Icon }) => <button key={value} type="button" aria-pressed={format === value} onClick={() => setFormat(value)}><Icon aria-hidden="true"/>{label}</button>)}</div>
    </section>

    <section id="content-list" aria-label="Content items">
      {visible.length ? view === "table" ? <ContentTable items={visible} brandId={brandId}/> : <ContentGrid items={visible} brandId={brandId}/> : <div className="content-empty"><Search aria-hidden="true"/><h2>No content matches these filters</h2><p>Clear a filter or try a broader search.</p><button type="button" onClick={clearFilters}>Clear filters</button></div>}
    </section>

    <footer className="content-pagination"><span>Showing 1–{visible.length} of {visible.length} content items</span><nav aria-label="Content pages"><button type="button" disabled aria-label="Previous page"><ChevronLeft aria-hidden="true"/></button><button className="active" type="button" aria-current="page">1</button><button type="button" disabled aria-label="Next page"><ChevronRight aria-hidden="true"/></button></nav></footer>
  </>;
}

function ContentTable({ items, brandId }: { items: ContentItem[]; brandId?: string }) {
  return <div className="content-table" role="table" aria-label="Content library" data-testid="content-table-view">
    <div className="content-table-head" role="row"><span role="columnheader">Content</span><span role="columnheader">Campaign</span><span role="columnheader">Last updated</span><span role="columnheader">Actions</span></div>
    <div role="rowgroup">{items.map((item) => <article className="content-table-row" role="row" key={item.id}>
      <ContentIdentity item={item} role="cell"/>
      <div className="content-campaign-cell" role="cell"><strong>{item.campaignName}</strong><span className={`content-status status-${item.status}`}><i/>{item.statusLabel}</span></div>
      <div className="content-updated-cell" role="cell"><time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time><span>{formatTime(item.updatedAt)}</span></div>
      <ContentActions item={item} brandId={brandId} role="cell"/>
    </article>)}</div>
  </div>;
}

function ContentGrid({ items, brandId }: { items: ContentItem[]; brandId?: string }) {
  return <div className="content-grid" data-testid="content-grid-view">{items.map((item) => <article className="content-grid-card" key={item.id}>
    <Link className="content-grid-media" href={contentPreviewHref(item, brandId)}><img src={item.image} alt={item.title}/><MediaMarker item={item}/></Link>
    <div className="content-grid-body"><span className={`content-status status-${item.status}`}><i/>{item.statusLabel}</span><h2><Link href={contentPreviewHref(item, brandId)}>{item.title}</Link></h2><p>{item.campaignName}</p><div className="content-grid-meta"><FormatBadge item={item}/><ChannelBadge item={item}/><time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time></div><ContentActions item={item} brandId={brandId}/></div>
  </article>)}</div>;
}

function ContentIdentity({ item, role }: { item: ContentItem; role?: "cell" }) {
  return <div className="content-identity" role={role}><div className="content-thumb"><img src={item.image} alt=""/><MediaMarker item={item}/></div><div><strong>{item.title}</strong><span><FormatBadge item={item}/><ChannelBadge item={item}/></span></div></div>;
}

function MediaMarker({ item }: { item: ContentItem }) {
  if (item.format === "reel") return <span className="media-marker reel"><Play aria-hidden="true"/>{item.duration ?? "0:28"}</span>;
  if (item.format === "carousel") return <span className="media-marker"><Grid2X2 aria-hidden="true"/>{item.cardCount ?? item.media.length}</span>;
  return <span className="media-marker"><FileImage aria-hidden="true"/></span>;
}

function FormatBadge({ item }: { item: ContentItem }) {
  const Icon = item.format === "image" ? FileImage : item.format === "reel" ? PlaySquare : Grid2X2;
  return <span className="content-format-badge"><Icon aria-hidden="true"/>{item.formatLabel}</span>;
}

function ChannelBadge({ item }: { item: ContentItem }) {
  const Icon = item.channel === "Facebook" ? Facebook : item.channel === "LinkedIn" ? Linkedin : Instagram;
  return <span className={`content-channel-badge channel-${item.channel.toLowerCase()}`}><Icon aria-hidden="true"/>{item.channel}</span>;
}

function ContentActions({ item, brandId, role }: { item: ContentItem; brandId?: string; role?: "cell" }) {
  return <div className="content-actions" role={role}><Link href={contentPreviewHref(item, brandId)}><Eye aria-hidden="true"/>Open preview</Link><button type="button" aria-label={`More actions for ${item.title}`} title="More actions"><MoreHorizontal aria-hidden="true"/></button></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}
