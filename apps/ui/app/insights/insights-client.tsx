"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
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
import { createFromInsightHref, filterInsightContent, insightMetrics, insightSeries, type InsightChannel, type InsightRange, type InsightTab } from "../../lib/insights";
import { InsightsChart } from "./insights-chart";

const tabs: Array<{ value: InsightTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "content", label: "Content" },
  { value: "campaigns", label: "Campaigns" },
  { value: "audience", label: "Audience" },
];

const metricIcons = { reach: Users, engagement: BarChart3, clicks: MousePointerClick, bookings: Target };

export function InsightsClient({ items, brandId, authenticated }: { items: ContentItem[]; brandId?: string; authenticated: boolean }) {
  const [tab, setTab] = useState<InsightTab>("overview");
  const [range, setRange] = useState<InsightRange>("30");
  const [channel, setChannel] = useState<InsightChannel>("all");
  const [compare, setCompare] = useState(true);
  const metrics = useMemo(() => insightMetrics(channel, range), [channel, range]);
  const points = useMemo(() => insightSeries(channel, range), [channel, range]);
  const topContent = useMemo(() => filterInsightContent(items, channel).slice(0, 3), [channel, items]);

  return <>
    <header className="insights-page-header">
      <div><h1>Insights</h1><p>Understand what is working and what to create next.</p></div>
      <Link href={createFromInsightHref(brandId)}><WandSparkles aria-hidden="true"/>Create from insight</Link>
    </header>

    <section className="insights-toolbar" aria-label="Insight filters">
      <label className="insights-range"><CalendarDays aria-hidden="true"/><select value={range} onChange={(event) => setRange(event.target.value as InsightRange)} aria-label="Date range"><option value="7">Aug 25 – Aug 31, 2026</option><option value="30">Aug 1 – Aug 31, 2026</option><option value="90">Jun 1 – Aug 31, 2026</option></select><ChevronDown aria-hidden="true"/></label>
      <button className="insights-compare" type="button" aria-pressed={compare} onClick={() => setCompare((current) => !current)}><RefreshCw aria-hidden="true"/>Compare</button>
      <div className="insights-channel-tabs" role="group" aria-label="Insight channel">
        <button type="button" aria-pressed={channel === "all"} onClick={() => setChannel("all")}>All channels</button>
        <button type="button" aria-pressed={channel === "Instagram"} onClick={() => setChannel("Instagram")} title="Instagram"><Instagram aria-hidden="true"/></button>
        <button type="button" aria-pressed={channel === "LinkedIn"} onClick={() => setChannel("LinkedIn")} title="LinkedIn"><Linkedin aria-hidden="true"/></button>
        <button type="button" aria-pressed={channel === "Facebook"} onClick={() => setChannel("Facebook")} title="Facebook"><Facebook aria-hidden="true"/></button>
      </div>
      <nav className="insights-tabs" aria-label="Insight sections">{tabs.map((item) => <button key={item.value} type="button" aria-current={tab === item.value ? "page" : undefined} onClick={() => setTab(item.value)}>{item.label}</button>)}</nav>
      <span className="insights-evidence"><i/>{authenticated ? "Live Brand data" : "Preview data"}</span>
    </section>

    <section className="insights-metrics" aria-label="Performance summary">{metrics.map((metric) => {
      const Icon = metricIcons[metric.id];
      const DeltaIcon = metric.direction === "up" ? ArrowUpRight : ArrowDownRight;
      return <article key={metric.id}><header><span><Icon aria-hidden="true"/></span><small>{metric.label}</small></header><div><strong>{metric.value}</strong><em className={metric.direction}><DeltaIcon aria-hidden="true"/>{metric.delta}</em></div><p>{metric.description}</p></article>;
    })}</section>

    {tab === "overview" ? <Overview items={topContent} points={points} compare={compare} brandId={brandId}/> : <FocusedView tab={tab} items={topContent} points={points} compare={compare} brandId={brandId}/>} 
  </>;
}

function Overview({ items, points, compare, brandId }: { items: ContentItem[]; points: ReturnType<typeof insightSeries>; compare: boolean; brandId?: string }) {
  return <>
    <section className="insights-main-grid">
      <article className="insights-performance">
        <header><div><h2>Performance over time</h2><p>Reach across published content</p></div><div><span><i className="current"/>This period</span>{compare ? <span><i/>Previous period</span> : null}</div></header>
        <div className="insights-chart-wrap"><InsightsChart points={points} compare={compare}/><div className="insights-chart-tooltip"><small>Aug 26</small><strong>{points.at(-2)?.current ?? 0}K reach</strong><span>+31% vs previous</span></div></div>
        <footer>Last synced 2 minutes ago</footer>
      </article>
      <article className="insights-learned">
        <header><h2><Sparkles aria-hidden="true"/>Kairo learned</h2><span>High confidence</span></header>
        <div className="insights-learned-image"><img src="/malta-harbour.webp" alt="Maltese coast and harbour"/><span>PROVEN PATTERN</span></div>
        <section><h3>Practical Malta guides earn more saves and site visits.</h3><p>Your audience responds when local advice solves a specific travel problem. Short lists with a clear visual hook outperform general destination inspiration.</p><div><span><strong>+42%</strong><small>Saves</small></span><span><strong>+31%</strong><small>Site visits</small></span></div></section>
        <Link href={createFromInsightHref(brandId, "A practical Malta guide travellers will save")}><WandSparkles aria-hidden="true"/>Create similar content</Link>
      </article>
    </section>
    <section className="insights-bottom-grid"><TopContent items={items} brandId={brandId}/><ChannelContribution/></section>
  </>;
}

