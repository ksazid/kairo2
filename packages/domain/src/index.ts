import type {
  AccountDto,
  BrandBrainFieldDto,
  BrandBrainSection,
  BrandDto,
  CreateKnowledgeSourceRequest,
  CreateWorkspaceWithBrandRequest,
  CreateWorkspaceWithBrandResponse,
  ExternalIdentity,
  KnowledgeSourceDto,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  PutBrandBrainFieldRequest,
  WorkspaceDto,
} from "@kairo/contracts";

export class DomainValidationError extends Error {
  readonly code = "validation_error";
}

export class ResourceNotFoundError extends Error {
  readonly code = "resource_not_found";
}

export class ConcurrencyConflictError extends Error {
  readonly code = "concurrency_conflict";
}

export interface RecordInferredBrandBrainFieldInput {
  section: BrandBrainSection;
  fieldKey: string;
  value: string;
  sourceIds: string[];
  expectedVersion?: number;
}

export interface PreparedKnowledgeSourceInput {
  type: KnowledgeSourceType;
  status: "active" | "quarantined";
  title?: string;
  sourceUrl?: string;
  rawContent?: string;
  contentType?: string;
  sizeBytes?: number;
  contentHash?: string;
}

export interface PrivateObjectStoragePort {
  deletePrivateObject(objectKey: string): Promise<void>;
}

export interface MalwareScannerPort {
  scanPrivateObject(objectKey: string): Promise<"clean" | "infected" | "failed">;
}

export interface KairoRepository {
  resolveAccount(identity: ExternalIdentity): Promise<AccountDto>;
  createWorkspaceWithBrand(
    accountId: string,
    input: CreateWorkspaceWithBrandRequest,
  ): Promise<CreateWorkspaceWithBrandResponse>;
  listWorkspacesForAccount(accountId: string): Promise<WorkspaceDto[]>;
  hasWorkspaceAccess(accountId: string, workspaceId: string): Promise<boolean>;
  listBrandsForAccount(accountId: string, workspaceId: string): Promise<BrandDto[]>;
  getBrandForAccount(accountId: string, brandId: string): Promise<BrandDto | null>;
  deleteBrand?(accountId: string, brandId: string): Promise<void>;

  listBrandBrainFields(accountId: string, brandId: string): Promise<BrandBrainFieldDto[]>;
  putConfirmedBrandBrainField(
    accountId: string,
    brandId: string,
    fieldKey: string,
    input: PutBrandBrainFieldRequest,
  ): Promise<BrandBrainFieldDto>;
  recordInferredBrandBrainField(
    accountId: string,
    brandId: string,
    input: RecordInferredBrandBrainFieldInput,
  ): Promise<BrandBrainFieldDto>;

  listKnowledgeSources(accountId: string, brandId: string): Promise<KnowledgeSourceDto[]>;
  listActiveKnowledgeExtractsForBrandBrain?(
    accountId: string,
    brandId: string,
  ): Promise<Array<{ sourceId: string; title?: string; sourceUrl?: string; excerpt: string; contentType?: string; updatedAt: string }>>;
  createKnowledgeSource(
    accountId: string,
    brandId: string,
    input: PreparedKnowledgeSourceInput,
  ): Promise<KnowledgeSourceDto>;
  setKnowledgeSourceStatus(
    accountId: string,
    brandId: string,
    sourceId: string,
    status: "active" | "disabled",
  ): Promise<KnowledgeSourceDto>;
  removeKnowledgeSource(accountId: string, brandId: string, sourceId: string): Promise<KnowledgeSourceDto>;
}

