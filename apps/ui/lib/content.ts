import type { CampaignDetailView, ContentReviewStatusView, PublishCommandView } from "./api";

export type ContentStatus = "draft" | "in-review" | "scheduled" | "published";
export type ContentFormat = "image" | "reel" | "carousel";

export type ContentItem = {
  id: string;
  campaignId: string;
  campaignName: string;
  title: string;
  summary: string;
  caption: string;
  channel: "Instagram" | "Facebook" | "LinkedIn";
  format: ContentFormat;
  formatLabel: "Post" | "Reel" | "Carousel";
  status: ContentStatus;
  statusLabel: "Draft" | "In review" | "Scheduled" | "Published";
  updatedAt: string;
  image: string;
  media: string[];
  duration?: string;
  cardCount?: number;
  audience: string;
  objective: string;
  cta: string;
  currentVersion: number;
  rawChannel: "linkedin" | "instagram" | "facebook" | "manual";
  rawContent: string;
};

const fallbackContent: ContentItem[] = [
  {
    id: "content-one", campaignId: "malta-summer", campaignName: "Malta Summer Rental Guide",
    title: "5 Rental Mistakes to Avoid in Malta", summary: "Five practical mistakes travellers can avoid before collecting their rental car.",
    caption: "Planning a Malta road trip? Avoid these five common rental mistakes and enjoy a smoother journey from the moment you arrive.",
    channel: "Instagram", format: "carousel", formatLabel: "Carousel", status: "draft", statusLabel: "Draft",
    updatedAt: "2024-05-20T10:15:00Z", image: "/malta-car.webp", media: ["/malta-car.webp", "/malta-drive.webp", "/car-keys.webp", "/malta-harbour.webp"], cardCount: 4,
    audience: "Travellers planning to rent a car in Malta", objective: "Build trust and drive summer rental bookings", cta: "Save this guide for your Malta trip", currentVersion: 1, rawChannel: "instagram", rawContent: "Planning a Malta road trip? Avoid these five common rental mistakes and enjoy a smoother journey from the moment you arrive.",
  },
  {
    id: "content-two", campaignId: "malta-summer", campaignName: "Malta Summer Rental Guide",
    title: "Scenic Drives Along the Maltese Coast", summary: "A short reel featuring Malta’s most memorable coastal driving routes.",
    caption: "Malta was made for the open road. Here are the coastal drives worth adding to your itinerary.",
    channel: "Instagram", format: "reel", formatLabel: "Reel", status: "in-review", statusLabel: "In review",
    updatedAt: "2024-05-24T14:45:00Z", image: "/malta-drive.webp", media: ["/malta-drive.webp"], duration: "0:28",
    audience: "Experience-led Malta visitors", objective: "Increase saves and rental consideration", cta: "Choose your route and start exploring", currentVersion: 1, rawChannel: "instagram", rawContent: "Malta was made for the open road. Here are the coastal drives worth adding to your itinerary.",
  },
  {
    id: "content-three", campaignId: "malta-summer", campaignName: "Malta Summer Rental Guide",
    title: "Best Car Rental Deals This Summer", summary: "A clear summer offer designed for value-conscious Malta travellers.",
    caption: "Explore more of Malta for less with flexible summer rental options made for your trip.",
    channel: "Facebook", format: "image", formatLabel: "Post", status: "scheduled", statusLabel: "Scheduled",
    updatedAt: "2024-05-28T09:00:00Z", image: "/malta-harbour.webp", media: ["/malta-harbour.webp"],
    audience: "Value-conscious summer travellers", objective: "Convert active travel planners", cta: "View this summer’s rental options", currentVersion: 1, rawChannel: "facebook", rawContent: "Explore more of Malta for less with flexible summer rental options made for your trip.",
  },
  {
    id: "content-four", campaignId: "malta-summer", campaignName: "Malta Summer Rental Guide",
    title: "Summer in Malta: Tips for the Perfect Trip", summary: "A save-worthy carousel covering the essentials for a relaxed Malta holiday.",
    caption: "The perfect Malta trip starts with a little local knowledge. Save these six tips before you travel.",
    channel: "LinkedIn", format: "carousel", formatLabel: "Carousel", status: "published", statusLabel: "Published",
    updatedAt: "2024-05-31T11:30:00Z", image: "/malta-harbour.webp", media: ["/malta-harbour.webp", "/malta-car.webp", "/malta-drive.webp", "/car-keys.webp"], cardCount: 6,
    audience: "Business and leisure travellers", objective: "Position the Brand as a trusted Malta guide", cta: "Share this with someone visiting Malta", currentVersion: 1, rawChannel: "linkedin", rawContent: "The perfect Malta trip starts with a little local knowledge. Save these six tips before you travel.",
  },
];

