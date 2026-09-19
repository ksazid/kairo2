import type { ContentItem } from "./content";

export type InsightRange = "7" | "30" | "90";
export type InsightChannel = "all" | ContentItem["channel"];
export type InsightTab = "overview" | "content" | "campaigns" | "audience";

export type InsightMetric = {
  id: "reach" | "engagement" | "clicks" | "bookings";
  label: string;
  value: string;
  delta: string;
  direction: "up" | "down";
  description: string;
};

export type InsightPoint = { label: string; current: number; previous: number };

const multipliers: Record<InsightChannel, number> = { all: 1, Instagram: .58, LinkedIn: .24, Facebook: .18 };

export function insightMetrics(channel: InsightChannel, range: InsightRange): InsightMetric[] {
  const channelFactor = multipliers[channel];
  const rangeFactor = range === "7" ? .29 : range === "90" ? 2.68 : 1;
  const factor = channelFactor * rangeFactor;
  return [
    { id: "reach", label: "Reach", value: compact(128400 * factor), delta: "+18%", direction: "up", description: "People who saw your content" },
    { id: "engagement", label: "Engagement rate", value: `${(6.8 + (channel === "Instagram" ? 1.1 : channel === "LinkedIn" ? .4 : 0)).toFixed(1)}%`, delta: "+1.2%", direction: "up", description: "Interactions across published content" },
    { id: "clicks", label: "Link clicks", value: Math.round(3240 * factor).toLocaleString("en"), delta: "+22%", direction: "up", description: "Visits driven to your destination" },
    { id: "bookings", label: "Attributed bookings", value: String(Math.max(1, Math.round(47 * factor))), delta: "+9%", direction: "up", description: "Bookings connected to Kairo content" },
  ];
}

export function insightSeries(channel: InsightChannel, range: InsightRange): InsightPoint[] {
  const labels = range === "7" ? ["Aug 25", "Aug 26", "Aug 27", "Aug 28", "Aug 29", "Aug 30", "Aug 31"] : range === "90" ? ["Jun 1", "Jun 15", "Jul 1", "Jul 15", "Aug 1", "Aug 15", "Aug 31"] : ["Aug 1", "Aug 6", "Aug 11", "Aug 16", "Aug 21", "Aug 26", "Aug 31"];
  const factor = multipliers[channel];
  const current = [32, 43, 39, 58, 54, 75, 88];
  const previous = [27, 31, 36, 42, 45, 51, 57];
  return labels.map((label, index) => ({ label, current: Math.round(current[index]! * factor), previous: Math.round(previous[index]! * factor) }));
}

export function filterInsightContent(items: ContentItem[], channel: InsightChannel): ContentItem[] {
  const visible = channel === "all" ? items : items.filter((item) => item.channel === channel);
  return [...visible].sort((a, b) => scoreForStatus(b.status) - scoreForStatus(a.status));
}

export function createFromInsightHref(brandId?: string, title = "Create a save-worthy Malta travel guide"): string {
  const params = new URLSearchParams({ format: "post", title, direction: "Turn this proven practical-travel pattern into a new Brand-led concept." });
  if (brandId) params.set("brand", brandId);
  return `/?${params.toString()}`;
}

function scoreForStatus(status: ContentItem["status"]) {
  return status === "published" ? 4 : status === "scheduled" ? 3 : status === "in-review" ? 2 : 1;
}

function compact(value: number) {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));
}