const BRAIN_SECTIONS = new Set<BrandBrainSection>([
  "identity",
  "positioning",
  "audience",
  "voice",
  "content-strategy",
  "goals",
  "boundaries",
]);
const SOURCE_TYPES = new Set<KnowledgeSourceType>(["url", "website", "document", "note", "pasted", "research", "product"]);
const TEXT_SOURCE_TYPES = new Set<KnowledgeSourceType>(["note", "pasted", "research", "product"]);
const DOCUMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const FIELD_KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_BRAIN_VALUE = 10_000;
const MAX_PRIVATE_TEXT = 100_000;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function requiredText(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== "string") throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(`${field} is required`);
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new DomainValidationError(`${field} must be text`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function optionalHttpUrl(value: unknown, field: string): string | undefined {
  const text = optionalText(value, field, 2_048);
  if (!text) return undefined;
  return normalizePublicHttpUrl(text, field);
}

function normalizePublicHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainValidationError(`${field} must be a valid HTTP(S) URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DomainValidationError(`${field} must be a valid HTTP(S) URL`);
  }
  if (url.username || url.password) throw new DomainValidationError(`${field} must not contain credentials`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isUnsafeIpLiteral(host)) {
    throw new DomainValidationError(`${field} must use a public host`);
  }
  return url.toString();
}

function isUnsafeIpLiteral(host: string): boolean {
  if (host.includes(":")) return true; // IPv6 literals stay fail-closed until the ingestion worker performs network-range checks.
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function normalizeFieldKey(value: unknown): string {
  const fieldKey = requiredText(value, "fieldKey", 80).toLowerCase();
  if (!FIELD_KEY.test(fieldKey)) throw new DomainValidationError("fieldKey contains unsupported characters");
  return fieldKey;
}

function normalizeSection(value: unknown): BrandBrainSection {
  if (typeof value !== "string" || !BRAIN_SECTIONS.has(value as BrandBrainSection)) {
    throw new DomainValidationError("section is not supported");
  }
  return value as BrandBrainSection;
}

function normalizeExpectedVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) throw new DomainValidationError("expectedVersion must be a positive integer");
  return value as number;
}

function normalizeSourceType(value: unknown): KnowledgeSourceType {
  if (typeof value !== "string" || !SOURCE_TYPES.has(value as KnowledgeSourceType)) {
    throw new DomainValidationError("source type is not supported");
  }
  return value as KnowledgeSourceType;
}

function prepareKnowledgeSource(input: CreateKnowledgeSourceRequest): PreparedKnowledgeSourceInput {
  const type = normalizeSourceType(input.type);
  const title = optionalText(input.title, "title", 200);

  if (type === "url" || type === "website") {
    const sourceUrl = normalizePublicHttpUrl(requiredText(input.url, "url", 2_048), "url");
    if (input.content !== undefined) throw new DomainValidationError("URL source content is fetched only by an approved ingestion worker");
    return { type, status: "active", ...(title ? { title } : {}), sourceUrl };
  }

  if (type === "document") {
    if (input.content !== undefined) throw new DomainValidationError("document bytes cannot be submitted through the metadata API");
    const contentType = requiredText(input.contentType, "contentType", 160).toLowerCase();
    if (!DOCUMENT_CONTENT_TYPES.has(contentType)) throw new DomainValidationError("document contentType is not supported");
    if (!Number.isInteger(input.sizeBytes) || (input.sizeBytes ?? 0) < 1 || (input.sizeBytes ?? 0) > MAX_DOCUMENT_BYTES) {
      throw new DomainValidationError("document sizeBytes must be between 1 byte and 25 MiB");
    }
    const contentHash = requiredText(input.contentHash, "contentHash", 64).toLowerCase();
    if (!SHA256.test(contentHash)) throw new DomainValidationError("contentHash must be a SHA-256 hex digest");
    return {
      type,
      status: "quarantined",
      ...(title ? { title } : {}),
      contentType,
      sizeBytes: input.sizeBytes as number,
      contentHash,
    };
  }

  if (TEXT_SOURCE_TYPES.has(type)) {
    const rawContent = requiredText(input.content, "content", MAX_PRIVATE_TEXT);
    if (input.url !== undefined) throw new DomainValidationError(`${type} sources do not accept a URL`);
    return { type, status: "active", ...(title ? { title } : {}), rawContent };
  }

  throw new DomainValidationError("source type is not supported");
}

export class KairoService {
  constructor(private readonly repository: KairoRepository) {}

  async establishSession(identity: ExternalIdentity): Promise<AccountDto> {
    const provider = requiredText(identity.provider, "identity provider", 500);
    const subject = requiredText(identity.subject, "identity subject", 500);
    return this.repository.resolveAccount({
      provider,
      subject,
      ...(identity.email?.trim() ? { email: identity.email.trim() } : {}),
      ...(identity.displayName?.trim() ? { displayName: identity.displayName.trim() } : {}),
    });
  }

  async createInitialWorkspace(
    accountId: string,
    input: CreateWorkspaceWithBrandRequest,
  ): Promise<CreateWorkspaceWithBrandResponse> {
    const workspaceName = requiredText(input.workspaceName, "workspaceName", 120);
    const brandName = requiredText(input.brandName, "brandName", 120);
    const publicSourceUrl = optionalHttpUrl(input.publicSourceUrl, "publicSourceUrl");
    const publicProfileUrl = optionalHttpUrl(input.publicProfileUrl, "publicProfileUrl");
    return this.repository.createWorkspaceWithBrand(accountId, {
      workspaceName,
      brandName,
      ...(publicSourceUrl ? { publicSourceUrl } : {}),
      ...(publicProfileUrl ? { publicProfileUrl } : {}),
    });
  }

  listWorkspaces(accountId: string): Promise<WorkspaceDto[]> {
    return this.repository.listWorkspacesForAccount(accountId);
  }

  async listBrands(accountId: string, workspaceId: string): Promise<BrandDto[]> {
    if (!(await this.repository.hasWorkspaceAccess(accountId, workspaceId))) throw new ResourceNotFoundError("Workspace not found");
    return this.repository.listBrandsForAccount(accountId, workspaceId);
  }

  async getBrand(accountId: string, brandId: string): Promise<BrandDto> {
    const brand = await this.repository.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    return brand;
  }

  async deleteBrand(accountId: string, brandId: string): Promise<void> {
    await this.getBrand(accountId, brandId);
    if (!this.repository.deleteBrand) throw new DomainValidationError("Brand deletion is not configured");
    return this.repository.deleteBrand(accountId, brandId);
  }

  async listBrandBrain(accountId: string, brandId: string): Promise<BrandBrainFieldDto[]> {
    await this.getBrand(accountId, brandId);
    return this.repository.listBrandBrainFields(accountId, brandId);
  }

  async putBrandBrainField(
    accountId: string,
    brandId: string,
    fieldKeyInput: string,
    input: PutBrandBrainFieldRequest,
  ): Promise<BrandBrainFieldDto> {
    await this.getBrand(accountId, brandId);
    const fieldKey = normalizeFieldKey(fieldKeyInput);
    const section = normalizeSection(input.section);
    const value = requiredText(input.value, "value", MAX_BRAIN_VALUE);
    const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
    return this.repository.putConfirmedBrandBrainField(accountId, brandId, fieldKey, {
      section,
      value,
      ...(expectedVersion ? { expectedVersion } : {}),
    });
  }

  async recordInferredBrandBrainField(
    accountId: string,
    brandId: string,
    input: RecordInferredBrandBrainFieldInput,
  ): Promise<BrandBrainFieldDto> {
    await this.getBrand(accountId, brandId);
    const section = normalizeSection(input.section);
    const fieldKey = normalizeFieldKey(input.fieldKey);
    const value = requiredText(input.value, "value", MAX_BRAIN_VALUE);
    const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
    const sourceIds = [...new Set(input.sourceIds.map((sourceId) => requiredText(sourceId, "sourceId", 200)))];
    if (!sourceIds.length) throw new DomainValidationError("inferred Brand Brain fields require at least one source");
    return this.repository.recordInferredBrandBrainField(accountId, brandId, {
      section,
      fieldKey,
      value,
      sourceIds,
      ...(expectedVersion ? { expectedVersion } : {}),
    });
  }

  async listKnowledgeSources(accountId: string, brandId: string): Promise<KnowledgeSourceDto[]> {
    await this.getBrand(accountId, brandId);
    return this.repository.listKnowledgeSources(accountId, brandId);
  }

  async createKnowledgeSource(
    accountId: string,
    brandId: string,
    input: CreateKnowledgeSourceRequest,
  ): Promise<KnowledgeSourceDto> {
    await this.getBrand(accountId, brandId);
    return this.repository.createKnowledgeSource(accountId, brandId, prepareKnowledgeSource(input));
  }

  async setKnowledgeSourceStatus(
    accountId: string,
    brandId: string,
    sourceIdInput: string,
    status: "active" | "disabled",
  ): Promise<KnowledgeSourceDto> {
    await this.getBrand(accountId, brandId);
    const sourceId = requiredText(sourceIdInput, "sourceId", 200);
    return this.repository.setKnowledgeSourceStatus(accountId, brandId, sourceId, status);
  }

  async removeKnowledgeSource(accountId: string, brandId: string, sourceIdInput: string): Promise<KnowledgeSourceDto> {
    await this.getBrand(accountId, brandId);
    const sourceId = requiredText(sourceIdInput, "sourceId", 200);
    return this.repository.removeKnowledgeSource(accountId, brandId, sourceId);
  }
}

export type {
  AccountDto,
  BrandBrainFieldDto,
  BrandBrainSection,
  BrandDto,
  CreateKnowledgeSourceRequest,
  CreateWorkspaceWithBrandRequest,
  CreateWorkspaceWithBrandResponse,
  ExternalIdentity,
  KnowledgeSourceDto,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  PutBrandBrainFieldRequest,
  WorkspaceDto,
};

export { evaluateBrandDnaReadiness, type BrandDnaReadinessOptions } from "./brand-dna-readiness";
