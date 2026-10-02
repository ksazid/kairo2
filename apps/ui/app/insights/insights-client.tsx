"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  CalendarDays,
  ChevronDown,
  Eye,
  Facebook,
  FileImage,
  Grid2X2,
  Instagram,
  Linkedin,
  MousePointerClick,
  PlaySquare,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  WandSparkles,
} from "lucide-react";
import { contentPreviewHref, type ContentItem } from "../../lib/content";
import type { DataModeState } from "../../lib/data-mode";
import {
  buildLiveInsights,
  type LiveInsightsView,
  type LiveMetricRow,
  type LiveTopContent,
} from "../../lib/insights-live";
import {
  createFromInsightHref,
  filterInsightContent,
  insightMetrics,
  insightSeries,
  type InsightChannel,
  type InsightRange,
  type InsightTab,
} from "../../lib/insights";
import { InsightsChart } from "./insights-chart";

const tabs: Array<{ value: InsightTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "content", label: "Content" },
  { value: "campaigns", label: "Campaigns" },
  { value: "audience", label: "Audience" },
];

const metricIcons = {
  reach: Users,
  engagement: BarChart3,
  clicks: MousePointerClick,
  bookings: Target,
  saves: Bookmark,
  videoViews: PlaySquare,
  impressions: Eye,
};

export function InsightsClient({
  items,
  brandId,
  authenticated,
  dataState,
  liveRows,
}: {
  items: ContentItem[];
  brandId?: string;
  authenticated: boolean;
  dataState: DataModeState;
  liveRows: LiveMetricRow[];
}) {
  const [tab, setTab] = useState<InsightTab>("overview");
  const [range, setRange] = useState<InsightRange>("30");
  const [channel, setChannel] = useState<InsightChannel>("all");
  const [compare, setCompare] = useState(true);
  const sample = dataState.usesSampleData;

  const liveView = useMemo(
    () => sample ? undefined : buildLiveInsights(liveRows, { channel, range, items }),
    [channel, items, liveRows, range, sample],
  );
  const metrics = useMemo(
    () => sample ? insightMetrics(channel, range) : liveView?.metrics ?? [],
    [channel, liveView?.metrics, range, sample],
  );
  const points = useMemo(
    () => sample ? insightSeries(channel, range) : liveView?.points ?? [],
    [channel, liveView?.points, range, sample],
  );
  const sampleTopContent = useMemo(
    () => filterInsightContent(items, channel).slice(0, 3),
    [channel, items],
  );

  return <>
    <header className="insights-page-header">
      <div><h1>Insights</h1><p>Understand what is working and what to create next.</p></div>
      {sample
        ? <span className="insights-preview-action" aria-disabled="true"><WandSparkles aria-hidden="true"/>Preview only</span>
        : <Link href={createFromInsightHref(brandId)}><WandSparkles aria-hidden="true"/>Create from insight</Link>}
    </header>

    <section className={`kairo-data-mode-notice is-${dataState.mode}`} role="status" aria-label="Insights data mode">
      <div><strong>{dataState.label}</strong><p>{dataState.message}</p></div>
      {sample
        ? <span><small>Data type</small><b>Sample</b></span>
        : <span><small>Data type</small><b>Live</b></span>}
    </section>

    <section className="insights-toolbar" aria-label="Insight filters">
      <label className="insights-range">
        <CalendarDays aria-hidden="true"/>
        <select value={range} onChange={(event) => setRange(event.target.value as InsightRange)} aria-label="Date range">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <ChevronDown aria-hidden="true"/>
      </label>
      <button className="insights-compare" type="button" aria-pressed={compare} onClick={() => setCompare((current) => !current)}>
        <RefreshCw aria-hidden="true"/>Compare
      </button>
      <div className="insights-channel-tabs" role="group" aria-label="Insight channel">
        <button type="button" aria-pressed={channel === "all"} onClick={() => setChannel("all")}>All channels</button>
        <button type="button" aria-pressed={channel === "Instagram"} onClick={() => setChannel("Instagram")} title="Instagram"><Instagram aria-hidden="true"/></button>
        <button type="button" aria-pressed={channel === "LinkedIn"} onClick={() => setChannel("LinkedIn")} title="LinkedIn"><Linkedin aria-hidden="true"/></button>
        <button type="button" aria-pressed={channel === "Facebook"} onClick={() => setChannel("Facebook")} title="Facebook"><Facebook aria-hidden="true"/></button>
      </div>
      <nav className="insights-tabs" aria-label="Insight sections">
        {tabs.map((item) => <button key={item.value} type="button" aria-current={tab === item.value ? "page" : undefined} onClick={() => setTab(item.value)}>{item.label}</button>)}
      </nav>
      <span className="insights-evidence"><i/>{dataState.label}</span>
    </section>

    <section className="insights-metrics" aria-label="Performance summary">
      {metrics.length ? metrics.map((metric) => {
        const Icon = metricIcons[metric.id];
        const DeltaIcon = metric.direction === "up" ? ArrowUpRight : ArrowDownRight;
        return <article key={metric.id}>
          <header><span><Icon aria-hidden="true"/></span><small>{metric.label}</small>{sample ? <SampleBadge/> : null}</header>
          <div>
            <strong>{metric.value}</strong>
            {metric.delta === "Live"
              ? <em className="live">Live</em>
              : <em className={metric.direction}><DeltaIcon aria-hidden="true"/>{metric.delta}</em>}
          </div>
          <p>{metric.description}</p>
        </article>;
      }) : <article className="insights-no-live-metrics">
        <header><span><BarChart3 aria-hidden="true"/></span><small>Live evidence</small></header>
        <div><strong>—</strong></div>
        <p>No supported metric is available for this filter yet.</p>
      </article>}
    </section>

    {tab === "overview"
      ? <Overview items={sample ? sampleTopContent : items} points={points} compare={compare} brandId={brandId} sample={sample} liveView={liveView}/>
      : <FocusedView tab={tab} items={sample ? sampleTopContent : items} points={points} compare={compare} brandId={brandId} sample={sample} liveView={liveView}/>}
  </>;
}

