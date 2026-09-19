import { DomainValidationError } from "@kairo/domain";
import type { ContentAssetConnector, ContentAssetConnectorAsset, ContentAssetKind } from "@kairo/domain/content-asset-library";

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_LIMITS = { maxAssets: 1000, maxFolders: 200, maxPages: 50, maxDepth: 10, timeoutMs: 8_000 } as const;

type FetchLike = typeof fetch;

export class GoogleDriveAccessError extends Error {
  constructor(public readonly reason: "authorization" | "unavailable" | "invalid-response", message: string) {
    super(message);
    this.name = "GoogleDriveAccessError";
  }
}

export class GoogleDriveOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  authorizationUrl(state: string) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_DRIVE_FILE_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "false");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchange(code: string) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: "authorization_code",
      code: requiredText(code, "authorization code", 4096),
    });
    const value = await postToken(this.fetcher, body, this.timeoutMs);
    const refreshToken = requiredText(value.refresh_token, "Google refresh token", 16_384);
    return tokenResult(value, refreshToken);
  }

  async refresh(refreshToken: string) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: requiredText(refreshToken, "Google refresh token", 16_384),
    });
    const value = await postToken(this.fetcher, body, this.timeoutMs);
    return tokenResult(value);
  }
}

export class GoogleDriveContentConnector implements ContentAssetConnector {
  readonly provider = "google-drive" as const;
  partial = false;

  constructor(
    private readonly accessToken: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly limits: { maxAssets?: number; maxFolders?: number; maxPages?: number; maxDepth?: number; timeoutMs?: number } = {},
  ) {}

  async verifyFolder(fileId: string) {
    const id = requiredText(fileId, "Google Drive folder id", 512);
    const fields = "id,name,mimeType,trashed,capabilities(canListChildren)";
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("supportsAllDrives", "true");
    const item = await driveJson(this.fetcher, url, this.accessToken, this.timeout());
    if (item.trashed === true || item.mimeType !== FOLDER_MIME) throw new DomainValidationError("Select an accessible Google Drive folder");
    if (item.capabilities && item.capabilities.canListChildren === false) throw new DomainValidationError("Kairo cannot list files in the selected Google Drive folder");
    return { id: requiredText(item.id, "Google Drive folder id", 512), name: requiredText(item.name, "Google Drive folder name", 500) };
  }

  async listAssets(input: { externalRootRef: string; cursor?: string }): Promise<{ assets: ContentAssetConnectorAsset[]; nextCursor?: string }> {
    if (input.cursor) throw new DomainValidationError("Google Drive connector cursors are internal");
    const root = await this.verifyFolder(input.externalRootRef);
    const config = { ...DEFAULT_LIMITS, ...this.limits };
    const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
    const visited = new Set<string>();
    const assets: ContentAssetConnectorAsset[] = [];
    let pages = 0;

    while (queue.length && assets.length < config.maxAssets && visited.size < config.maxFolders && pages < config.maxPages) {
      const folder = queue.shift()!;
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      let pageToken: string | undefined;
      do {
        if (pages >= config.maxPages || assets.length >= config.maxAssets) { this.partial = true; break; }
        pages += 1;
        const url = childrenUrl(folder.id, pageToken);
        let result: any;
        try {
          result = await driveJson(this.fetcher, url, this.accessToken, config.timeoutMs);
        } catch (error) {
          if (folder.depth > 0 && error instanceof GoogleDriveAccessError && error.reason === "authorization") { this.partial = true; break; }
          throw error;
        }
        if (result.incompleteSearch === true) this.partial = true;
        for (const item of Array.isArray(result.files) ? result.files : []) {
          const id = typeof item?.id === "string" ? item.id.trim() : "";
          const name = typeof item?.name === "string" ? item.name.trim() : "";
          const mimeType = typeof item?.mimeType === "string" ? item.mimeType.trim() : "";
          if (!id || !name || !mimeType) { this.partial = true; continue; }
          if (mimeType === FOLDER_MIME) {
            if (folder.depth < config.maxDepth && item?.capabilities?.canListChildren !== false && queue.length + visited.size < config.maxFolders) queue.push({ id, depth: folder.depth + 1 });
            else this.partial = true;
            continue;
          }
          if (assets.length >= config.maxAssets) { this.partial = true; break; }
          const sizeBytes = parseSize(item.size);
          assets.push({
            externalId: id,
            name,
            kind: classifyMime(mimeType),
            mimeType,
            ...(sizeBytes === undefined ? {} : { sizeBytes }),
            ...(validDate(item.modifiedTime) ? { modifiedAt: new Date(item.modifiedTime).toISOString() } : {}),
            ...(safeHttps(item.webViewLink) ? { providerRef: item.webViewLink } : {}),
          });
        }
        pageToken = typeof result.nextPageToken === "string" && result.nextPageToken.trim() ? result.nextPageToken.trim() : undefined;
      } while (pageToken);
    }
    if (queue.length) this.partial = true;
    return { assets };
  }

