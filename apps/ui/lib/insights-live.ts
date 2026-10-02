import type { ContentItem } from "./content";
import type { InsightChannel, InsightRange, InsightMetric, InsightPoint } from "./insights";

export type LiveMetricName = "impressions" | "reach" | "reactions" | "likes" | "comments" | "shares" | "saves" | "clicks" | "videoViews";

export type LiveMetricRow = {
  publishedPostId: string;
  campaignId: string;
  assetId: string;
  channel: string;
  name: LiveMetricName;
  capturedAt: string;
  status: "available" | "unavailable";
  value?: number;
  reason?: string;
};

export type LiveTopContent = {
  assetId: string;
  reach: number;
  engagementRate?: number;
  saves?: number;
  clicks?: number;
  views?: number;
};

export type LiveChannel = {
  label: "Instagram" | "LinkedIn" | "Facebook";
  value: number;
  detail: string;
};

export type LiveCampaign = {
  campaignId: string;
  reach: number;
  engagementRate?: number;
};

export type LiveAudience = {
  audience: string;
  reach: number;
  engagementRate?: number;
};

export type LiveInsightsView = {
  ready: boolean;
  metrics: InsightMetric[];
  points: InsightPoint[];
  topContent: LiveTopContent[];
  channels: LiveChannel[];
  topCampaign?: LiveCampaign;
  topAudience?: LiveAudience;
  lastCapturedAt?: string;
};

export function hasSufficientLiveMetrics(rows: LiveMetricRow[]): boolean {
  const available = rows.filter(isAvailable);
  const posts = new Set(available.map((row) => row.publishedPostId));
  const names = new Set(available.map((row) => row.name));
  const hasReach = names.has("reach");
  const hasSupportingMetric = [...names].some((name) => name !== "reach" && name !== "impressions");
  return posts.size >= 1 && hasReach && hasSupportingMetric;
}