function Overview({
  items,
  points,
  compare,
  brandId,
  sample,
  liveView,
}: {
  items: ContentItem[];
  points: ReturnType<typeof insightSeries>;
  compare: boolean;
  brandId?: string;
  sample: boolean;
  liveView?: LiveInsightsView;
}) {
  const lastPoint = points.at(-1);
  const change = livePointChange(lastPoint);
  return <>
    <section className="insights-main-grid">
      <article className="insights-performance">
        <header>
          <div>
            <h2>Performance over time {sample ? <SampleBadge/> : null}</h2>
            <p>{sample ? "Example reach once published content has performance data" : "Collected reach/impressions over time"}</p>
          </div>
          <div>
            <span><i className="current"/>{sample ? "This period" : "Current captured point"}</span>
            {compare ? <span><i/>{sample ? "Previous period" : "Previous captured point"}</span> : null}
          </div>
        </header>
        <div className="insights-chart-wrap">
          <InsightsChart points={points} compare={compare}/>
          {lastPoint ? <div className="insights-chart-tooltip">
            <small>{lastPoint.label}</small>
            <strong>{lastPoint.current}K reach</strong>
            <span>{sample ? "+31% vs previous" : change}</span>
          </div> : null}
        </div>
        <footer>{sample
          ? "Sample timeline · not synced from your Brand"
          : liveView?.lastCapturedAt
            ? `Latest metric captured ${formatTimestamp(liveView.lastCapturedAt)}`
            : "Live metric timestamp unavailable"}</footer>
      </article>

      {sample
        ? <SampleLearningCard brandId={brandId}/>
        : <LiveEvidenceCard liveView={liveView} items={items}/>}
    </section>

    <section className="insights-bottom-grid">
      <TopContent items={items} brandId={brandId} sample={sample} liveTopContent={liveView?.topContent}/>
      <ChannelContribution sample={sample} liveView={liveView}/>
    </section>
  </>;
}

