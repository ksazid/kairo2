import type { InstagramProfileSnapshot, MetaInstagramOAuthPort, MetaInstagramDiscoveredAccount } from "./instagram-connection";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const REQUIRED_SCOPES = [
  "pages_show_list",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
  "instagram_manage_insights",
] as const;
const MIN_INSIGHTS_TOKEN_LIFETIME_SECONDS = 8 * 24 * 60 * 60;
const CONSERVATIVE_EXTENDED_TOKEN_LIFETIME_SECONDS = 60 * 24 * 60 * 60;

export class MetaInstagramOAuthClient implements MetaInstagramOAuthPort {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly graphVersion: string,
    private readonly redirectUri: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    required(this.appId, "META_APP_ID");
    required(this.appSecret, "META_APP_SECRET");
    graph(this.graphVersion);
    httpsUrl(this.redirectUri, "META_OAUTH_REDIRECT_URI");
  }

  authorizationUrl(state: string): string {
    const url = new URL(`https://www.facebook.com/${graph(this.graphVersion)}/dialog/oauth`);
    url.searchParams.set("client_id", this.appId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", required(state, "OAuth state"));
    url.searchParams.set("scope", REQUIRED_SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  async exchangeAndDiscover(code: string): Promise<{ grantedScopes: string[]; userAccessToken: string; userAccessTokenExpiresInSeconds: number; accounts: MetaInstagramDiscoveredAccount[] }> {
    const shortLivedToken = await this.exchangeCode(required(code, "authorization code"));
    const extended = await this.extendUserToken(shortLivedToken);
    const grantedScopes = await this.permissions(extended.accessToken);
    const pages = await this.pages(extended.accessToken);
    const accounts: MetaInstagramDiscoveredAccount[] = [];
    for (const page of pages) {
      const ig = page.instagram_business_account;
      if (!ig?.id || !page.access_token) continue;
      const profile = await this.profile(String(ig.id), String(page.access_token));
      accounts.push({
        pageRef: String(page.id),
        pageName: String(page.name ?? page.id),
        accountRef: String(ig.id),
        displayName: profile.name || profile.username || String(ig.id),
        ...(profile.username ? { username: profile.username } : {}),
        pageAccessToken: String(page.access_token),
      });
    }
    return { grantedScopes, userAccessToken: extended.accessToken, userAccessTokenExpiresInSeconds: extended.expiresInSeconds, accounts };
  }

  async readProfileSnapshot(accountRef: string, pageAccessToken: string, pageRef?: string): Promise<InstagramProfileSnapshot> {
    const id = numericId(accountRef);
    const token = required(pageAccessToken, "Page access token");
    const profileUrl = new URL(`https://graph.facebook.com/${graph(this.graphVersion)}/${encodeURIComponent(id)}`);
    profileUrl.searchParams.set("fields", "id,username,name,biography,website,profile_picture_url,followers_count,media_count");
    const mediaUrl = new URL(`https://graph.facebook.com/${graph(this.graphVersion)}/${encodeURIComponent(id)}/media`);
    mediaUrl.searchParams.set("fields", "id,caption,media_type,media_product_type,permalink,media_url,thumbnail_url,timestamp,like_count,comments_count");
    mediaUrl.searchParams.set("limit", "25");
    const pageUrl = pageRef ? new URL(`https://graph.facebook.com/${graph(this.graphVersion)}/${encodeURIComponent(numericId(pageRef))}`) : undefined;
    pageUrl?.searchParams.set("fields", "category,about,website,phone,emails");
    const [profileResponse, mediaResponse, pageResponse] = await Promise.all([
      this.fetchImpl(profileUrl, { headers: { authorization: `Bearer ${token}` } }),
      this.fetchImpl(mediaUrl, { headers: { authorization: `Bearer ${token}` } }),
      pageUrl ? this.fetchImpl(pageUrl, { headers: { authorization: `Bearer ${token}` } }) : Promise.resolve(undefined),
    ]);
    if (!profileResponse.ok) throw providerError("instagram-profile-import", profileResponse.status);
    if (!mediaResponse.ok) throw providerError("instagram-media-import", mediaResponse.status);
    const profile = await json(profileResponse) as Record<string, unknown>;
    const page = pageResponse?.ok ? await json(pageResponse) as Record<string, unknown> : {};
    const mediaPayload = await json(mediaResponse) as { data?: unknown };
    const recentMedia = (Array.isArray(mediaPayload.data) ? mediaPayload.data : []).slice(0, 25).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const mediaId = safeString(row.id, 200); if (!mediaId) return [];
      return [{ id: mediaId, ...optionalString(row.caption, "caption", 2_200), ...optionalString(row.media_type, "mediaType", 40), ...optionalString(row.media_product_type, "mediaProductType", 40), ...optionalHttps(row.permalink, "permalink"), ...optionalHttps(row.media_url, "mediaUrl"), ...optionalHttps(row.thumbnail_url, "thumbnailUrl"), ...optionalTimestamp(row.timestamp), ...optionalCount(row.like_count, "likeCount"), ...optionalCount(row.comments_count, "commentsCount") }];
    });
    return {
      accountRef: id,
      ...optionalString(profile.username, "username", 300),
      ...optionalString(profile.name, "name", 300),
      ...optionalString(profile.biography, "biography", 2_200),
      ...optionalHttps(profile.website ?? page.website, "website"),
      ...optionalHttps(profile.profile_picture_url, "profilePictureUrl"),
      ...optionalString(page.category, "category", 300),
      ...optionalString(page.about, "businessAbout", 2_200),
      ...optionalString(page.phone, "businessPhone", 100),
      ...optionalEmails(page.emails),
      ...optionalCount(profile.followers_count, "followersCount"),
      ...optionalCount(profile.media_count, "mediaCount"),
      recentMedia,
      retrievedAt: new Date().toISOString(),
    };
  }

  private async exchangeCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });
    const response = await this.fetchImpl(`https://graph.facebook.com/${graph(this.graphVersion)}/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) throw providerError("oauth-exchange", response.status);
    const payload = await json(response) as { access_token?: unknown };
    const token = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
    if (!token) throw new Error("Meta OAuth exchange returned no access token");
    return token;
  }

  private async extendUserToken(shortLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const body = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLivedToken,
    });
    const response = await this.fetchImpl(`https://graph.facebook.com/${graph(this.graphVersion)}/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) throw providerError("long-lived-token-exchange", response.status);
    const payload = await json(response) as { access_token?: unknown; expires_in?: unknown };
    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    const expiresInSeconds = extendedTokenLifetime(payload.expires_in);
    if (!accessToken || !Number.isFinite(expiresInSeconds) || expiresInSeconds < MIN_INSIGHTS_TOKEN_LIFETIME_SECONDS) {
      throw new Error("Meta did not return a sufficiently durable Facebook User access token");
    }
    return { accessToken, expiresInSeconds };
  }

  private async permissions(userToken: string): Promise<string[]> {
    const response = await this.fetchImpl(`https://graph.facebook.com/${graph(this.graphVersion)}/me/permissions`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    if (!response.ok) throw providerError("permissions", response.status);
    const payload = await json(response) as { data?: Array<{ permission?: unknown; status?: unknown }> };
    return [...new Set((payload.data ?? [])
      .filter((item) => item.status === "granted" && typeof item.permission === "string")
      .map((item) => String(item.permission)))]
      .sort();
  }

  private async pages(userToken: string): Promise<Array<{ id: unknown; name?: unknown; access_token?: unknown; instagram_business_account?: { id?: unknown } }>> {
    const url = new URL(`https://graph.facebook.com/${graph(this.graphVersion)}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account");
    url.searchParams.set("limit", "100");
    const response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${userToken}` } });
    if (!response.ok) throw providerError("page-discovery", response.status);
    const payload = await json(response) as { data?: unknown };
    if (!Array.isArray(payload.data)) return [];
    return payload.data.filter((value): value is { id: unknown; name?: unknown; access_token?: unknown; instagram_business_account?: { id?: unknown } } => !!value && typeof value === "object" && "id" in value);
  }

  private async profile(accountRef: string, pageToken: string): Promise<{ username?: string; name?: string }> {
    const url = new URL(`https://graph.facebook.com/${graph(this.graphVersion)}/${encodeURIComponent(accountRef)}`);
    url.searchParams.set("fields", "id,username,name");
    const response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${pageToken}` } });
    if (!response.ok) throw providerError("instagram-profile", response.status);
    const payload = await json(response) as { username?: unknown; name?: unknown };
    return {
      ...(typeof payload.username === "string" && payload.username.trim() ? { username: payload.username.trim() } : {}),
      ...(typeof payload.name === "string" && payload.name.trim() ? { name: payload.name.trim() } : {}),
    };
  }
}

export function metaInstagramRequestedScopes(): readonly string[] { return REQUIRED_SCOPES; }

function extendedTokenLifetime(value: unknown): number {
  if (value === undefined || value === null) return CONSERVATIVE_EXTENDED_TOKEN_LIFETIME_SECONDS;
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.floor(numeric) : Number.NaN;
}
function providerError(operation: string, status: number): Error { return new Error(`Meta provider ${operation} failed with HTTP ${status}`); }
async function json(response: Response): Promise<unknown> { try { return await response.json(); } catch { throw new Error("Meta provider returned invalid JSON"); } }
function graph(value: string) { if (!/^v\d+\.\d+$/.test(value)) throw new Error("META_GRAPH_VERSION is invalid"); return value; }
function required(value: string, field: string) { const normalized = value.trim(); if (!normalized) throw new Error(`${field} is required`); return normalized; }
function numericId(value:string){const id=required(value,"Instagram accountRef");if(!/^\d+$/.test(id))throw new Error("Instagram accountRef must be numeric");return id}
function safeString(value:unknown,max:number){return typeof value==="string"&&value.trim()?value.trim().slice(0,max):undefined}
function optionalString(value:unknown,key:string,max:number){const normalized=safeString(value,max);return normalized?{[key]:normalized}:{}}
function optionalHttps(value:unknown,key:string){const normalized=safeString(value,2_048);if(!normalized)return{};try{const url=new URL(normalized);return url.protocol==="https:"?{[key]:url.toString()}:{} }catch{return{}}}
function optionalTimestamp(value:unknown){const normalized=safeString(value,100);if(!normalized||!Number.isFinite(Date.parse(normalized)))return{};return{timestamp:new Date(normalized).toISOString()}}
function optionalCount(value:unknown,key:string){return Number.isInteger(value)&&Number(value)>=0&&Number(value)<=Number.MAX_SAFE_INTEGER?{[key]:Number(value)}:{}}
function optionalEmails(value:unknown){if(!Array.isArray(value))return{};const emails=[...new Set(value.map(item=>safeString(item,320)?.toLowerCase()).filter((item):item is string=>Boolean(item)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item!)))].slice(0,5);return emails.length?{businessEmails:emails}:{}}
function httpsUrl(value: string, field: string) { let url: URL; try { url = new URL(value); } catch { throw new Error(`${field} must be a valid URL`); } if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`); return url.toString(); }