  private timeout() { return this.limits.timeoutMs ?? DEFAULT_LIMITS.timeoutMs; }
}

function childrenUrl(folderId: string, pageToken?: string) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`);
  url.searchParams.set("fields", "nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,webViewLink,capabilities(canListChildren))");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url;
}

async function postToken(fetcher: FetchLike, body: URLSearchParams, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: controller.signal });
    const value = await response.json().catch(() => null) as any;
    if (!response.ok) throw new GoogleDriveAccessError(response.status === 400 || response.status === 401 ? "authorization" : "unavailable", "Google Drive authorization is unavailable");
    if (!value || typeof value !== "object") throw new GoogleDriveAccessError("invalid-response", "Google Drive returned an invalid token response");
    return value;
  } catch (error) {
    if (error instanceof GoogleDriveAccessError) throw error;
    throw new GoogleDriveAccessError("unavailable", "Google Drive authorization is unavailable");
  } finally { clearTimeout(timer); }
}

async function driveJson(fetcher: FetchLike, url: URL, accessToken: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { headers: { authorization: `Bearer ${requiredText(accessToken, "Google access token", 16_384)}` }, signal: controller.signal });
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new GoogleDriveAccessError("authorization", "Google Drive access needs attention");
    if (!response.ok) throw new GoogleDriveAccessError("unavailable", "Google Drive is temporarily unavailable");
    const value = await response.json().catch(() => null);
    if (!value || typeof value !== "object") throw new GoogleDriveAccessError("invalid-response", "Google Drive returned invalid metadata");
    return value;
  } catch (error) {
    if (error instanceof GoogleDriveAccessError) throw error;
    throw new GoogleDriveAccessError("unavailable", "Google Drive is temporarily unavailable");
  } finally { clearTimeout(timer); }
}

function tokenResult(value: any, forcedRefreshToken?: string) {
  const accessToken = requiredText(value.access_token, "Google access token", 16_384);
  const expiresInSeconds = Number(value.expires_in);
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > 86_400) throw new GoogleDriveAccessError("invalid-response", "Google Drive returned an invalid token lifetime");
  const grantedScopes: string[] = typeof value.scope === "string"
    ? [...new Set<string>(value.scope.split(/\s+/).filter((scope: string) => scope.length > 0))].sort()
    : [];
  return { accessToken, ...(forcedRefreshToken ? { refreshToken: forcedRefreshToken } : {}), expiresInSeconds: Math.floor(expiresInSeconds), grantedScopes };
}

function classifyMime(mimeType: string): ContentAssetKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/") || mimeType.startsWith("application/") || mimeType.startsWith("application/vnd.google-apps.")) return "document";
  return "other";
}
function requiredText(value: unknown, field: string, max: number) { if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`); const text = value.trim(); if (text.length > max) throw new DomainValidationError(`${field} is too long`); return text; }
function parseSize(value: unknown) { const size = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : typeof value === "number" ? value : NaN; return Number.isSafeInteger(size) && size >= 0 ? size : undefined; }
function validDate(value: unknown) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function safeHttps(value: unknown) { if (typeof value !== "string") return false; try { return new URL(value).protocol === "https:"; } catch { return false; } }