function FocusedView({
  tab,
  items,
  points,
  compare,
  brandId,
  sample,
  liveView,
}: {
  tab: Exclude<InsightTab, "overview">;
  items: ContentItem[];
  points: ReturnType<typeof insightSeries>;
  compare: boolean;
  brandId?: string;
  sample: boolean;
  liveView?: LiveInsightsView;
}) {
  const copy = tab === "content"
    ? ["Content performance", "Compare every asset and open its full preview."]
    : tab === "campaigns"
      ? ["Campaign contribution", "See which coordinated content sets are moving your goal."]
      : ["Audience response", "Understand the topics and formats your audience acts on."];

  return <section className="insights-focus-grid">
    <article className="insights-performance">
      <header><div><h2>{copy[0]}</h2><p>{copy[1]}</p></div></header>
      <div className="insights-chart-wrap"><InsightsChart points={points} compare={compare}/></div>
    </article>
    {tab === "content"
      ? <TopContent items={items} brandId={brandId} sample={sample} liveTopContent={liveView?.topContent}/>
      : tab === "campaigns"
        ? <CampaignInsight sample={sample} liveView={liveView} items={items}/>
        : <AudienceInsight sample={sample} liveView={liveView}/>}
  </section>;
}

function SampleLearningCard({ brandId }: { brandId?: string }) {
  return <article className="insights-learned">
    <header><h2><Sparkles aria-hidden="true"/>Kairo learned</h2><span>SAMPLE PATTERN</span></header>
    <div className="insights-learned-image"><img src="/malta-harbour.webp" alt="Maltese coast and harbour"/><span>SAMPLE PATTERN</span></div>
    <section>
      <h3>Practical Malta guides earn more saves and site visits.</h3>
      <p>Your audience responds when local advice solves a specific travel problem. This is sample copy showing how an accepted learning can appear.</p>
      <div><span><strong>+42%</strong><small>Saves</small></span><span><strong>+31%</strong><small>Site visits</small></span></div>
    </section>
    <span className="insights-preview-action" aria-disabled="true"><WandSparkles aria-hidden="true"/>Sample only</span>
  </article>;
}

function LiveEvidenceCard({ liveView, items }: { liveView?: LiveInsightsView; items: ContentItem[] }) {
  const top = liveView?.topContent[0];
  const item = top ? items.find((entry) => entry.id === top.assetId) : undefined;
  const channel = liveView?.channels[0];
  return <article className="insights-learned">
    <header><h2><Sparkles aria-hidden="true"/>Current evidence</h2><span>LIVE METRICS</span></header>
    <div className="insights-learned-image"><img src={item?.image ?? "/kairo-media-placeholder.svg"} alt=""/><span>LIVE EVIDENCE</span></div>
    <section>
      <h3>{item ? `${item.title} is the strongest measured content in this view.` : "Live performance evidence is available."}</h3>
      <p>{channel
        ? `${channel.label} currently contributes ${channel.value}% of measured reach in this filter. Kairo is reporting observed metrics only.`
        : "Kairo has enough normalized evidence to show live metrics, but not enough channel evidence for a stronger conclusion."}</p>
      <div>
        <span><strong>{top ? compact(top.reach) : "—"}</strong><small>Measured reach</small></span>
        <span><strong>{top ? `${top.engagementRate.toFixed(1)}%` : "—"}</strong><small>Engagement</small></span>
      </div>
    </section>
  </article>;
}

