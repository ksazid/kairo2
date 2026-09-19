import { presentAiText, presentOpportunityCopy } from "./ai-presentation";
import { normalizeCreationFormat, type CreationFormat } from "./home";
import type { HomeOpportunity } from "./api";
import type { ConceptMockupView } from "./concept-mockup";

export type DiscoverFilter = "all" | "trending" | "great-fit" | "saved" | "developing";

export type DiscoverCard = HomeOpportunity & {
  conceptMockup?: ConceptMockupView;
  conceptMockupGeneratedAt?: string;
  image: "/malta-car.webp" | "/malta-drive.webp" | "/car-keys.webp";
  format: CreationFormat;
  formatLabel: string;
  channel: string;
  trend: "Trending" | "Rising";
  fit: "Great fit" | "Good fit";
  opportunity: "High opportunity" | "Medium opportunity";
  source: string;
  confidence: number;
};

type OpportunityWithConcept = HomeOpportunity & {
  conceptMockup?: ConceptMockupView;
  conceptMockupGeneratedAt?: string;
};

const media = ["/malta-car.webp", "/malta-drive.webp", "/car-keys.webp"] as const;

export const discoverFallback: HomeOpportunity[] = [
  { id: "one", title: "3 mistakes customers make when renting a car in Malta", rationale: "Practical local advice positions your Brand as the helpful expert.", whyNow: "Rental car searches are rising as travel season approaches.", developmentDirection: "Build a mistake-led guide with clear local advice.", status: "new", scores: { relevance: .94, audienceFit: .91, overall: .93 }, details: { recommendedFormat: "reel", recommendedChannel: "instagram", targetAudience: "Malta travellers", objective: "Educate" } },
  { id: "two", title: "Best hidden beaches to visit in Malta", rationale: "A local-first guide gives travellers something useful to save and share.", whyNow: "Hidden-gem travel content is accelerating before the summer peak.", status: "new", scores: { relevance: .9, audienceFit: .88, overall: .89 }, details: { recommendedFormat: "reel", recommendedChannel: "instagram", targetAudience: "Experience-led travellers", objective: "Inspire" } },
  { id: "three", title: "How to get the best car rental deals", rationale: "Clear buying advice builds trust before customers compare providers.", whyNow: "Price-sensitive searches are increasing across Malta travel planning.", status: "saved", scores: { relevance: .87, audienceFit: .86, overall: .86 }, details: { recommendedFormat: "image", recommendedChannel: "linkedin", targetAudience: "Value-conscious travellers", objective: "Educate" } },
  { id: "four", title: "24 hours in Valletta: the perfect itinerary", rationale: "An itinerary connects your service to a complete and memorable day.", whyNow: "Short itinerary formats are gaining saves across destination content.", status: "new", scores: { relevance: .84, audienceFit: .82, overall: .83 }, details: { recommendedFormat: "carousel", recommendedChannel: "instagram", targetAudience: "First-time visitors", objective: "Inspire" } },
  { id: "five", title: "The Malta road-trip checklist nobody gives you", rationale: "A practical checklist turns local experience into strong Brand authority.", whyNow: "Planning-led carousels are outperforming generic destination lists.", status: "developing", scores: { relevance: .82, audienceFit: .8, overall: .81 }, details: { recommendedFormat: "carousel", recommendedChannel: "facebook", targetAudience: "Independent travellers", objective: "Educate" } },
  { id: "six", title: "Airport pickup in Malta: what to know before landing", rationale: "Answering arrival questions removes uncertainty at a high-intent moment.", whyNow: "Airport-transfer questions are rising alongside seasonal arrivals.", status: "new", scores: { relevance: .78, audienceFit: .79, overall: .79 }, details: { recommendedFormat: "image", recommendedChannel: "linkedin", targetAudience: "Business and leisure arrivals", objective: "Convert" } },
];

export function toDiscoverCards(opportunities: HomeOpportunity[]): DiscoverCard[] {
  return opportunities.filter((item) => item.status !== "ignored").map((item, index) => {
    const opportunity = item as OpportunityWithConcept;
    const score = item.scores?.overall ?? item.scores?.audienceFit ?? item.scores?.relevance ?? .75;
    // Kairo's current creation pipeline models a text-only social concept as a Post.
    // This keeps Discover aligned with the persisted concept without expanding the
    // downstream generation contract in this slice.
    const format = opportunity.conceptMockup?.format === "text"
      ? "image"
      : normalizeCreationFormat(item.details?.recommendedFormat);
    const copy = presentOpportunityCopy({
      title: item.title,
      rationale: item.rationale,
      whyNow: item.whyNow,
      developmentDirection: item.developmentDirection,
      audience: item.details?.targetAudience,
    });
    return {
      ...item,
      title: copy.title,
      rationale: copy.fit,
      whyNow: copy.timing,
      developmentDirection: copy.action,
      ...(item.details ? {
        details: {
          ...item.details,
          ...(item.details.targetAudience ? { targetAudience: copy.audience } : {}),
          ...(item.details.proposedAngle ? { proposedAngle: presentAiText(item.details.proposedAngle, "action") } : {}),
        },
      } : {}),
      ...(opportunity.conceptMockup ? { conceptMockup: opportunity.conceptMockup } : {}),
      ...(opportunity.conceptMockupGeneratedAt ? { conceptMockupGeneratedAt: opportunity.conceptMockupGeneratedAt } : {}),
      image: media[index % media.length]!,
      format,
      formatLabel: format === "image" ? "Post" : format === "carousel" ? "Carousel" : format === "campaign" ? "Campaign" : "Reel",
      channel: channelLabel(item.details?.recommendedChannel),
      trend: index % 4 === 3 ? "Rising" : "Trending",
      fit: score >= .8 ? "Great fit" : "Good fit",
      opportunity: score >= .8 ? "High opportunity" : "Medium opportunity",
      source: presentAiText(opportunity.details?.source?.trim() || opportunity.details?.evidenceSource?.trim() || "Hunter evidence", "label"),
      confidence: Math.round(score * 100),
    };
  });
}

export function filterDiscoverCards(cards: DiscoverCard[], input: { query: string; filter: DiscoverFilter; format: string; channel: string; source?: string }): DiscoverCard[] {
  const query = input.query.trim().toLowerCase();
  return cards.filter((card) => {
    if (query && ![card.title, card.rationale, card.whyNow, card.channel, card.formatLabel].filter(Boolean).some((value) => value!.toLowerCase().includes(query))) return false;
    if (input.filter === "trending" && card.trend !== "Trending") return false;
    if (input.filter === "great-fit" && card.fit !== "Great fit") return false;
    if (input.filter === "saved" && card.status !== "saved") return false;
    if (input.filter === "developing" && card.status !== "developing") return false;
    if (input.format !== "all" && card.format !== input.format) return false;
    if (input.channel !== "all" && card.channel.toLowerCase() !== input.channel) return false;
    if (input.source && input.source !== "all" && card.source.toLowerCase().replaceAll(" ", "-") !== input.source) return false;
    return true;
  });
}

export function discoverPreviewHref(id: string, brandId?: string) {
  return `/discover/${encodeURIComponent(id)}${brandId ? `?brand=${encodeURIComponent(brandId)}` : ""}`;
}

function channelLabel(value?: string) {
  const channel = value?.trim().toLowerCase();
  if (channel === "linkedin") return "LinkedIn";
  if (channel === "facebook") return "Facebook";
  if (channel === "youtube") return "YouTube";
  return "Instagram";
}
