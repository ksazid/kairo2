import { cookies } from "next/headers";
import { loadAccessibleBrandDirectory, resolveAccessibleBrand, workspaceForBrand } from "./brand-access";
import { buildContinueItems, type CampaignSummary, type ContinueItem, type CreationFormat, type IdeaSummary } from "./home";
import { settingsFallback, type PresenterResponse, type SettingsChannel, type SettingsData } from "./settings-data";
import type { ConceptMockupView } from "./concept-mockup";

export type HomeOpportunity = {
  id: string;
  title: string;
  rationale?: string;
  whyNow?: string;
  developmentDirection?: string;
  status?: "new" | "saved" | "ignored" | "developing";
  createdAt?: string;
  updatedAt?: string;
  scores?: { relevance?: number; audienceFit?: number; overall?: number };
  details?: {
    recommendedFormat?: string;
    recommendedChannel?: string;
    proposedAngle?: string;
    hook?: string;
    targetAudience?: string;
    objective?: string;
    confidence?: number;
    source?: string;
    evidenceSource?: string;
  };
  intelligence?: {
    schemaVersion: "2";
    title: string;
    sanitizedSummary: string;
    whyNow: string;
    proposedAngle: string;
    evidence: { confidence: number; confidenceLabel: "High" | "Medium" | "Emerging"; signalIds: string[] };
    explanation: { whyRecommended: string; evidenceSummary: string; brandFitReason: string; uncertainty?: string; userControl: string };
    provenance: { rankingVersion: string; eeiVersion: string; hunterRunId: string };
  };
  conceptMockup?: ConceptMockupView;
  conceptMockupGeneratedAt?: string;
};

export type HomeData = {
  authenticated: boolean;
  brandId?: string;
  brandName: string;
  opportunities: HomeOpportunity[];
  continueItems: ContinueItem[];
  learning?: { statement: string; interpretation?: string };
};

export type CampaignView = {
  id: string;
  workspaceId: string;
  brandId: string;
  ideaId: string;
  name: string;
  objective: string;
  status: "draft" | "in-progress" | "scheduled" | "published";
  createdAt: string;
};

export type ContentAssetView = {
  id: string;
  campaignId: string;
  channel: "linkedin" | "instagram" | "facebook" | "manual";
  format: string;
  audience: string;
  topic: string;
  hookType: string;
  cta: string;
  currentVersion: number;
  status: "draft";
  createdAt: string;
};

export type ContentVersionView = {
  id: string;
  assetId: string;
  version: number;
  content: string;
  actor: "user" | "ai";
  createdAt: string;
  libraryAssetRefs?: Array<{ kind: "image" | "video" | "document" | "other"; previewRef?: string }>;
};

export type CampaignDetailView = {
  campaign: CampaignView;
  assets: Array<{ asset: ContentAssetView; versions: ContentVersionView[] }>;
};

export type ContentReviewStatusView = {
  review: { versionId: string; status: "review" | "revision-required" | "passed" | "archived"; critic?: { score: number; findings: Array<{ message: string }> } } | null;
  approval: { versionId: string; approvedAt: string; destination?: { channel: "linkedin" | "instagram" | "facebook" | "manual"; accountRef: string } } | null;
};

export type ChannelAccountView = {
  id: string;
  channel: "linkedin" | "instagram" | "facebook" | "manual";
  accountRef: string;
  displayName: string;
  capabilities: Array<"publish-text" | "publish-image" | "publish-video" | "publish-carousel" | "publish-reel">;
  status: "connected" | "reconnect-required" | "disabled";
};

export type PublishCommandView = {
  assetId: string;
  versionId: string;
  scheduledFor: string;
  status: "scheduled" | "dispatching" | "published" | "failed" | "unknown" | "manual-required" | "cancelled";
  createdAt: string;
};

export type ContentData = HomeData & {
  details: CampaignDetailView[];
  reviews: Record<string, ContentReviewStatusView | null>;
  commands: PublishCommandView[];
  channelAccounts: ChannelAccountView[];
};

export type SimpleCreation = {
  id: string;
  status: "queued" | "understanding-goal" | "researching" | "choosing-angle" | "building-campaign" | "ready" | "needs-attention";
  progress: { message: string };
  campaignId?: string;
  assetId?: string;
  failureReason?: string;
};

