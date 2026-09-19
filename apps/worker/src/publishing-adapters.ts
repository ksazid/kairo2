import type { PublishMediaItem } from "@kairo/domain/publishing";
import type { PublishingAdapter, PublishingJob, ProviderPublishResult } from "./publishing";
import { channelContentFits } from "./content-channel-adapters";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PublishingSecretResolver {
  resolve(credentialRef: string): Promise<string>;
}

export interface InstagramProcessingPolicy {
  maxChecks: number;
  intervalMs: number;
  sleep(ms: number): Promise<void>;
}

const defaultProcessing: InstagramProcessingPolicy = {
  maxChecks: 10,
  intervalMs: 2000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const INSTAGRAM_RATE_LIMIT_RETRY_SECONDS = 60;
const INSTAGRAM_TRANSIENT_RETRY_SECONDS = 30;
const INSTAGRAM_RATE_LIMIT_CODES = new Set([4, 17, 613]);

export class LinkedInOrganizationAdapter implements PublishingAdapter {
  readonly channel = "linkedin" as const;

  constructor(
    private secrets: PublishingSecretResolver,
    private apiVersion: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  supports(job: PublishingJob) {
    return (
      job.contentType === "text" &&
      channelContentFits("linkedin", job.contentType, job.content) &&
      /^urn:li:organization:\d+$/.test(job.accountRef)
    );
  }

  async publish(job: PublishingJob): Promise<ProviderPublishResult> {
    const token = await credential(this.secrets, job.credentialRef);
    if (!token) return { status: "failed", failureCode: "credential-unavailable", retryable: false };

    try {
      const response = await this.fetchImpl("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "linkedin-version": requiredVersion(this.apiVersion),
          "x-restli-protocol-version": "2.0.0",
        },
        body: JSON.stringify({
          author: job.accountRef,
          commentary: job.content,
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
      });
      if (response.status === 201) {
        const id = response.headers.get("x-restli-id");
        return id ? { status: "published", externalPostId: id } : { status: "unknown" };
      }
      return failure(response);
    } catch {
      return { status: "unknown" };
    }
  }
}

export class InstagramProfessionalAdapter implements PublishingAdapter {
  readonly channel = "instagram" as const;
  private processing: InstagramProcessingPolicy;

  constructor(
    private secrets: PublishingSecretResolver,
    private graphVersion: string,
    private fetchImpl: FetchLike = fetch,
    processing?: Partial<InstagramProcessingPolicy>,
    private authMethod: "facebook-login" | "instagram-login" = "facebook-login",
  ) {
    this.processing = {
      ...defaultProcessing,
      ...processing,
      sleep: processing?.sleep ?? defaultProcessing.sleep,
    };
  }

  supports(job: PublishingJob) {
    if ((job.authMethod ?? "facebook-login") !== this.authMethod) return false;
    if (!channelContentFits("instagram", job.contentType, job.content) || !/^\d+$/.test(job.accountRef)) return false;
    const items = media(job);
    if (job.contentType === "image") {
      return items.length === 1 && items[0]?.kind === "image" && safeMedia(items[0].url);
    }
    if (job.contentType === "reel") {
      return items.length === 1 && items[0]?.kind === "video" && safeMedia(items[0].url);
    }
    if (job.contentType === "carousel") {
      return items.length >= 2 && items.length <= 10 && items.every((item) => item.kind === "image" && safeMedia(item.url));
    }
    return false;
  }

  async publish(job: PublishingJob): Promise<ProviderPublishResult> {
    const token = await credential(this.secrets, job.credentialRef);
    if (!token) return { status: "failed", failureCode: "credential-unavailable", retryable: false };
    const host = this.authMethod === "instagram-login" ? "graph.instagram.com" : "graph.facebook.com";
    const base = `https://${host}/${requiredGraph(this.graphVersion)}`;

    try {
      if (job.contentType === "image") return this.publishImage(base, token, job);
      if (job.contentType === "reel") return this.publishReel(base, token, job);
      if (job.contentType === "carousel") return this.publishCarousel(base, token, job);
      return { status: "manual-required", reason: `instagram ${job.contentType} publishing is unavailable` };
    } catch {
      return { status: "unknown" };
    }
  }

  private async publishImage(base: string, token: string, job: PublishingJob): Promise<ProviderPublishResult> {
    let container: string | undefined;
    try {
      const item = media(job)[0];
      const create = await this.post(base, token, job.accountRef, "media", { image_url: item?.url, caption: job.content });
      if (!create.ok) return instagramFailure(create);
      container = (await create.json() as { id?: string }).id;
      if (!container) return { status: "unknown" };
      return this.publishContainer(base, token, job.accountRef, container);
    } catch {
      return { status: "unknown", ...(container ? { providerCorrelationId: container } : {}) };
    }
  }

  private async publishReel(base: string, token: string, job: PublishingJob): Promise<ProviderPublishResult> {
    let container: string | undefined;
    try {
      const item = media(job)[0];
      const create = await this.post(base, token, job.accountRef, "media", {
        media_type: "REELS",
        video_url: item?.url,
        caption: job.content,
        share_to_feed: job.options?.instagram?.shareToFeed ?? false,
      });
      if (!create.ok) return instagramFailure(create);
      container = (await create.json() as { id?: string }).id;
      if (!container) return { status: "unknown" };

      for (let check = 0; check < this.processing.maxChecks; check += 1) {
        const status = await this.fetchImpl(
          `${base}/${container}?fields=${encodeURIComponent("status_code,status")}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (!status.ok) return instagramFailure(status, container);
        const data = await status.json() as { status_code?: string };
        if (data.status_code === "FINISHED") return this.publishContainer(base, token, job.accountRef, container);
        if (data.status_code === "ERROR") {
          return {
            status: "failed",
            failureCode: "provider-media-processing-error",
            retryable: false,
            providerCorrelationId: container,
          };
        }
        if (check < this.processing.maxChecks - 1) await this.processing.sleep(this.processing.intervalMs);
      }

      return {
        status: "failed",
        failureCode: "provider-media-processing-pending",
        retryable: true,
        providerCorrelationId: container,
      };
    } catch {
      return { status: "unknown", ...(container ? { providerCorrelationId: container } : {}) };
    }
  }

  private async publishCarousel(base: string, token: string, job: PublishingJob): Promise<ProviderPublishResult> {
    let parent: string | undefined;
    try {
      const children: string[] = [];
      for (const item of media(job)) {
        const create = await this.post(base, token, job.accountRef, "media", {
          image_url: item.url,
          is_carousel_item: true,
        });
        if (!create.ok) return instagramFailure(create);
        const id = (await create.json() as { id?: string }).id;
        if (!id) return { status: "unknown" };
        children.push(id);
      }

      const createParent = await this.post(base, token, job.accountRef, "media", {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: job.content,
      });
      if (!createParent.ok) return instagramFailure(createParent);
      parent = (await createParent.json() as { id?: string }).id;
      if (!parent) return { status: "unknown" };
      return this.publishContainer(base, token, job.accountRef, parent);
    } catch {
      return { status: "unknown", ...(parent ? { providerCorrelationId: parent } : {}) };
    }
  }

  private post(base: string, token: string, accountRef: string, path: string, body: unknown) {
    return this.fetchImpl(`${base}/${accountRef}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async publishContainer(
    base: string,
    token: string,
    accountRef: string,
    container: string,
  ): Promise<ProviderPublishResult> {
    const publish = await this.post(base, token, accountRef, "media_publish", { creation_id: container });
    if (!publish.ok) return instagramFailure(publish, container);
    const id = (await publish.json() as { id?: string }).id;
    if(!id)return { status: "unknown", providerCorrelationId: container };
    try{const response=await this.fetchImpl(`${base}/${encodeURIComponent(id)}?fields=permalink`,{headers:{authorization:`Bearer ${token}`}});if(response.ok){const data=await response.json() as{permalink?:unknown};if(typeof data.permalink==="string"&&data.permalink.startsWith("https://"))return{status:"published",externalPostId:id,providerCorrelationId:container,publishedUrl:data.permalink}}}catch{}
    return { status: "published", externalPostId: id, providerCorrelationId: container };
  }
}

export class FacebookPageAdapter implements PublishingAdapter {
  readonly channel = "facebook" as const;
  constructor(private secrets: PublishingSecretResolver, private graphVersion: string, private fetchImpl: FetchLike = fetch) {}
  supports(job: PublishingJob) {
    if (job.authMethod !== "facebook-login" || !/^\d+$/.test(job.accountRef) || !channelContentFits("facebook", job.contentType, job.content)) return false;
    if (job.contentType === "text") return true;
    const items = media(job);
    return job.contentType === "image" && items.length === 1 && items[0]?.kind === "image" && safeMedia(items[0].url);
  }
  async publish(job: PublishingJob): Promise<ProviderPublishResult> {
    const token = await credential(this.secrets, job.credentialRef);
    if (!token) return { status: "failed", failureCode: "credential-unavailable", retryable: false };
    const base = `https://graph.facebook.com/${requiredGraph(this.graphVersion)}/${job.accountRef}`;
    try {
      const image = job.contentType === "image" ? media(job)[0] : undefined;
      const response = await this.fetchImpl(`${base}/${image ? "photos" : "feed"}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(image ? { url: image.url, caption: job.content, published: true } : { message: job.content }) });
      if (!response.ok) return failure(response);
      const result = await response.json() as { id?: unknown; post_id?: unknown };
      const id = typeof result.post_id === "string" ? result.post_id : typeof result.id === "string" ? result.id : undefined;
      return id ? { status: "published", externalPostId: id } : { status: "unknown" };
    } catch { return { status: "unknown" }; }
  }
}

function media(job: PublishingJob): PublishMediaItem[] {
  if (Array.isArray(job.mediaItems) && job.mediaItems.length) return job.mediaItems;
  const kind = job.contentType === "image" || job.contentType === "carousel" ? "image" : "video";
  return (job.mediaUrls ?? []).map((url) => ({ kind, url }));
}

function failure(response: Response, correlation?: string): ProviderPublishResult {
  const retryable = response.status === 429 || response.status >= 500;
  const retry = Number(response.headers.get("retry-after"));
  return {
    status: "failed",
    failureCode: `provider-http-${response.status}`,
    retryable,
    ...(Number.isFinite(retry) && retry >= 0 ? { retryAfterSeconds: retry } : {}),
    ...(correlation ? { providerCorrelationId: correlation } : {}),
  };
}

async function instagramFailure(response: Response, correlation?: string): Promise<ProviderPublishResult> {
  const providerError = await instagramProviderError(response);
  const rateLimited = response.status === 429 || (providerError?.code !== undefined && INSTAGRAM_RATE_LIMIT_CODES.has(providerError.code));
  const transient = rateLimited || response.status >= 500 || providerError?.is_transient === true;
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  const fallback = rateLimited
    ? INSTAGRAM_RATE_LIMIT_RETRY_SECONDS
    : transient
      ? INSTAGRAM_TRANSIENT_RETRY_SECONDS
      : undefined;

  return {
    status: "failed",
    failureCode: `provider-http-${response.status}`,
    retryable: transient,
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : fallback !== undefined ? { retryAfterSeconds: fallback } : {}),
    ...(correlation ? { providerCorrelationId: correlation } : {}),
  };
}

async function instagramProviderError(response: Response): Promise<{ code?: number; is_transient?: boolean } | null> {
  try {
    const body = await response.clone().json() as { error?: { code?: unknown; is_transient?: unknown } };
    if (!body?.error || typeof body.error !== "object") return null;
    return {
      ...(typeof body.error.code === "number" && Number.isFinite(body.error.code) ? { code: body.error.code } : {}),
      ...(typeof body.error.is_transient === "boolean" ? { is_transient: body.error.is_transient } : {}),
    };
  } catch {
    return null;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function requiredVersion(value: string) {
  if (!/^\d{6}$/.test(value)) throw new Error("LinkedIn API version must use YYYYMM");
  return value;
}

function requiredGraph(value: string) {
  if (!/^v\d+\.\d+$/.test(value)) throw new Error("Instagram Graph version is invalid");
  return value;
}

function safeMedia(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !isPrivate(host);
  } catch {
    return false;
  }
}

function isPrivate(host: string) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    host.startsWith("[fc") ||
    host.startsWith("[fd") ||
    host.startsWith("[fe8") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

async function credential(resolver: PublishingSecretResolver, ref: string) {
  try {
    const value = (await resolver.resolve(ref)).trim();
    return value || null;
  } catch {
    return null;
  }
}
