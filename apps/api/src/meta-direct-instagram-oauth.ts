import type { InstagramProfileSnapshot } from "./instagram-connection";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DIRECT_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
] as const;

export interface DirectInstagramIdentity {
  accountRef: string;
  displayName: string;
  username?: string;
  accessToken: string;
  expiresInSeconds: number;
  grantedScopes: string[];
}

export interface DirectInstagramOAuthPort {
  authorizationUrl(state: string): string;
  exchangeAndDiscover(code: string): Promise<DirectInstagramIdentity>;
  readProfileSnapshot(accountRef: string, accessToken: string): Promise<InstagramProfileSnapshot>;
}

export class MetaDirectInstagramOAuthClient implements DirectInstagramOAuthPort {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly graphVersion: string,
    private readonly redirectUri: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    required(appId, "META_INSTAGRAM_APP_ID");
    required(appSecret, "META_INSTAGRAM_APP_SECRET");
    graph(graphVersion);
    httpsUrl(redirectUri, "META_INSTAGRAM_OAUTH_REDIRECT_URI");
  }

  authorizationUrl(state: string): string {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", this.appId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", DIRECT_SCOPES.join(","));
    url.searchParams.set("state", required(state, "OAuth state"));
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    return url.toString();
  }

  async exchangeAndDiscover(code: string): Promise<DirectInstagramIdentity> {
    const body = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
      code: required(code, "authorization code"),
    });
    const exchange = await this.fetchImpl("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!exchange.ok) throw providerError("oauth-exchange", exchange.status);
    const short = await json(exchange) as { access_token?: unknown; user_id?: unknown; permissions?: unknown };
    const shortToken = string(short.access_token);
    const initialId = numeric(short.user_id);
    if (!shortToken || !initialId) throw new Error("Instagram Login returned an incomplete identity");

    const extendUrl = new URL("https://graph.instagram.com/access_token");
    extendUrl.searchParams.set("grant_type", "ig_exchange_token");
    extendUrl.searchParams.set("client_secret", this.appSecret);
    extendUrl.searchParams.set("access_token", shortToken);
    const extended = await this.fetchImpl(extendUrl);
    if (!extended.ok) throw providerError("long-lived-token-exchange", extended.status);
    const durable = await json(extended) as { access_token?: unknown; expires_in?: unknown };
    const accessToken = string(durable.access_token);
    const expiresInSeconds = integer(durable.expires_in);
    if (!accessToken || expiresInSeconds < 8 * 24 * 60 * 60) throw new Error("Instagram Login did not return a sufficiently durable token");

    const profile = await this.profile(initialId, accessToken);
    return {
      accountRef: profile.user_id ?? profile.id ?? initialId,
      displayName: profile.name ?? profile.username ?? initialId,
      ...(profile.username ? { username: profile.username } : {}),
      accessToken,
      expiresInSeconds,
      grantedScopes: scopes(short.permissions),
    };
  }

  async readProfileSnapshot(accountRef: string, accessToken: string): Promise<InstagramProfileSnapshot> {
    const id = numeric(accountRef);
    if (!id) throw new Error("Instagram accountRef must be numeric");
    const token = required(accessToken, "Instagram access token");
    const profileUrl = new URL(`https://graph.instagram.com/${graph(this.graphVersion)}/${id}`);
    profileUrl.searchParams.set("fields", "id,user_id,username,name,biography,website,profile_picture_url,followers_count,media_count");
    const mediaUrl = new URL(`https://graph.instagram.com/${graph(this.graphVersion)}/${id}/media`);
    mediaUrl.searchParams.set("fields", "id,caption,media_type,media_product_type,permalink,media_url,thumbnail_url,timestamp,like_count,comments_count");
    mediaUrl.searchParams.set("limit", "25");
    const [profileResponse, mediaResponse] = await Promise.all([
      this.fetchImpl(profileUrl, { headers: { authorization: `Bearer ${token}` } }),
      this.fetchImpl(mediaUrl, { headers: { authorization: `Bearer ${token}` } }),
    ]);
    if (!profileResponse.ok) throw providerError("profile-import", profileResponse.status);
    if (!mediaResponse.ok) throw providerError("media-import", mediaResponse.status);
    const profile = await json(profileResponse) as Record<string, unknown>;
    const media = await json(mediaResponse) as { data?: unknown };
    return {
      accountRef: numeric(profile.user_id ?? profile.id) ?? id,
      ...optionalString(profile.username, "username", 300),
      ...optionalString(profile.name, "name", 300),
      ...optionalString(profile.biography, "biography", 2_200),
      ...optionalHttps(profile.website, "website"),
      ...optionalHttps(profile.profile_picture_url, "profilePictureUrl"),
      ...optionalCount(profile.followers_count, "followersCount"),
      ...optionalCount(profile.media_count, "mediaCount"),
      recentMedia: (Array.isArray(media.data) ? media.data : []).slice(0, 25).flatMap((value) => mediaItem(value)),
      retrievedAt: new Date().toISOString(),
    };
  }

  private async profile(id: string, token: string): Promise<{ id?: string; user_id?: string; username?: string; name?: string }> {
    const url = new URL(`https://graph.instagram.com/${graph(this.graphVersion)}/me`);
    url.searchParams.set("fields", "id,user_id,username,name");
    const response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw providerError("profile", response.status);
    const payload = await json(response) as Record<string, unknown>;
    return {
      ...(numeric(payload.id) ? { id: numeric(payload.id) } : {}),
      ...(numeric(payload.user_id) ? { user_id: numeric(payload.user_id) } : {}),
      ...(string(payload.username) ? { username: string(payload.username) } : {}),
      ...(string(payload.name) ? { name: string(payload.name) } : {}),
    };
  }
}