export type ManualHunterRun = {
  evidenceCount: number;
  candidateCount: number;
  opportunityCount: number;
  degradedSources?: string[];
};

export type CreatedBrand = {
  id: string;
  name: string;
  workspaceId: string;
  runtime?: string;
};

const apiBase = () => (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

async function accessToken() {
  return (await cookies()).get("kairo_access_token")?.value ?? null;
}

function api(token: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body != null) headers.set("content-type", "application/json");
  return fetch(`${apiBase()}${path}`, { ...init, cache: "no-store", headers });
}

async function bodyOrError<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? fallback);
  }
  return await response.json() as T;
}

function emptyHomeData(authenticated: boolean, requestedBrandId?: string): HomeData {
  return {
    authenticated,
    brandName: authenticated ? (requestedBrandId ? "Brand unavailable" : "Choose Brand") : "Preview Brand",
    opportunities: [],
    continueItems: [],
  };
}

export async function getHomeData(requestedBrandId?: string): Promise<HomeData> {
  const token = await accessToken();
  if (!token) return emptyHomeData(false, requestedBrandId);

  const directory = await loadAccessibleBrandDirectory({ token, apiBase: apiBase() });
  if (!directory.authenticated) return emptyHomeData(false, requestedBrandId);

  const brand = resolveAccessibleBrand(directory.brands, requestedBrandId);
  if (!brand) return emptyHomeData(true, requestedBrandId);

  const base = `/api/v1/brands/${encodeURIComponent(brand.id)}`;
  const [opportunitiesResponse, campaignsResponse, ideasResponse, learningsResponse] = await Promise.all([
    api(token, `${base}/opportunities`),
    api(token, `${base}/campaigns`),
    api(token, `${base}/ideas`),
    api(token, `${base}/learnings`),
  ]);
  const rawOpportunities = opportunitiesResponse.ok ? await opportunitiesResponse.json() as HomeOpportunity[] : [];
  const opportunities = await Promise.all(rawOpportunities.map(async (opportunity) => {
    if (!opportunity.conceptMockup) return opportunity;
    const assetsResponse = await api(token, `${base}/opportunities/${encodeURIComponent(opportunity.id)}/concept-assets`);
    if (!assetsResponse.ok) return opportunity;
    const assets = await assetsResponse.json() as NonNullable<ConceptMockupView["assets"]>;
    return { ...opportunity, conceptMockup: { ...opportunity.conceptMockup, assets } };
  }));
  const campaigns = campaignsResponse.ok ? await campaignsResponse.json() as CampaignSummary[] : [];
  const ideas = ideasResponse.ok ? await ideasResponse.json() as IdeaSummary[] : [];
  const learnings = learningsResponse.ok ? await learningsResponse.json() as Array<{ statement: string; interpretation?: string; status: string; createdAt: string }> : [];
  const learning = learnings.filter((item) => item.status === "accepted").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    authenticated: true,
    brandId: brand.id,
    brandName: brand.name,
    opportunities,
    continueItems: buildContinueItems(brand.id, campaigns, ideas),
    ...(learning ? { learning: { statement: learning.statement, ...(learning.interpretation ? { interpretation: learning.interpretation } : {}) } } : {}),
  };
}

export async function createBrand(input: { brandName: string; publicSourceUrl: string }): Promise<CreatedBrand> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to add a Brand.");
  const directory = await loadAccessibleBrandDirectory({ token, apiBase: apiBase() });
  if (!directory.authenticated) throw new Error("Sign in to add a Brand.");

  const workspace = directory.workspaces[0];
  const brand = workspace
    ? await bodyOrError<CreatedBrand>(
        await api(token, `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/brands`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
        "Kairo could not create this Brand.",
      )
    : (await bodyOrError<{ workspace: { id: string }; brand: CreatedBrand }>(
        await api(token, "/api/v1/workspaces", {
          method: "POST",
          body: JSON.stringify({
            workspaceName: input.brandName,
            brandName: input.brandName,
            publicSourceUrl: input.publicSourceUrl,
          }),
        }),
        "Kairo could not create your first workspace and Brand.",
      )).brand;

  const bootstrapResponse = await api(token, `/api/v1/brands/${encodeURIComponent(brand.id)}/brain/bootstrap`, {
    method: "POST",
    body: JSON.stringify({ publicReferenceUrl: input.publicSourceUrl }),
  });
  const runtime = bootstrapResponse.headers.get("x-kairo-runtime") ?? undefined;
  await bodyOrError(bootstrapResponse, "The Brand was created, but Kairo could not build its Brand Brain.");
  return { ...brand, ...(runtime ? { runtime } : {}) };
}

