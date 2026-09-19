import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DomainValidationError, ResourceNotFoundError, type KairoRepository } from "@kairo/domain";
import { ContentAssetLibraryService, type ContentAssetLibraryRepository } from "@kairo/domain/content-asset-library";
import { GOOGLE_DRIVE_FILE_SCOPE, GoogleDriveAccessError, GoogleDriveContentConnector } from "./google-drive-content-assets-client";

export interface GoogleDriveOAuthIntent {
  id: string; workspaceId: string; brandId: string; libraryId: string; accountId: string; provider: "google-drive"; stateHash: string; expiresAt: string; createdAt: string; consumedAt?: string;
}
export interface GoogleDriveProviderConnection {
  id: string; workspaceId: string; brandId: string; libraryId: string; provider: "google-drive"; credentialRef: string; grantedScopes: string[]; connectedAt: string; lastVerifiedAt: string; revokedAt?: string;
}
export interface GoogleDriveConnectionRepository {
  createIntent(intent: GoogleDriveOAuthIntent): Promise<void>;
  consumeIntent(accountId: string, stateHash: string, at: string): Promise<GoogleDriveOAuthIntent | null>;
  getConnection(accountId: string, brandId: string, libraryId: string): Promise<GoogleDriveProviderConnection | null>;
  saveConnection(accountId: string, connection: GoogleDriveProviderConnection): Promise<{ connection: GoogleDriveProviderConnection; previousCredentialRefs: string[] }>;
  markNeedsAttention(accountId: string, brandId: string, libraryId: string, at: string): Promise<void>;
  revokeConnection(accountId: string, brandId: string, libraryId: string, at: string): Promise<void>;
}
export interface GoogleDriveCredentialVault {
  store(workspaceId: string, brandId: string, credentialRef: string, plaintext: string): Promise<void>;
  resolve(credentialRef: string): Promise<string>;
  revoke(credentialRef: string): Promise<void>;
}
export interface GoogleDriveOAuthPort {
  authorizationUrl(state: string): string;
  exchange(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds: number; grantedScopes: string[] }>;
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number; grantedScopes: string[] }>;
}
interface GoogleDriveConnectorPort {
  readonly provider: "google-drive";
  partial: boolean;
  verifyFolder(fileId: string): Promise<{ id: string; name: string }>;
  listAssets(input: { externalRootRef: string; cursor?: string }): Promise<{ assets: any[]; nextCursor?: string }>;
}

export class GoogleDriveContentAssetService {
  private readonly now: () => Date;
  private readonly stateBytes: () => Uint8Array;
  private readonly id: () => string;
  private readonly assetService: ContentAssetLibraryService;

  constructor(private readonly deps: {
    brands: KairoRepository;
    libraries: ContentAssetLibraryRepository;
    connections: GoogleDriveConnectionRepository;
    vault: GoogleDriveCredentialVault;
    oauth: GoogleDriveOAuthPort;
    picker: { developerKey: string; appId: string };
    connectorFactory?: (accessToken: string) => GoogleDriveConnectorPort;
    now?: () => Date;
    stateBytes?: () => Uint8Array;
    id?: () => string;
  }) {
    this.now = deps.now ?? (() => new Date());
    this.stateBytes = deps.stateBytes ?? (() => randomBytes(32));
    this.id = deps.id ?? randomUUID;
    this.assetService = new ContentAssetLibraryService(deps.brands, deps.libraries, this.now);
  }