function FocusedView({ tab, items, points, compare, brandId }: { tab: Exclude<InsightTab, "overview">; items: ContentItem[]; points: ReturnType<typeof insightSeries>; compare: boolean; brandId?: string }) {
  const copy = tab === "content" ? ["Content performance", "Compare every asset and open its full preview."] : tab === "campaigns" ? ["Campaign contribution", "See which coordinated content sets are moving your goal."] : ["Audience response", "Understand the topics and formats your audience acts on."];
  return <section className="insights-focus-grid">
    <article className="insights-performance"><header><div><h2>{copy[0]}</h2><p>{copy[1]}</p></div></header><div className="insights-chart-wrap"><InsightsChart points={points} compare={compare}/></div></article>
    {tab === "content" ? <TopContent items={items} brandId={brandId}/> : tab === "campaigns" ? <CampaignInsight/> : <AudienceInsight/>}
  </section>;
}

function TopContent({ items, brandId }: { items: ContentItem[]; brandId?: string }) {
  return <article id="insights-top-content" className="insights-top-content"><header><div><h2>Top content</h2><p>Assets driving the strongest results</p></div><Link href={brandId ? `/content?brand=${encodeURIComponent(brandId)}` : "/content"}>View all</Link></header><div className="insights-top-head"><span>Content</span><span>Reach</span><span>Engagement</span><span>Result</span><span/></div>{items.map((item, index) => <div className="insights-top-row" key={item.id}><div><img src={item.image} alt=""/><span><strong>{item.title}</strong><small><FormatIcon item={item}/>{item.formatLabel} · <ChannelIcon item={item}/>{item.channel}</small></span></div><strong>{["42.8K", "31.6K", "24.9K"][index]}</strong><strong>{["8.9%", "7.4%", "6.8%"][index]}</strong><span className="insights-result">{["1,284 saves", "762 clicks", "14 bookings"][index]}</span><Link href={contentPreviewHref(item, brandId)}><Eye aria-hidden="true"/>Open preview</Link></div>)}</article>;
}

function ChannelContribution() {
  const channels = [
    { label: "Instagram", value: 58, Icon: Instagram, detail: "74.5K reach" },
    { label: "LinkedIn", value: 24, Icon: Linkedin, detail: "30.8K reach" },
    { label: "Facebook", value: 18, Icon: Facebook, detail: "23.1K reach" },
  ];
  return <article className="insights-channels"><header><h2>Channel contribution</h2><p>Share of total reach</p></header><div>{channels.map(({ label, value, Icon, detail }) => <section key={label}><span><Icon aria-hidden="true"/><strong>{label}</strong><small>{detail}</small></span><div><i style={{ width: `${value}%` }}/></div><b>{value}%</b></section>)}</div><p><Sparkles aria-hidden="true"/>Instagram is your strongest channel for practical travel content.</p></article>;
}

function CampaignInsight() {
  return <article className="insights-focus-card"><span><Target aria-hidden="true"/></span><h2>Malta Summer Rental Guide leads performance</h2><p>Coordinated practical advice is responsible for 61% of attributed bookings this period.</p><div><strong>28</strong><small>bookings</small><strong>7.9%</strong><small>engagement</small></div></article>;
}

function AudienceInsight() {
  return <article className="insights-focus-card"><span><Users aria-hidden="true"/></span><h2>Trip planners are your most responsive audience</h2><p>People researching Malta 14–30 days before travel save guides and click rental advice most often.</p><div><strong>46%</strong><small>of reach</small><strong>2.3×</strong><small>more saves</small></div></article>;
}

function ChannelIcon({ item }: { item: ContentItem }) {
  const Icon = item.channel === "LinkedIn" ? Linkedin : item.channel === "Facebook" ? Facebook : Instagram;
  return <Icon aria-hidden="true"/>;
}

function FormatIcon({ item }: { item: ContentItem }) {
  const Icon = item.format === "carousel" ? Grid2X2 : item.format === "reel" ? PlaySquare : FileImage;
  return <Icon aria-hidden="true"/>;
}
