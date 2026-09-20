import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Facebook,
  FileImage,
  Instagram,
  LayoutGrid,
  Linkedin,
  PlaySquare,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Youtube,
} from "lucide-react";
import { ConceptMockupPreview } from "../../../components/concept-mockup";
import { getHomeData } from "../../../lib/api";
import { discoverFallback, toDiscoverCards } from "../../../lib/discover";
import { requirePageAuthentication } from "../../../lib/page-auth";
import { KairoShell } from "../../kairo-shell";
import { DiscoverPreviewActions } from "./discover-preview-actions";

type Params = Promise<{ opportunityId: string }>;
type SearchParams = Promise<{ brand?: string }>;

export default async function DiscoverPreviewPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ opportunityId }, query] = await Promise.all([params, searchParams]);
  const data = requirePageAuthentication(await getHomeData(query.brand), `/discover/${encodeURIComponent(opportunityId)}`);
  const cards = toDiscoverCards(data.authenticated ? data.opportunities : discoverFallback);
  const card = cards.find((item) => item.id === opportunityId);
  if (!card) notFound();
  const FormatIcon = card.format === "image" ? FileImage : card.format === "carousel" ? LayoutGrid : PlaySquare;
  const ChannelIcon = channelIcon(card.channel);
  const discoverHref = data.brandId ? `/discover?brand=${encodeURIComponent(data.brandId)}` : "/discover";

  return <KairoShell active="Discover" authenticated={data.authenticated} brandId={data.brandId} brandName={data.brandName} workspaceClassName="discover-preview-workspace">
    <Link className="discover-back" href={discoverHref}><ArrowLeft aria-hidden="true"/>Back to Discover</Link>
    <header className="discover-preview-header">
      <span><Sparkles aria-hidden="true"/>Concept preview · not generated content</span>
      <h1>{card.title}</h1>
      <p>Review the Brand fit, timing and recommended format before Kairo creates the final content.</p>
    </header>
    <section className="discover-preview-panel">
      <div className={`discover-preview-media${card.conceptMockup ? " discover-preview-concept" : ""}`}>
        {card.conceptMockup ? <ConceptMockupPreview mockup={card.conceptMockup} mode="full"/> : <><Image src={card.image} alt={card.title} fill priority sizes="(max-width: 900px) 100vw, 46vw"/><span className="discover-media-shade"/><div className="discover-badges"><i><TrendingUp aria-hidden="true"/>{card.trend}</i><i><ShieldCheck aria-hidden="true"/>{card.fit}</i></div><div className="discover-preview-image-copy"><strong>{card.title}</strong><small><ChannelIcon aria-hidden="true"/>{card.channel} · {card.formatLabel}</small></div></>}
      </div>
      <div className="discover-preview-copy">
        <div className="discover-preview-label"><Sparkles aria-hidden="true"/>Kairo recommends</div>
        <h2>Create this as a {card.formatLabel}</h2>
        <p className="discover-recommendation-direction">{card.developmentDirection ?? card.details?.proposedAngle ?? card.rationale ?? "Turn the strongest insight into useful content."}</p>
        <div className="discover-signal-row" aria-label="Recommendation signals">
          <span><ShieldCheck aria-hidden="true"/>{card.fit}</span>
          <span><TrendingUp aria-hidden="true"/>{card.trend}</span>
        </div>
        <DiscoverPreviewActions brandId={data.brandId} opportunityId={card.id} title={card.title} direction={card.developmentDirection ?? card.rationale} format={card.format} initiallySaved={card.status === "saved"}/>
      </div>
      <aside className="discover-preview-meta">
        <small>Recommended format</small>
        <strong><FormatIcon aria-hidden="true"/>{card.formatLabel}</strong>
        <p>Chosen for this content direction.</p>
        <hr/>
        <small>Primary channel</small>
        <strong><ChannelIcon aria-hidden="true"/>{card.channel}</strong>
        <p>Best-fit publishing channel for this opportunity.</p>
      </aside>
    </section>
    <section className="discover-evidence" id="public-evidence">
      <div><span>01</span><h2>Source</h2><p>{card.source}</p></div>
      <div><span>02</span><h2>Audience</h2><p>{card.details?.targetAudience ?? "Your most relevant audience"}</p></div>
      <div><span>03</span><h2>Confidence</h2><p>{card.confidence}% Brand Intelligence confidence for this opportunity.</p></div>
    </section>
  </KairoShell>;
}

function channelIcon(channel: string) {
  if (channel === "LinkedIn") return Linkedin;
  if (channel === "Facebook") return Facebook;
  if (channel === "YouTube") return Youtube;
  return Instagram;
}
