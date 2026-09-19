export type CreationFormat = "image" | "reel" | "carousel" | "campaign";

export type CampaignSummary = {
  id: string;
  ideaId: string;
  name: string;
  status: "draft";
  createdAt: string;
};

export type IdeaSummary = {
  id: string;
  title: string;
  status: "new" | "researching" | "research-ready" | "angles-ready";
  createdAt: string;
};

export type ContinueItem = {
  id: string;
  kind: "campaign" | "idea";
  title: string;
  context: string;
  href: string;
  occurredAt: string;
};

export type ViralConcept = {
  format: Exclude<CreationFormat, "campaign">;
  sourceLabel: string;
  title: string;
  reason: string;
};

export function selectHomeOpportunities<T>(authenticated: boolean, persisted: readonly T[], preview: readonly T[]): T[] {
  return [...(authenticated ? persisted : persisted.length ? persisted : preview)];
}

export function normalizeCreationFormat(value: string | null | undefined): CreationFormat {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "post" || normalized === "image") return "image";
  if (normalized === "carousel") return "carousel";
  if (normalized === "campaign") return "campaign";
  return "reel";
}

export function creationFormatLabel(format: CreationFormat): "Post" | "Reel" | "Carousel" | "Campaign" {
  if (format === "image") return "Post";
  if (format === "carousel") return "Carousel";
  if (format === "campaign") return "Campaign";
  return "Reel";
}

export function viralConcept(value: string): ViralConcept {
  const url = publicHttpUrl(value);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const isInstagram = hostname === "instagram.com" || hostname.endsWith(".instagram.com");
  const isTikTok = hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
  const isYouTube = hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
  if (isInstagram || isTikTok || isYouTube) {
    const sourceLabel = isInstagram ? "Instagram" : isTikTok ? "TikTok" : "YouTube";
    return {
      format: "reel",
      sourceLabel,
      title: `Adapt this ${sourceLabel} idea for your Brand`,
      reason: "A short vertical video preserves the original viewing pattern while Kairo rewrites the angle for your audience.",
    };
  }
  return {
    format: "carousel",
    sourceLabel: hostname,
    title: "Turn this source into a save-worthy Brand story",
    reason: "A carousel gives Kairo room to distil the useful points while keeping the final content easy to scan.",
  };
}

export function buildContinueItems(brandId: string, campaigns: CampaignSummary[], ideas: IdeaSummary[]): ContinueItem[] {
  const base = `/brands/${encodeURIComponent(brandId)}`;
  const campaignIdeaIds = new Set(campaigns.map((campaign) => campaign.ideaId));
  return [
    ...campaigns.map((campaign): ContinueItem => ({
      id: campaign.id,
      kind: "campaign",
      title: campaign.name,
      context: "Draft content in progress",
      href: `/campaigns/${encodeURIComponent(campaign.id)}?brand=${encodeURIComponent(brandId)}`,
      occurredAt: campaign.createdAt,
    })),
    ...ideas.filter((idea) => !campaignIdeaIds.has(idea.id)).map((idea): ContinueItem => ({
      id: idea.id,
      kind: "idea",
      title: idea.title,
      context: idea.status === "angles-ready" ? "Direction ready" : idea.status === "research-ready" ? "Research ready" : "Idea in progress",
      href: `${base}/ideas/${encodeURIComponent(idea.id)}`,
      occurredAt: idea.createdAt,
    })),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 3);
}

export function creationDestination(
  brandId: string,
  creation: { campaignId?: string; assetId?: string },
): string | null {
  if (!creation.campaignId) return null;
  const brand = encodeURIComponent(brandId);
  const campaign = encodeURIComponent(creation.campaignId);
  if (creation.assetId) return `/content/${campaign}/${encodeURIComponent(creation.assetId)}?brand=${brand}`;
  return `/campaigns/${campaign}?brand=${brand}`;
}

function publicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Use a public http(s) link.");
  }
  if (!['http:', 'https:'].includes(url.protocol) || !isPublicHostname(url.hostname)) {
    throw new Error("Use a public http(s) link.");
  }
  return url;
}

function isPublicHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  if (hostname === "::1" || hostname === "0.0.0.0") return false;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ipv4) {
    if (ipv4.some((part) => part > 255)) return false;
    const [a, b] = ipv4;
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31)) return false;
  }
  return !/^(fc|fd|fe8|fe9|fea|feb)/i.test(hostname);
}
