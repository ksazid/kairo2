import type { CampaignDetailView, ContentReviewStatusView, PublishCommandView } from "./api";
import { contentFallback, toContentItems, type ContentItem } from "./content";

export type CampaignStatus = "draft" | "in-progress" | "scheduled" | "published";

export type CampaignItem = {
  id: string;
  name: string;
  objective: string;
  previewObjective: string;
  status: CampaignStatus;
  statusLabel: string;
  image: string;
  formats: Array<"Post" | "Reel" | "Carousel">;
  channels: Array<"Instagram" | "LinkedIn" | "Facebook">;
  readyAssets: number;
  totalAssets: number;
  startsAt: string;
  endsAt: string;
  previewEndsAt: string;
  audience: string;
  message: string;
  cta: string;
  assets: ContentItem[];
};

const fallbackDates = [
  ["2024-05-20T10:00:00Z", "2024-06-30T10:00:00Z"],
  ["2024-06-10T10:00:00Z", "2024-07-15T10:00:00Z"],
  ["2024-07-01T10:00:00Z", "2024-07-31T10:00:00Z"],
] as const;

function campaignAssets(campaignId: string, campaignName: string, offset = 0): ContentItem[] {
  const base = contentFallback();
  const previewTitles = ["Malta Rental Guide Carousel", "Malta Road Trip Reel", "Malta Scenic Spots Post", "Malta Summer Wrap-up"];
  const previewStatuses: Array<Pick<ContentItem, "status" | "statusLabel">> = [
    { status: "scheduled", statusLabel: "Scheduled" },
    { status: "in-review", statusLabel: "In review" },
    { status: "draft", statusLabel: "Draft" },
    { status: "draft", statusLabel: "Draft" },
  ];
  return base.map((item, index) => ({
    ...item,
    id: `${campaignId}-asset-${index + 1}`,
    campaignId,
    campaignName,
    ...(campaignId === "malta-summer" ? { title: previewTitles[index] ?? item.title, ...previewStatuses[index] } : {}),
    image: base[(index + offset) % base.length]?.image ?? item.image,
    media: item.media.map((_, mediaIndex) => base[(index + mediaIndex + offset) % base.length]?.image ?? item.image),
  }));
}

export function campaignFallback(): CampaignItem[] {
  const definitions = [
    {
      id: "malta-summer",
      name: "Malta Summer Rental Guide",
      objective: "Drive bookings for summer rentals in Malta",
      previewObjective: "Build trust and generate more bookings",
      status: "in-progress" as const,
      audience: "Travelers planning a summer trip to Malta, interested in car rentals, road trips and local experiences.",
      message: "Reliable cars. Local tips. Unforgettable summer in Malta.",
      cta: "Book early and drive more.",
    },
    {
      id: "summer-travel",
      name: "Summer Travel Tips",
      objective: "Increase engagement with travel content",
      previewObjective: "Increase engagement with practical Malta travel content",
      status: "scheduled" as const,
      audience: "Independent travelers looking for practical local advice and memorable routes.",
      message: "See more of Malta with useful, locally informed travel guidance.",
      cta: "Save this guide for your trip.",
    },
    {
      id: "local-car-hire",
      name: "Local Car Hire Launch",
      objective: "Launch local car hire service in Malta",
      previewObjective: "Introduce a simpler local car hire experience",
      status: "draft" as const,
      audience: "Visitors who value flexible transport and straightforward local service.",
      message: "A simpler way to explore Malta on your own schedule.",
      cta: "Reserve your Malta car today.",
    },
  ];

  return definitions.map((campaign, index) => {
    const assets = campaignAssets(campaign.id, campaign.name, index);
    const dates = fallbackDates[index] ?? fallbackDates[0];
    return {
      ...campaign,
      statusLabel: statusLabel(campaign.status),
      image: assets[0]?.image ?? "/malta-car.webp",
      formats: ["Post", "Reel", "Carousel"],
      channels: ["Instagram", "LinkedIn"],
      readyAssets: 2,
      totalAssets: 4,
      startsAt: dates[0],
      endsAt: dates[1],
      previewEndsAt: index === 0 ? "2024-05-31T10:00:00Z" : dates[1],
      assets,
    };
  });
}

export function toCampaignItems(
  details: CampaignDetailView[],
  reviews: Record<string, ContentReviewStatusView | null>,
  commands: PublishCommandView[],
): CampaignItem[] {
  return details.map((detail) => {
    const assets = toContentItems([detail], reviews, commands);
    const created = new Date(detail.campaign.createdAt);
    const end = new Date(created);
    end.setUTCDate(end.getUTCDate() + 30);
    const commandStates = commands.filter((command) => assets.some((asset) => asset.id === command.assetId)).map((command) => command.status);
    const inferred: CampaignStatus = commandStates.includes("published")
      ? "published"
      : commandStates.some((status) => status === "scheduled" || status === "dispatching")
        ? "scheduled"
        : assets.length
          ? "in-progress"
          : "draft";
    const status = detail.campaign.status === "draft" ? inferred : detail.campaign.status;
    const readyAssets = assets.filter((asset) => asset.status !== "draft").length;
    const formats = Array.from(new Set(assets.map((asset) => asset.formatLabel))) as CampaignItem["formats"];
    const channels = Array.from(new Set(assets.map((asset) => asset.channel))) as CampaignItem["channels"];
    return {
      id: detail.campaign.id,
      name: detail.campaign.name,
      objective: detail.campaign.objective,
      previewObjective: detail.campaign.objective,
      status,
      statusLabel: statusLabel(status),
      image: assets[0]?.image ?? "/malta-car.webp",
      formats: formats.length ? formats : ["Post", "Reel", "Carousel"],
      channels: channels.length ? channels : ["Instagram", "LinkedIn"],
      readyAssets,
      totalAssets: Math.max(assets.length, 4),
      startsAt: created.toISOString(),
      endsAt: end.toISOString(),
      previewEndsAt: end.toISOString(),
      audience: assets[0]?.audience ?? "Your Brand's priority audience.",
      message: assets[0]?.summary ?? detail.campaign.objective,
      cta: assets[0]?.cta ?? "Learn more.",
      assets,
    };
  });
}

export function filterCampaigns(items: CampaignItem[], input: { query: string; status: "all" | CampaignStatus }) {
  const query = input.query.trim().toLowerCase();
  return items.filter((item) => {
    if (input.status !== "all" && item.status !== input.status) return false;
    return !query || [item.name, item.objective, ...item.channels, ...item.formats].some((value) => value.toLowerCase().includes(query));
  });
}

export function campaignHref(campaignId: string, brandId?: string) {
  const path = `/campaigns/${encodeURIComponent(campaignId)}`;
  return brandId ? `${path}?brand=${encodeURIComponent(brandId)}` : path;
}

export function statusLabel(status: CampaignStatus) {
  if (status === "in-progress") return "In progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