export function metaDirectInstagramRequestedScopes(): readonly string[] { return DIRECT_SCOPES; }

function mediaItem(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const id = string(row.id)?.slice(0, 200);
  if (!id) return [];
  return [{ id, ...optionalString(row.caption, "caption", 2_200), ...optionalString(row.media_type, "mediaType", 40), ...optionalString(row.media_product_type, "mediaProductType", 40), ...optionalHttps(row.permalink, "permalink"), ...optionalHttps(row.media_url, "mediaUrl"), ...optionalHttps(row.thumbnail_url, "thumbnailUrl"), ...optionalTimestamp(row.timestamp), ...optionalCount(row.like_count, "likeCount"), ...optionalCount(row.comments_count, "commentsCount") }];
}
function scopes(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()))].sort() : [...DIRECT_SCOPES]; }
function string(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numeric(value: unknown): string | undefined { const valueString = typeof value === "number" ? String(value) : string(value); return valueString && /^\d+$/.test(valueString) ? valueString : undefined; }
function integer(value: unknown): number { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? Math.floor(parsed) : 0; }
function optionalString(value: unknown, key: string, max: number) { const normalized = string(value)?.slice(0, max); return normalized ? { [key]: normalized } : {}; }
function optionalHttps(value: unknown, key: string) { const normalized = string(value); if (!normalized) return {}; try { const url = new URL(normalized); return url.protocol === "https:" ? { [key]: url.toString() } : {}; } catch { return {}; } }
function optionalCount(value: unknown, key: string) { if(value===null||value===undefined||value==="")return{};const count=typeof value==="number"?value:Number(value);return Number.isSafeInteger(count)&&count>=0?{[key]:count}:{}; }
function optionalTimestamp(value: unknown) { const normalized = string(value); return normalized && Number.isFinite(Date.parse(normalized)) ? { timestamp: new Date(normalized).toISOString() } : {}; }
async function json(response: Response): Promise<unknown> { try { return await response.json(); } catch { throw new Error("Meta provider returned invalid JSON"); } }
function providerError(operation: string, status: number) { return new Error(`Meta Instagram Login ${operation} failed with HTTP ${status}`); }
function required(value: string, field: string) { const normalized = value.trim(); if (!normalized) throw new Error(`${field} is required`); return normalized; }
function graph(value: string) { if (!/^v\d+\.\d+$/.test(value)) throw new Error("META_GRAPH_VERSION is invalid"); return value; }
function httpsUrl(value: string, field: string) { let url: URL; try { url = new URL(value); } catch { throw new Error(`${field} must be a valid URL`); } if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`); return url.toString(); }