export function buildLiveInsights(
  rows: LiveMetricRow[],
  input: { channel: InsightChannel; range: InsightRange; items: ContentItem[] },
): LiveInsightsView {
  if (!hasSufficientLiveMetrics(rows)) {
    return { ready: false, metrics: [], points: [], topContent: [], channels: [] };
  }

  const available = rows.filter(isAvailable);
  const channelRows = available.filter((row) => channelMatches(row.channel, input.channel));
  const latestAt = channelRows.map((row) => Date.parse(row.capturedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (!latestAt) return { ready: false, metrics: [], points: [], topContent: [], channels: [] };
  const rangeDays = Number(input.range);
  const start = latestAt - rangeDays * 86_400_000;
  const ranged = channelRows.filter((row) => Date.parse(row.capturedAt) >= start);
  const selected = latestPerPostMetric(ranged);
  const totals = aggregate(selected);
  const present = new Set(selected.map((row) => row.name));
  const exposure = totals.reach;
  const interactions = totals.likes + totals.comments + totals.shares + totals.saves + totals.reactions;
  const hasEngagementEvidence = ["likes", "comments", "shares", "saves", "reactions"].some((name) => present.has(name as LiveMetricName));
  const engagementRate = hasEngagementEvidence && exposure > 0 ? interactions / exposure * 100 : undefined;

  const metrics: InsightMetric[] = [
    {
      id: "reach",
      label: "Reach",
      value: compact(exposure),
      delta: "Live",
      direction: "up",
      description: "Latest available reach across published content",
    },
  ];
  if (engagementRate !== undefined) metrics.push({
    id: "engagement",
    label: "Engagement rate",
    value: `${engagementRate.toFixed(1)}%`,
    delta: "Live",
    direction: "up",
    description: "Available interactions divided by reach/impressions",
  });

  if (present.has("saves")) metrics.push({
    id: "saves",
    label: "Saves",
    value: compact(totals.saves),
    delta: "Live",
    direction: "up",
    description: "Latest available saves across published content",
  });
  else if (totals.clicks > 0) metrics.push({
    id: "clicks",
    label: "Link clicks",
    value: compact(totals.clicks),
    delta: "Live",
    direction: "up",
    description: "Latest available clicks across published content",
  });
  else if (totals.videoViews > 0) metrics.push({
    id: "videoViews",
    label: "Video views",
    value: compact(totals.videoViews),
    delta: "Live",
    direction: "up",
    description: "Latest available video views across published content",
  });

  if (present.has("videoViews") && !metrics.some((metric) => metric.id === "videoViews")) metrics.push({
    id: "videoViews",
    label: "Video views",
    value: compact(totals.videoViews),
    delta: "Live",
    direction: "up",
    description: "Latest available video views across published content",
  });
  if (present.has("impressions") && present.has("reach") && metrics.length < 4) metrics.push({
    id: "impressions",
    label: "Impressions",
    value: compact(totals.impressions),
    delta: "Live",
    direction: "up",
    description: "Latest available impressions across published content",
  });

  const assetGroups = group(selected, (row) => row.assetId);
  const topContent = [...assetGroups.entries()].filter(([, metricRows]) => metricRows.some((row) => row.name === "reach")).map(([assetId, metricRows]) => {
    const total = aggregate(metricRows);
    const presentNames = new Set(metricRows.map((row) => row.name));
    const base = total.reach;
    const engagement = total.likes + total.comments + total.shares + total.saves + total.reactions;
    const hasEngagement = ["likes", "comments", "shares", "saves", "reactions"].some((name) => presentNames.has(name as LiveMetricName));
    return {
      assetId,
      reach: base,
      ...(hasEngagement && base > 0 ? { engagementRate: engagement / base * 100 } : {}),
      ...(presentNames.has("saves") ? { saves: total.saves } : {}),
      ...(presentNames.has("clicks") ? { clicks: total.clicks } : {}),
      ...(presentNames.has("videoViews") ? { views: total.videoViews } : {}),
    };
  }).sort((a, b) => b.reach - a.reach).slice(0, 3);

  const channelGroups = group(selected, (row) => channelLabel(row.channel));
  const channelReach = [...channelGroups.entries()].map(([label, metricRows]) => {
    const total = aggregate(metricRows);
    return { label, reach: total.reach };
  }).filter((item) => item.reach > 0);
  const allChannelReach = channelReach.reduce((sum, item) => sum + item.reach, 0);
  const channels = channelReach
    .sort((a, b) => b.reach - a.reach)
    .map((item) => ({
      label: item.label,
      value: allChannelReach > 0 ? Math.round(item.reach / allChannelReach * 100) : 0,
      detail: `${compact(item.reach)} reach`,
    }));

  const campaignGroups = group(selected, (row) => row.campaignId);
  const topCampaign = [...campaignGroups.entries()].filter(([, metricRows]) => metricRows.some((row) => row.name === "reach")).map(([campaignId, metricRows]) => {
    const total = aggregate(metricRows);
    const presentNames = new Set(metricRows.map((row) => row.name));
    const base = total.reach;
    const engagement = total.likes + total.comments + total.shares + total.saves + total.reactions;
    const hasEngagement = ["likes", "comments", "shares", "saves", "reactions"].some((name) => presentNames.has(name as LiveMetricName));
    return { campaignId, reach: base, ...(hasEngagement && base > 0 ? { engagementRate: engagement / base * 100 } : {}) };
  }).sort((a, b) => b.reach - a.reach)[0];

  const itemByAsset = new Map(input.items.map((item) => [item.id, item]));
  const audienceRows = new Map<string, LiveMetricRow[]>();
  for (const row of selected) {
    const audience = itemByAsset.get(row.assetId)?.audience?.trim();
    if (!audience) continue;
    const list = audienceRows.get(audience) ?? [];
    list.push(row);
    audienceRows.set(audience, list);
  }
  const topAudience = [...audienceRows.entries()].filter(([, metricRows]) => metricRows.some((row) => row.name === "reach")).map(([audience, metricRows]) => {
    const total = aggregate(metricRows);
    const presentNames = new Set(metricRows.map((row) => row.name));
    const base = total.reach;
    const engagement = total.likes + total.comments + total.shares + total.saves + total.reactions;
    const hasEngagement = ["likes", "comments", "shares", "saves", "reactions"].some((name) => presentNames.has(name as LiveMetricName));
    return { audience, reach: base, ...(hasEngagement && base > 0 ? { engagementRate: engagement / base * 100 } : {}) };
  }).sort((a, b) => b.reach - a.reach)[0];

  return {
    ready: true,
    metrics,
    points: buildSeries(ranged),
    topContent,
    channels,
    ...(topCampaign ? { topCampaign } : {}),
    ...(topAudience ? { topAudience } : {}),
    lastCapturedAt: new Date(latestAt).toISOString(),
  };
}

function isAvailable(row: LiveMetricRow): row is LiveMetricRow & { value: number } {
  return row.status === "available" && typeof row.value === "number" && Number.isFinite(row.value) && row.value >= 0;
}

function channelMatches(channel: string, selected: InsightChannel): boolean {
  return selected === "all" || channelLabel(channel) === selected;
}

function channelLabel(channel: string): "Instagram" | "LinkedIn" | "Facebook" {
  const normalized = channel.toLowerCase();
  if (normalized === "linkedin") return "LinkedIn";
  if (normalized === "facebook") return "Facebook";
  return "Instagram";
}

function latestPerPostMetric(rows: Array<LiveMetricRow & { value: number }>) {
  const map = new Map<string, LiveMetricRow & { value: number }>();
  for (const row of rows) {
    const key = `${row.publishedPostId}:${row.name}`;
    const current = map.get(key);
    if (!current || Date.parse(row.capturedAt) > Date.parse(current.capturedAt)) map.set(key, row);
  }
  return [...map.values()];
}

function aggregate(rows: Array<LiveMetricRow & { value: number }>) {
  const totals = {
    impressions: 0, reach: 0, reactions: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, videoViews: 0,
  };
  for (const row of rows) totals[row.name] += row.value;
  return totals;
}

function group<T, K>(rows: T[], key: (row: T) => K) {
  const result = new Map<K, T[]>();
  for (const row of rows) {
    const value = key(row);
    const list = result.get(value) ?? [];
    list.push(row);
    result.set(value, list);
  }
  return result;
}

function buildSeries(rows: Array<LiveMetricRow & { value: number }>): InsightPoint[] {
  const exposure = rows.filter((row) => row.name === "reach");
  const latestByPostDay = new Map<string, LiveMetricRow & { value: number }>();
  for (const row of exposure) {
    const day = row.capturedAt.slice(0, 10);
    const key = `${day}:${row.publishedPostId}`;
    const current = latestByPostDay.get(key);
    if (!current || Date.parse(row.capturedAt) > Date.parse(current.capturedAt)) latestByPostDay.set(key, row);
  }
  const byDay = new Map<string, number>();
  for (const row of latestByPostDay.values()) {
    const day = row.capturedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + row.value);
  }
  const points = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  return points.map(([day, value], index) => ({
    label: new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)),
    current: Math.round(value / 1000 * 10) / 10,
    previous: index > 0 ? Math.round(points[index - 1]![1] / 1000 * 10) / 10 : 0,
  }));
}

function compact(value: number) {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));
}