function TopContent({
  items,
  brandId,
  sample,
  liveTopContent,
}: {
  items: ContentItem[];
  brandId?: string;
  sample: boolean;
  liveTopContent?: LiveTopContent[];
}) {
  if (!sample) {
    const itemById = new Map(items.map((item) => [item.id, item]));
    return <article id="insights-top-content" className="insights-top-content">
      <header>
        <div><h2>Top content</h2><p>Ranked from normalized performance evidence</p></div>
        <Link href={brandId ? `/content?brand=${encodeURIComponent(brandId)}` : "/content"}>View all</Link>
      </header>
      <div className="insights-top-head"><span>Content</span><span>Reach</span><span>Engagement</span><span>Result</span><span/></div>
      {(liveTopContent ?? []).length ? (liveTopContent ?? []).map((metric) => {
        const item = itemById.get(metric.assetId);
        const result = metric.saves !== undefined
          ? `${compact(metric.saves)} saves`
          : metric.clicks !== undefined
            ? `${compact(metric.clicks)} clicks`
            : metric.views !== undefined
              ? `${compact(metric.views)} views`
              : "Live evidence";
        return <div className="insights-top-row" key={metric.assetId}>
          <div><img src={item?.image ?? "/kairo-media-placeholder.svg"} alt=""/><span><strong>{item?.title ?? "Published content"}</strong><small>{item ? <><FormatIcon item={item}/>{item.formatLabel} · <ChannelIcon item={item}/>{item.channel}</> : "Published asset"}</small></span></div>
          <strong>{compact(metric.reach)}</strong>
          <strong>{metric.engagementRate.toFixed(1)}%</strong>
          <span className="insights-result">{result}</span>
          {item ? <Link href={contentPreviewHref(item, brandId)}><Eye aria-hidden="true"/>Open preview</Link> : <span className="insights-preview-action" aria-disabled="true"><Eye aria-hidden="true"/>Unavailable</span>}
        </div>;
      }) : <div className="insights-live-empty">No content-level metric evidence is available for this filter.</div>}
    </article>;
  }

  return <article id="insights-top-content" className="insights-top-content">
    <header><div><h2>Top content <SampleBadge/></h2><p>Example ranking and performance layout</p></div><span className="kairo-sample-badge">SAMPLE</span></header>
    <div className="insights-top-head"><span>Content</span><span>Reach</span><span>Engagement</span><span>Result</span><span/></div>
    {items.map((item, index) => <div className="insights-top-row" key={item.id}>
      <div><img src={item.image} alt=""/><span><strong>{item.title}</strong><small><FormatIcon item={item}/>{item.formatLabel} · <ChannelIcon item={item}/>{item.channel}</small></span></div>
      <strong>{["42.8K", "31.6K", "24.9K"][index]}</strong>
      <strong>{["8.9%", "7.4%", "6.8%"][index]}</strong>
      <span className="insights-result">{["1,284 saves", "762 clicks", "14 bookings"][index]}</span>
      <span className="insights-preview-action" aria-disabled="true"><Eye aria-hidden="true"/>Sample</span>
    </div>)}
  </article>;
}

function ChannelContribution({ sample, liveView }: { sample: boolean; liveView?: LiveInsightsView }) {
  const channels = sample
    ? [
        { label: "Instagram" as const, value: 58, detail: "74.5K reach" },
        { label: "LinkedIn" as const, value: 24, detail: "30.8K reach" },
        { label: "Facebook" as const, value: 18, detail: "23.1K reach" },
      ]
    : liveView?.channels ?? [];

  return <article className="insights-channels">
    <header><h2>Channel contribution {sample ? <SampleBadge/> : null}</h2><p>{sample ? "Example share of total reach" : "Measured share of total reach/impressions"}</p></header>
    <div>{channels.length ? channels.map(({ label, value, detail }) => {
      const Icon = label === "LinkedIn" ? Linkedin : label === "Facebook" ? Facebook : Instagram;
      return <section key={label}>
        <span><Icon aria-hidden="true"/><strong>{label}</strong><small>{detail}</small></span>
        <div><i style={{ width: `${value}%` }}/></div>
        <b>{value}%</b>
      </section>;
    }) : <p className="insights-live-empty">No channel-level metric evidence is available for this filter.</p>}</div>
    <p><Sparkles aria-hidden="true"/>{sample
      ? "Sample insight: Instagram is shown as the strongest example channel."
      : channels[0]
        ? `${channels[0].label} currently has the largest measured share in this filter.`
        : "No channel conclusion is available yet."}</p>
  </article>;
}

