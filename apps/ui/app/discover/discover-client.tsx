"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  Eye,
  Facebook,
  FileImage,
  Instagram,
  LayoutGrid,
  Linkedin,
  Megaphone,
  PlaySquare,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  X,
  Youtube,
} from "lucide-react";
import { ConceptMockupPreview } from "../../components/concept-mockup";
import {
  compactOpportunityText,
  discoverPreviewHref,
  filterDiscoverCards,
  toDiscoverCards,
  type DiscoverCard,
  type DiscoverFilter,
} from "../../lib/discover";
import { discoveryEmptyState, discoveryRefreshMessage } from "../../lib/discovery-status";
import { DEFAULT_LISTING_VIEW, normalizeListingView, type ListingView } from "../../lib/listing-view";
import type { HomeOpportunity, ManualHunterRun } from "../../lib/api";
import type { HunterRunStatus } from "../../lib/hunter-run-status";
import { ListingViewToggle } from "../listing-view-toggle";

const filters: Array<{ value: DiscoverFilter; label: string }> = [
  { value: "all", label: "Recommended" },
  { value: "trending", label: "Trending" },
  { value: "saved", label: "Saved" },
  { value: "developing", label: "Developing" },
];

const listingPreferenceKey = "kairo:list-view";

export function DiscoverClient({
  initialCards,
  brandId,
  authenticated,
  latestRun,
}: {
  initialCards: DiscoverCard[];
  brandId?: string;
  authenticated: boolean;
  latestRun?: HunterRunStatus | null;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DiscoverFilter>("all");
  const [format, setFormat] = useState("all");
  const [channel, setChannel] = useState("all");
  const [source, setSource] = useState("all");
  const [view, setView] = useState<ListingView>(DEFAULT_LISTING_VIEW);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const visible = useMemo(() => filterDiscoverCards(cards, { query, filter, format, channel, source }), [cards, channel, filter, format, query, source]);
  const savedCount = cards.filter((card) => card.status === "saved").length;
  const developingCount = cards.filter((card) => card.status === "developing").length;
  const sources = useMemo(() => [...new Set(cards.map((card) => card.source))], [cards]);
  const emptyState = discoveryEmptyState({ authenticated, brandId, latestRun });

  useEffect(() => setView(normalizeListingView(window.localStorage.getItem(listingPreferenceKey))), []);

  function chooseView(next: ListingView) {
    setView(next);
    window.localStorage.setItem(listingPreferenceKey, next);
  }

  function resetDiscovery() {
    setCards(initialCards);
    setQuery("");
    setFilter("all");
    setFormat("all");
    setChannel("all");
    setSource("all");
    setError("");
    setRefreshMessage("");
  }

  async function refreshDiscovery() {
    if (!brandId || pending) return;
    setPending("refresh");
    setError("");
    setRefreshMessage("");
    try {
      const response = await fetch("/api/discover/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      const body = await response.json().catch(() => ({})) as { run?: ManualHunterRun; opportunities?: HomeOpportunity[]; error?: string };
      if (!response.ok || !body.opportunities) throw new Error(body.error ?? "Kairo could not refresh discovery.");
      setCards(toDiscoverCards(body.opportunities));
      setQuery("");
      setFilter("all");
      setFormat("all");
      setChannel("all");
      setSource("all");
      setRefreshMessage(body.run ? discoveryRefreshMessage(body.run) : "Discovery refreshed.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kairo could not refresh discovery.");
    } finally {
      setPending("");
    }
  }

  async function act(card: DiscoverCard, action: "save" | "ignore") {
    const key = `${card.id}:${action}`;
    if (pending) return;
    setPending(key);
    setError("");
    try {
      if (brandId) {
        const response = await fetch("/api/discover/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brandId, opportunityId: card.id, action }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Kairo could not update this idea.");
      }
      setCards((current) => action === "ignore" ? current.filter((item) => item.id !== card.id) : current.map((item) => item.id === card.id ? { ...item, status: "saved" } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kairo could not update this idea.");
    } finally {
      setPending("");
    }
  }

  return <>
    <header className="discover-page-header">
      <div><h1>Discover</h1><p>Find the next opportunity for your Brand.</p></div>
      <div className="discover-header-actions"><ListingViewToggle value={view} onChange={chooseView}/><button type="button" onClick={() => void refreshDiscovery()} disabled={!brandId || pending === "refresh"}><RefreshCw aria-hidden="true"/>{pending === "refresh" ? "Refreshing…" : "Refresh discovery"}</button></div>
    </header>

    <section className="discover-toolbar" aria-label="Discover filters">
      <label className="discover-search"><Search aria-hidden="true"/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search opportunities by topic or keyword…" aria-label="Search Discover"/></label>
      <div className="discover-filter-row">
        <div className="discover-pills">{filters.map((item) => {
          const count = item.value === "saved" ? savedCount : item.value === "developing" ? developingCount : 0;
          return <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}{count ? <span>{count}</span> : null}</button>;
        })}</div>
        <label>Format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="all">All formats</option><option value="image">Post</option><option value="reel">Reel</option><option value="carousel">Carousel</option><option value="campaign">Campaign</option></select></label>
        <label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">All channels</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select></label>
        <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((item) => <option key={item} value={item.toLowerCase().replaceAll(" ", "-")}>{item}</option>)}</select></label>
      </div>
    </section>

    <div className="discover-result-line"><p>Showing <strong>{visible.length}</strong> of {cards.length} opportunities</p><span>{view === "table" ? "Detailed view" : "Visual view"} · grounded in Hunter results and your Brand fit</span></div>
    {error ? <p className="discover-inline-error" role="alert">{error}</p> : null}
    {refreshMessage ? <p className="discover-inline-status" role="status">{refreshMessage}</p> : null}
    {latestRun ? <div className="discover-run-status" role="status" aria-label="Latest Hunter run status">
      <strong>Latest Hunter</strong>
      <span>{latestRun.status} · {latestRun.evidenceCount} evidence · {latestRun.candidateCount} candidates · {latestRun.opportunityCount} opportunities</span>
      <span>Sources: {latestRun.sourcesScanned?.length ? latestRun.sourcesScanned.map(sourceLabel).join(", ") : "no source telemetry recorded"}</span>
      {latestRun.degradedSources?.length ? <span>Unavailable: {latestRun.degradedSources.map(sourceLabel).join(", ")}</span> : null}
    </div> : null}

    {visible.length ? view === "table" ? <DiscoverTable cards={visible} brandId={brandId} pending={pending} onAct={act}/> : <DiscoverGrid cards={visible} brandId={brandId} pending={pending} onAct={act}/> : cards.length === 0 ? <section className="discover-empty" aria-live="polite"><RefreshCw aria-hidden="true"/><h2>{emptyState.title}</h2><p>{emptyState.message}</p>{brandId ? <button type="button" onClick={() => void refreshDiscovery()} disabled={pending === "refresh"}>{pending === "refresh" ? "Refreshing…" : "Refresh discovery"}</button> : null}</section> : <section className="discover-empty" aria-live="polite"><Search aria-hidden="true"/><h2>No ideas match these filters</h2><p>Clear a filter or try a broader search. Kairo will not fill Discover with weak matches.</p><button type="button" onClick={resetDiscovery}>Clear filters</button></section>}
  </>;
}

function DiscoverTable({ cards, brandId, pending, onAct }: ViewProps) {
  return <div className="discover-table-scroll" data-testid="discover-table-view"><div className="discover-table" role="table" aria-label="Discovery opportunities">
    <div className="discover-table-head" role="row"><span role="columnheader">Opportunity</span><span role="columnheader">Why it fits your Brand</span><span role="columnheader">Why it’s trending</span><span role="columnheader">Format</span><span role="columnheader">Source</span><span role="columnheader">BI confidence</span><span role="columnheader">Actions</span></div>
    <div role="rowgroup">{cards.map((card) => {
      const FormatIcon = formatIcon(card.format);
      const ChannelIcon = channelIcon(card.channel);
      const confidenceLabel = card.confidence >= 90 ? "Very high" : card.confidence >= 82 ? "High" : "Good";
      return <div className="discover-table-row" role="row" key={card.id}>
        <div className="discover-opportunity-cell" role="cell"><Link className={card.conceptMockup ? "discover-concept-thumb" : undefined} href={discoverPreviewHref(card.id, brandId)}>{card.conceptMockup ? <ConceptMockupPreview mockup={card.conceptMockup} mode="compact"/> : <Image src={card.image} alt={card.title} width={112} height={92}/>}</Link><span><strong><Link href={discoverPreviewHref(card.id, brandId)}>{card.title}</Link></strong><small>{compactOpportunityText(card.developmentDirection ?? card.rationale, "A timely Brand-fit direction ready for review.", 16)}</small></span></div>
        <div className="discover-reason-cell" role="cell"><p><ShieldCheck aria-hidden="true"/>{compactOpportunityText(card.rationale, "Strong Brand alignment", 22)}</p><small>Relevant to {card.details?.targetAudience ?? "your priority audience"}</small></div>
        <div className="discover-trend-cell" role="cell"><p><TrendingUp aria-hidden="true"/>{compactOpportunityText(card.whyNow, "Public interest is growing around this topic.", 22)}</p><small>Strong {card.formatLabel.toLowerCase()} engagement potential</small></div>
        <div className="discover-format-cell" role="cell"><span><ChannelIcon aria-hidden="true"/><FormatIcon aria-hidden="true"/>{card.formatLabel}</span><small>{card.channel}</small></div>
        <div className="discover-source-cell" role="cell">{card.source}</div>
        <div className="discover-confidence-cell" role="cell"><span className="confidence-ring" style={{ "--confidence": `${card.confidence * 3.6}deg` } as CSSProperties}><b>{card.confidence}</b></span><small>{confidenceLabel}</small></div>
        <CardActions card={card} brandId={brandId} pending={pending} onAct={onAct} inTable/>
      </div>;
    })}</div>
  </div></div>;
}

function DiscoverGrid({ cards, brandId, pending, onAct }: ViewProps) {
  return <section className="discover-card-grid" aria-label="Discovery ideas" data-testid="discover-grid-view">{cards.map((card) => {
    const FormatIcon = formatIcon(card.format);
    const ChannelIcon = channelIcon(card.channel);
    return <article className="discover-card" key={card.id}>
      <Link className={`discover-card-media${card.conceptMockup ? " discover-card-concept" : ""}`} href={discoverPreviewHref(card.id, brandId)} aria-label={`Preview ${card.title}`}>{card.conceptMockup ? <ConceptMockupPreview mockup={card.conceptMockup} mode="card"/> : <><Image src={card.image} alt="" fill sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"/><span className="discover-media-shade"/></>}<span className="discover-badges"><i><TrendingUp aria-hidden="true"/>{card.trend}</i><i><ShieldCheck aria-hidden="true"/>{card.fit}</i></span><span className="discover-channel"><ChannelIcon aria-hidden="true"/>{card.channel}</span></Link>
      <div className="discover-card-body"><div className="discover-card-meta"><span><FormatIcon aria-hidden="true"/>{card.formatLabel}</span><span>{card.opportunity}</span></div><h2><Link href={discoverPreviewHref(card.id, brandId)}>{card.title}</Link></h2><p>{compactOpportunityText(card.rationale, "A timely, Brand-fit direction ready for your review.", 22)}</p><CardActions card={card} brandId={brandId} pending={pending} onAct={onAct}/></div>
    </article>;
  })}</section>;
}

type ViewProps = { cards: DiscoverCard[]; brandId?: string; pending: string; onAct: (card: DiscoverCard, action: "save" | "ignore") => Promise<void> };

function CardActions({ card, brandId, pending, onAct, inTable = false }: { card: DiscoverCard; brandId?: string; pending: string; onAct: ViewProps["onAct"]; inTable?: boolean }) {
  const saved = card.status === "saved";
  return <div className="discover-card-actions" role={inTable ? "cell" : undefined}><Link className="discover-preview-button" href={discoverPreviewHref(card.id, brandId)}><Eye aria-hidden="true"/>Preview</Link><button className={saved ? "saved" : ""} type="button" disabled={saved || Boolean(pending)} onClick={() => void onAct(card, "save")} aria-label={saved ? `${card.title} saved` : `Save ${card.title}`} title={saved ? "Saved" : "Save idea"}>{saved ? <Check aria-hidden="true"/> : <Bookmark aria-hidden="true"/>}</button><button type="button" disabled={Boolean(pending)} onClick={() => void onAct(card, "ignore")} aria-label={`Dismiss ${card.title}`} title="Dismiss idea"><X aria-hidden="true"/></button></div>;
}

function formatIcon(format: DiscoverCard["format"]) {
  if (format === "image") return FileImage;
  if (format === "carousel") return LayoutGrid;
  if (format === "campaign") return Megaphone;
  return PlaySquare;
}

function channelIcon(channel: string) {
  if (channel === "LinkedIn") return Linkedin;
  if (channel === "Facebook") return Facebook;
  if (channel === "YouTube") return Youtube;
  return Instagram;
}


function sourceLabel(source: string) {
  return source.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