export function contentFallback(): ContentItem[] {
  return fallbackContent.map((item) => ({ ...item, media: [...item.media] }));
}

export function toContentItems(details: CampaignDetailView[], reviews: Record<string, ContentReviewStatusView | null>, commands: PublishCommandView[]): ContentItem[] {
  const images = ["/malta-car.webp", "/malta-drive.webp", "/malta-harbour.webp", "/car-keys.webp"];
  return details.flatMap((detail) => detail.assets.map(({ asset, versions }, index) => {
    const current = versions.at(-1);
    const command = commands.filter((item) => item.assetId === asset.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const review = reviews[asset.id];
    const status = statusFor(command, review, current?.id);
    const format = normalizeFormat(asset.format);
    const libraryMedia = current?.libraryAssetRefs?.filter((item) => (item.kind === "image" || item.kind === "video") && item.previewRef).map((item) => item.previewRef!) ?? [];
    const image = libraryMedia[0] ?? images[index % images.length]!;
    const content = current?.content?.trim() || asset.topic;
    return {
      id: asset.id,
      campaignId: detail.campaign.id,
      campaignName: detail.campaign.name,
      title: asset.topic,
      summary: summarize(content),
      caption: captionFrom(content),
      channel: channelLabel(asset.channel),
      format,
      formatLabel: format === "image" ? "Post" : format === "carousel" ? "Carousel" : "Reel",
      status,
      statusLabel: status === "in-review" ? "In review" : status === "scheduled" ? "Scheduled" : status === "published" ? "Published" : "Draft",
      updatedAt: command?.createdAt ?? current?.createdAt ?? asset.createdAt,
      image,
      media: libraryMedia.length ? libraryMedia : [image],
      ...(format === "carousel" ? { cardCount: Math.max(libraryMedia.length, 1) } : {}),
      audience: asset.audience,
      objective: detail.campaign.objective,
      cta: asset.cta,
      currentVersion: asset.currentVersion,
      rawChannel: asset.channel,
      rawContent: current?.content ?? "",
    } satisfies ContentItem;
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function contentWithCaption(rawContent: string, caption: string): string {
  const clean = caption.replace(/\r\n?/g, "\n").trim();
  if (!clean) throw new Error("Caption cannot be empty.");
  if (clean.length > 20_000) throw new Error("Caption is too long.");
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const key = ["caption", "copy", "text", "body", "description"].find((candidate) => typeof record[candidate] === "string") ?? "caption";
      return JSON.stringify({ ...record, [key]: clean });
    }
  } catch {}
  return clean;
}

export function filterContent(items: ContentItem[], input: { query: string; status: "all" | ContentStatus; format: "all" | ContentFormat }): ContentItem[] {
  const query = input.query.trim().toLowerCase();
  return items.filter((item) => {
    if (input.status !== "all" && item.status !== input.status) return false;
    if (input.format !== "all" && item.format !== input.format) return false;
    if (query && ![item.title, item.campaignName, item.channel, item.formatLabel].some((value) => value.toLowerCase().includes(query))) return false;
    return true;
  });
}

export function contentPreviewHref(item: Pick<ContentItem, "campaignId" | "id">, brandId?: string): string {
  const path = `/content/${encodeURIComponent(item.campaignId)}/${encodeURIComponent(item.id)}`;
  return brandId ? `${path}?brand=${encodeURIComponent(brandId)}` : path;
}

function statusFor(command: PublishCommandView | undefined, review: ContentReviewStatusView | null | undefined, versionId?: string): ContentStatus {
  if (command?.status === "published") return "published";
  if (command && ["scheduled", "dispatching", "unknown"].includes(command.status)) return "scheduled";
  if (review?.review?.versionId === versionId || review?.approval?.versionId === versionId) return "in-review";
  return "draft";
}

function normalizeFormat(value: string): ContentFormat {
  const format = value.toLowerCase();
  if (format === "carousel") return "carousel";
  if (/reel|video|short/.test(format)) return "reel";
  return "image";
}

function channelLabel(value: string): ContentItem["channel"] {
  if (value.toLowerCase() === "facebook") return "Facebook";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return "Instagram";
}

function captionFrom(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    for (const key of ["caption", "copy", "text", "body", "description"]) if (typeof parsed[key] === "string" && parsed[key]!.trim()) return parsed[key]!.trim();
  } catch {}
  return value.replace(/\s+/g, " ").trim();
}

function summarize(value: string) {
  const compact = captionFrom(value);
  return compact.length > 118 ? `${compact.slice(0, 115).trimEnd()}…` : compact;
}