function CampaignInsight({ sample, liveView, items }: { sample: boolean; liveView?: LiveInsightsView; items: ContentItem[] }) {
  if (sample) return <article className="insights-focus-card">
    <span><Target aria-hidden="true"/></span><SampleBadge/>
    <h2>Sample campaign performance</h2>
    <p>Example: coordinated content can be compared against measured outcomes once live metrics exist.</p>
    <div><strong>28</strong><small>sample bookings</small><strong>7.9%</strong><small>sample engagement</small></div>
  </article>;

  const campaign = liveView?.topCampaign;
  if (!campaign) return <article className="insights-focus-card">
    <span><Target aria-hidden="true"/></span>
    <h2>Not enough campaign evidence yet</h2>
    <p>Kairo will rank campaigns here when normalized performance can be attributed to published campaign assets.</p>
  </article>;

  const name = items.find((item) => item.campaignId === campaign.campaignId)?.campaignName ?? "Measured campaign";
  return <article className="insights-focus-card">
    <span><Target aria-hidden="true"/></span>
    <h2>{name} leads measured reach</h2>
    <p>This ranking is based only on normalized performance evidence in the selected channel and time range.</p>
    <div><strong>{compact(campaign.reach)}</strong><small>reach</small><strong>{campaign.engagementRate.toFixed(1)}%</strong><small>engagement</small></div>
  </article>;
}

function AudienceInsight({ sample, liveView }: { sample: boolean; liveView?: LiveInsightsView }) {
  if (sample) return <article className="insights-focus-card">
    <span><Users aria-hidden="true"/></span><SampleBadge/>
    <h2>Sample audience pattern</h2>
    <p>Example: Kairo can surface which audience segments receive the strongest measured response once live metrics exist.</p>
    <div><strong>46%</strong><small>sample reach share</small><strong>2.3×</strong><small>sample saves</small></div>
  </article>;

  const audience = liveView?.topAudience;
  if (!audience) return <article className="insights-focus-card">
    <span><Users aria-hidden="true"/></span>
    <h2>Not enough audience evidence yet</h2>
    <p>Audience conclusions appear only when measured content can be linked to an audience definition.</p>
  </article>;

  return <article className="insights-focus-card">
    <span><Users aria-hidden="true"/></span>
    <h2>{audience.audience} has the strongest measured reach</h2>
    <p>This is an observed content-performance grouping, not a demographic inference.</p>
    <div><strong>{compact(audience.reach)}</strong><small>reach</small><strong>{audience.engagementRate.toFixed(1)}%</strong><small>engagement</small></div>
  </article>;
}

function SampleBadge() {
  return <small className="kairo-sample-badge">SAMPLE</small>;
}

function ChannelIcon({ item }: { item: ContentItem }) {
  const Icon = item.channel === "LinkedIn" ? Linkedin : item.channel === "Facebook" ? Facebook : Instagram;
  return <Icon aria-hidden="true"/>;
}

function FormatIcon({ item }: { item: ContentItem }) {
  const Icon = item.format === "carousel" ? Grid2X2 : item.format === "reel" ? PlaySquare : FileImage;
  return <Icon aria-hidden="true"/>;
}

function livePointChange(point: { current: number; previous: number } | undefined) {
  if (!point || point.previous <= 0) return "No prior captured point";
  const delta = (point.current - point.previous) / point.previous * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}% vs previous captured point`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function compact(value: number) {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));
}