  async begin(accountId: string, brandId: string, libraryId: string) {
    const library = await this.requireGoogleLibrary(accountId, brandId, libraryId);
    const createdAt = this.now();
    const state = Buffer.from(this.stateBytes()).toString("base64url");
    if (state.length < 32) throw new Error("Google Drive OAuth state entropy is insufficient");
    await this.deps.connections.createIntent({
      id: this.id(), workspaceId: library.workspaceId, brandId, libraryId, accountId, provider: "google-drive",
      stateHash: hashGoogleDriveState(state), createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 10 * 60_000).toISOString(),
    });
    return { authorizationUrl: this.deps.oauth.authorizationUrl(state) };
  }

  async complete(accountId: string, code: string, state: string) {
    const now = this.now();
    const intent = await this.deps.connections.consumeIntent(text(accountId, "accountId"), hashGoogleDriveState(text(state, "state", 1_000)), now.toISOString());
    if (!intent || Date.parse(intent.expiresAt) < now.getTime()) throw new DomainValidationError("Google Drive authorization state is invalid, expired or already used");
    const library = await this.requireGoogleLibrary(accountId, intent.brandId, intent.libraryId);
    if (library.workspaceId !== intent.workspaceId) throw new ResourceNotFoundError("Content Asset Library not found");

    const exchanged = await this.deps.oauth.exchange(text(code, "authorization code", 4_096));
    if (!exchanged.grantedScopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) throw new DomainValidationError("Google Drive did not grant the required file permission");
    const refreshToken = text(exchanged.refreshToken, "Google Drive refresh token", 16_384);
    const credentialRef = `google-drive:refresh:${this.id()}`;
    await this.deps.vault.store(intent.workspaceId, intent.brandId, credentialRef, refreshToken);
    const connection: GoogleDriveProviderConnection = {
      id: this.id(), workspaceId: intent.workspaceId, brandId: intent.brandId, libraryId: intent.libraryId, provider: "google-drive", credentialRef,
      grantedScopes: [...new Set(exchanged.grantedScopes)].sort(), connectedAt: now.toISOString(), lastVerifiedAt: now.toISOString(),
    };
    let connectionSaved = false;
    let previousCredentialRefs: string[] = [];
    try {
      const saved = await this.deps.connections.saveConnection(accountId, connection);
      connectionSaved = true;
      previousCredentialRefs = saved.previousCredentialRefs.filter((ref) => ref !== credentialRef);
      await this.deps.libraries.clearIndexedAssets(accountId, intent.brandId, intent.libraryId);
      await this.deps.libraries.updateProviderState(accountId, intent.brandId, intent.libraryId, { status: "connected", clearRoot: true });
      for (const previous of previousCredentialRefs) await this.deps.vault.revoke(previous);
    } catch (error) {
      if (connectionSaved) {
        await this.deps.connections.revokeConnection(accountId, intent.brandId, intent.libraryId, now.toISOString()).catch(() => undefined);
        await this.deps.libraries.updateProviderState(accountId, intent.brandId, intent.libraryId, { status: "needs-attention", clearRoot: true }).catch(() => undefined);
      }
      await this.deps.vault.revoke(credentialRef).catch(() => undefined);
      for (const previous of previousCredentialRefs) await this.deps.vault.revoke(previous).catch(() => undefined);
      throw error;
    }
    return { brandId: intent.brandId, libraryId: intent.libraryId, status: "connected" as const };
  }

  async pickerConfig(accountId: string, brandId: string, libraryId: string) {
    await this.requireGoogleLibrary(accountId, brandId, libraryId);
    const refreshed = await this.refreshAccess(accountId, brandId, libraryId);
    return { accessToken: refreshed.accessToken, expiresInSeconds: refreshed.expiresInSeconds, developerKey: this.deps.picker.developerKey, appId: this.deps.picker.appId };
  }

  async selectRoot(accountId: string, brandId: string, libraryId: string, fileId: string) {
    await this.requireGoogleLibrary(accountId, brandId, libraryId);
    const refreshed = await this.refreshAccess(accountId, brandId, libraryId);
    const connector = this.connector(refreshed.accessToken);
    try {
      const folder = await connector.verifyFolder(text(fileId, "Google Drive folder id", 512));
      await this.deps.libraries.clearIndexedAssets(accountId, brandId, libraryId);
      const library = await this.deps.libraries.updateProviderState(accountId, brandId, libraryId, { status: "connected", externalRootRef: folder.id, providerLabel: folder.name });
      return { library, folder };
    } catch (error) {
      await this.handleProviderError(accountId, brandId, libraryId, error);
      throw error;
    }
  }

  async index(accountId: string, brandId: string, libraryId: string) {
    const library = await this.requireGoogleLibrary(accountId, brandId, libraryId);
    if (!library.externalRootRef) throw new DomainValidationError("Choose a Google Drive folder before indexing");
    const refreshed = await this.refreshAccess(accountId, brandId, libraryId);
    const connector = this.connector(refreshed.accessToken);
    try {
      const assets = await this.assetService.replaceFromConnector(accountId, brandId, libraryId, connector);
      await this.deps.libraries.updateProviderState(accountId, brandId, libraryId, { status: connector.partial ? "needs-attention" : "connected" });
      return { indexedCount: assets.length, partial: connector.partial };
    } catch (error) {
      await this.handleProviderError(accountId, brandId, libraryId, error);
      throw error;
    }
  }

  async disconnect(accountId: string, brandId: string, libraryId: string) {
    await this.requireGoogleLibrary(accountId, brandId, libraryId);
    const connection = await this.deps.connections.getConnection(accountId, brandId, libraryId);
    if (connection) await this.deps.vault.revoke(connection.credentialRef);
    await this.deps.connections.revokeConnection(accountId, brandId, libraryId, this.now().toISOString());
    await this.deps.libraries.clearIndexedAssets(accountId, brandId, libraryId);
    await this.deps.libraries.updateProviderState(accountId, brandId, libraryId, { status: "not-connected", clearRoot: true });
  }

  private async refreshAccess(accountId: string, brandId: string, libraryId: string) {
    const connection = await this.deps.connections.getConnection(accountId, brandId, libraryId);
    if (!connection) throw new DomainValidationError("Connect Google Drive before continuing");
    let refreshToken: string;
    try {
      refreshToken = await this.deps.vault.resolve(connection.credentialRef);
    } catch {
      await this.handleProviderError(accountId, brandId, libraryId, null, true);
      throw new DomainValidationError("Google Drive access needs attention. Reconnect this library and try again.");
    }
    try {
      return await this.deps.oauth.refresh(refreshToken);
    } catch (error) {
      if (error instanceof GoogleDriveAccessError && error.reason === "authorization") {
        await this.handleProviderError(accountId, brandId, libraryId, error);
        throw new DomainValidationError("Google Drive access needs attention. Reconnect this library and try again.");
      }
      if (error instanceof GoogleDriveAccessError) throw new DomainValidationError("Google Drive is temporarily unavailable. Try again.");
      throw error;
    }
  }

  private async requireGoogleLibrary(accountId: string, brandId: string, libraryId: string) {
    const brand = await this.deps.brands.getBrandForAccount(text(accountId, "accountId"), text(brandId, "brandId"));
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    const library = await this.deps.libraries.getLibrary(accountId, brandId, text(libraryId, "libraryId"));
    if (!library || library.workspaceId !== brand.workspaceId) throw new ResourceNotFoundError("Content Asset Library not found");
    if (library.provider !== "google-drive") throw new DomainValidationError("This Content Asset Library is not a Google Drive library");
    return library;
  }

  private connector(accessToken: string) { return this.deps.connectorFactory?.(accessToken) ?? new GoogleDriveContentConnector(accessToken); }

  private async handleProviderError(accountId: string, brandId: string, libraryId: string, error: unknown, force = false) {
    if (force || (error instanceof GoogleDriveAccessError && error.reason === "authorization")) {
      await this.deps.connections.markNeedsAttention(accountId, brandId, libraryId, this.now().toISOString()).catch(() => undefined);
      await this.deps.libraries.updateProviderState(accountId, brandId, libraryId, { status: "needs-attention" }).catch(() => undefined);
    }
  }
}

export function hashGoogleDriveState(state: string) { return createHash("sha256").update(state).digest("hex"); }
function text(value: unknown, field: string, max = 300) { if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`); const normalized = value.trim(); if (normalized.length > max) throw new DomainValidationError(`${field} is too long`); return normalized; }