export async function getSettingsData(requestedBrandId?: string): Promise<SettingsData> {
  const token = await accessToken();
  if (!token) return settingsFallback();

  const directory = await loadAccessibleBrandDirectory({ token, apiBase: apiBase() });
  if (!directory.authenticated) return settingsFallback();

  const account = {
    ...(directory.account?.id ? { id: directory.account.id } : {}),
    displayName: directory.account?.displayName ?? directory.account?.email ?? "Kairo member",
    ...(directory.account?.email ? { email: directory.account.email } : {}),
  };
  const brand = resolveAccessibleBrand(directory.brands, requestedBrandId);
  const workspace = workspaceForBrand(directory.workspaces, brand) ?? (!requestedBrandId ? directory.workspaces[0] ?? null : null);

  if (!brand) {
    return {
      authenticated: true,
      account,
      workspace,
      brand: null,
      channels: [],
      presenter: null,
    };
  }

  const base = `/api/v1/brands/${encodeURIComponent(brand.id)}`;
  const [channelsResponse, presenterResponse] = await Promise.all([
    api(token, `${base}/channel-accounts`),
    api(token, `${base}/presenter`),
  ]);
  return {
    authenticated: true,
    account,
    workspace,
    brand,
    channels: channelsResponse.ok ? await channelsResponse.json() as SettingsChannel[] : [],
    presenter: presenterResponse.ok ? await presenterResponse.json() as PresenterResponse : null,
  };
}

export async function saveSettingsPresenter(brandId: string, body: Record<string, unknown>): Promise<PresenterResponse> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to save this presenter.");
  return bodyOrError<PresenterResponse>(
    await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/presenter`, { method: "PUT", body: JSON.stringify(body) }),
    "Kairo could not save this presenter.",
  );
}

export async function getContentData(requestedBrandId?: string): Promise<ContentData> {
  const identity = await getHomeData(requestedBrandId);
  if (!identity.authenticated || !identity.brandId) return { ...identity, details: [], reviews: {}, commands: [], channelAccounts: [] };
  const token = await accessToken();
  if (!token) return { ...identity, details: [], reviews: {}, commands: [], channelAccounts: [] };
  const brand = encodeURIComponent(identity.brandId);
  const [campaignsResponse, commandsResponse, accountsResponse] = await Promise.all([
    api(token, `/api/v1/brands/${brand}/campaigns`),
    api(token, `/api/v1/brands/${brand}/calendar`),
    api(token, `/api/v1/brands/${brand}/channel-accounts`),
  ]);
  const campaigns = campaignsResponse.ok ? await campaignsResponse.json() as CampaignView[] : [];
  const commands = commandsResponse.ok ? await commandsResponse.json() as PublishCommandView[] : [];
  const channelAccounts = accountsResponse.ok ? await accountsResponse.json() as ChannelAccountView[] : [];
  const details = await Promise.all(campaigns.map(async (campaign) => {
    const response = await api(token, `/api/v1/brands/${brand}/campaigns/${encodeURIComponent(campaign.id)}`);
    return response.ok ? await response.json() as CampaignDetailView : { campaign, assets: [] };
  }));
  const assets = details.flatMap((detail) => detail.assets.map((entry) => entry.asset));
  const reviews = Object.fromEntries(await Promise.all(assets.map(async (asset) => {
    const response = await api(token, `/api/v1/brands/${brand}/assets/${encodeURIComponent(asset.id)}/review-status`);
    return [asset.id, response.ok ? await response.json() as ContentReviewStatusView : null] as const;
  })));
  return { ...identity, details, reviews, commands, channelAccounts };
}

export async function saveContentVersion(brandId: string, campaignId: string, assetId: string, input: { expectedVersion: number; content: string }): Promise<CampaignDetailView> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to save this content.");
  return bodyOrError<CampaignDetailView>(await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}/versions`, { method: "POST", body: JSON.stringify(input) }), "Kairo could not save this content version.");
}

export async function reviewContentVersion(brandId: string, campaignId: string, assetId: string, expectedVersion: number) {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to review this content.");
  return bodyOrError<ContentReviewStatusView["review"]>(await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}/review`, { method: "POST", body: JSON.stringify({ expectedVersion, brandContextVersion: `${brandId}@current`, revisionCycle: 0 }) }), "Kairo could not review this content version.");
}

export async function approveContentVersion(brandId: string, campaignId: string, assetId: string, input: { expectedVersion: number; destination: ChannelAccountView }) {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to approve this content.");
  return bodyOrError<ContentReviewStatusView["approval"]>(await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}/approve`, { method: "POST", body: JSON.stringify({ expectedVersion: input.expectedVersion, destination: { channel: input.destination.channel, accountRef: input.destination.accountRef } }) }), "Kairo could not approve this content version.");
}

export async function scheduleContentVersion(brandId: string, campaignId: string, assetId: string, input: { channelAccountId: string; contentType: "text" | "image" | "video" | "carousel"; scheduledFor: string }) {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to schedule this content.");
  return bodyOrError<PublishCommandView>(await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}/schedule`, { method: "POST", body: JSON.stringify(input) }), "Kairo could not schedule this content.");
}

export async function startHomeCreation(input: {
  brandId: string;
  format: CreationFormat;
  opportunityId?: string;
  title?: string;
  direction?: string;
  source?: string;
}): Promise<SimpleCreation> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to create with Kairo.");
  const brand = encodeURIComponent(input.brandId);
  let ideaId: string | undefined;
  if (input.opportunityId) {
    const opportunity = encodeURIComponent(input.opportunityId);
    const opportunities = await bodyOrError<Array<{ id: string; status: string }>>(await api(token, `/api/v1/brands/${brand}/opportunities`), "Unable to load this opportunity.");
    if (opportunities.find((item) => item.id === input.opportunityId)?.status !== "developing") {
      await bodyOrError(await api(token, `/api/v1/brands/${brand}/opportunities/${opportunity}/develop`, { method: "POST" }), "Unable to prepare this opportunity.");
    }
    const development = await bodyOrError<{ ideaId: string }>(await api(token, `/api/v1/brands/${brand}/opportunities/${opportunity}/development`, { method: "POST" }), "Unable to develop this opportunity.");
    ideaId = development.ideaId;
  }
  const body = {
    goal: input.format === "campaign" ? "Build a coordinated campaign" : "Create useful Brand content",
    contentPreference: input.format,
    ...([input.title, input.direction].filter(Boolean).length ? { input: [input.title, input.direction].filter(Boolean).join("\n\n") } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(ideaId ? { ideaId } : {}),
  };
  return bodyOrError<SimpleCreation>(await api(token, `/api/v1/brands/${brand}/simple-creations`, { method: "POST", body: JSON.stringify(body) }), "Kairo could not start this creation.");
}

export async function getHomeCreation(brandId: string, creationId: string): Promise<SimpleCreation> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to continue.");
  return bodyOrError<SimpleCreation>(await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/simple-creations/${encodeURIComponent(creationId)}`), "Kairo could not read this creation.");
}

export async function ensureConceptAssets(brandId: string, opportunityId: string): Promise<void> {
  const token = await accessToken();
  if (!token) return;
  const response = await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/opportunities/${encodeURIComponent(opportunityId)}/concept-assets`, { method: "POST" });
  // Rendering is useful but must not block a real idea/content creation if storage is briefly unavailable.
  if (!response.ok && response.status !== 503) await bodyOrError(response, "Kairo could not prepare the concept visual.");
}

export async function actOnHomeOpportunity(brandId: string, opportunityId: string, action: "save" | "ignore"): Promise<HomeOpportunity> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to update this opportunity.");
  return bodyOrError<HomeOpportunity>(
    await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/opportunities/${encodeURIComponent(opportunityId)}/${action}`, { method: "POST" }),
    action === "save" ? "Kairo could not save this opportunity." : "Kairo could not dismiss this opportunity.",
  );
}

export async function runManualHunter(brandId: string): Promise<ManualHunterRun> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to refresh discovery.");
  return bodyOrError<ManualHunterRun>(
    await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/recommendations`, { method: "POST" }),
    "Kairo could not refresh discovery.",
  );
}

export async function getHomeOpportunities(brandId: string): Promise<HomeOpportunity[]> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to load discovery.");
  return bodyOrError<HomeOpportunity[]>(
    await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/opportunities`),
    "Kairo could not load discovery.",
  );
}
