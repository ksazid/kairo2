import { randomUUID } from "node:crypto";
import type {
  AccountDto,
  BrandBrainFieldDto,
  BrandDto,
  CreateWorkspaceWithBrandRequest,
  CreateWorkspaceWithBrandResponse,
  ExternalIdentity,
  KnowledgeSourceDto,
  PutBrandBrainFieldRequest,
  WorkspaceDto,
  WorkspaceRole,
} from "@kairo/contracts";
import {
  ConcurrencyConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type KairoRepository,
  type PreparedKnowledgeSourceInput,
  type RecordInferredBrandBrainFieldInput,
} from "@kairo/domain";

type Membership = { accountId: string; workspaceId: string; role: WorkspaceRole; active: boolean };
type StoredSource = KnowledgeSourceDto & { rawContent?: string };

export class MemoryKairoRepository implements KairoRepository {
  private readonly accounts = new Map<string, AccountDto>();
  private readonly identityAccounts = new Map<string, string>();
  private readonly workspaces = new Map<string, { id: string; name: string }>();
  private readonly memberships: Membership[] = [];
  private readonly brands = new Map<string, BrandDto>();
  private readonly brainFields = new Map<string, BrandBrainFieldDto>();
  private readonly sources = new Map<string, StoredSource>();

  private identityKey(identity: ExternalIdentity): string { return `${identity.provider}::${identity.subject}`; }
  private brainKey(brandId: string, fieldKey: string): string { return `${brandId}::${fieldKey}`; }

  async resolveAccount(identity: ExternalIdentity): Promise<AccountDto> {
    const key = this.identityKey(identity);
    const existingId = this.identityAccounts.get(key);
    if (existingId) {
      const existing = this.accounts.get(existingId);
      if (!existing) throw new Error("Identity map references a missing account");
      return existing;
    }
    const account: AccountDto = { id: randomUUID(), ...(identity.email ? { email: identity.email } : {}), ...(identity.displayName ? { displayName: identity.displayName } : {}) };
    this.accounts.set(account.id, account);
    this.identityAccounts.set(key, account.id);
    return account;
  }

  async createWorkspaceWithBrand(accountId: string, input: CreateWorkspaceWithBrandRequest): Promise<CreateWorkspaceWithBrandResponse> {
    if (!this.accounts.has(accountId)) throw new Error("Account does not exist");
    const workspaceId = randomUUID();
    const brandId = randomUUID();
    const workspace = { id: workspaceId, name: input.workspaceName };
    const brand: BrandDto = { id: brandId, workspaceId, name: input.brandName, ...(input.publicSourceUrl ? { publicSourceUrl: input.publicSourceUrl } : {}), ...(input.publicProfileUrl ? { publicProfileUrl: input.publicProfileUrl } : {}) };
    this.workspaces.set(workspaceId, workspace);
    this.memberships.push({ accountId, workspaceId, role: "owner", active: true });
    this.brands.set(brandId, brand);
    return { workspace: { ...workspace, role: "owner" }, brand };
  }

  async createBrandForAccount(accountId: string, workspaceId: string, input: { brandName: string; publicSourceUrl?: string; publicProfileUrl?: string }): Promise<BrandDto> {
    if (!(await this.hasWorkspaceAccess(accountId, workspaceId))) throw new ResourceNotFoundError("Workspace not found");
    const brand: BrandDto = { id: randomUUID(), workspaceId, name: input.brandName, ...(input.publicSourceUrl ? { publicSourceUrl: input.publicSourceUrl } : {}), ...(input.publicProfileUrl ? { publicProfileUrl: input.publicProfileUrl } : {}) };
    this.brands.set(brand.id, brand);
    return { ...brand };
  }

  async listWorkspacesForAccount(accountId: string): Promise<WorkspaceDto[]> {
    return this.memberships.filter((membership) => membership.accountId === accountId && membership.active).map((membership) => {
      const workspace = this.workspaces.get(membership.workspaceId);
      if (!workspace) throw new Error("Membership references a missing workspace");
      return { ...workspace, role: membership.role };
    });
  }

  async hasWorkspaceAccess(accountId: string, workspaceId: string): Promise<boolean> {
    return this.memberships.some((membership) => membership.accountId === accountId && membership.workspaceId === workspaceId && membership.active);
  }

  async listBrandsForAccount(accountId: string, workspaceId: string): Promise<BrandDto[]> {
    if (!(await this.hasWorkspaceAccess(accountId, workspaceId))) return [];
    return [...this.brands.values()].filter((brand) => brand.workspaceId === workspaceId);
  }

  async getBrandForAccount(accountId: string, brandId: string): Promise<BrandDto | null> {
    const brand = this.brands.get(brandId);
    if (!brand || !(await this.hasWorkspaceAccess(accountId, brand.workspaceId))) return null;
    return brand;
  }

  async deleteBrand(accountId: string, brandId: string): Promise<void> {
    const brand = await this.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    this.brands.delete(brandId);
    for (const [key, field] of this.brainFields) if (field.brandId === brandId) this.brainFields.delete(key);
    for (const [key, source] of this.sources) if (source.brandId === brandId) this.sources.delete(key);
  }

  async listBrandBrainFields(accountId: string, brandId: string): Promise<BrandBrainFieldDto[]> {
    await this.requireBrand(accountId, brandId);
    return [...this.brainFields.values()].filter((field) => field.brandId === brandId).sort((a, b) => a.fieldKey.localeCompare(b.fieldKey)).map(copyField);
  }

  async putConfirmedBrandBrainField(accountId: string, brandId: string, fieldKey: string, input: PutBrandBrainFieldRequest): Promise<BrandBrainFieldDto> {
    const brand = await this.requireBrand(accountId, brandId);
    const key = this.brainKey(brandId, fieldKey);
    const existing = this.brainFields.get(key);
    assertExpectedVersion(existing?.version, input.expectedVersion);
    const updatedAt = new Date().toISOString();
    const field: BrandBrainFieldDto = {
      id: existing?.id ?? randomUUID(),
      workspaceId: brand.workspaceId,
      brandId,
      section: input.section,
      fieldKey,
      value: input.value,
      state: "confirmed",
      sourceIds: [],
      version: (existing?.version ?? 0) + 1,
      updatedAt,
      confirmedByAccountId: accountId,
    };
    this.brainFields.set(key, field);
    return copyField(field);
  }

  async recordInferredBrandBrainField(accountId: string, brandId: string, input: RecordInferredBrandBrainFieldInput): Promise<BrandBrainFieldDto> {
    const brand = await this.requireBrand(accountId, brandId);
    for (const sourceId of input.sourceIds) {
      const source = this.sources.get(sourceId);
      if (!source || source.brandId !== brandId || source.workspaceId !== brand.workspaceId || source.status !== "active") throw new ResourceNotFoundError("Knowledge source not found");
    }
    const key = this.brainKey(brandId, input.fieldKey);
    const existing = this.brainFields.get(key);
    assertExpectedVersion(existing?.version, input.expectedVersion);
    if (existing?.state === "confirmed") return copyField(existing);
    const field: BrandBrainFieldDto = {
      id: existing?.id ?? randomUUID(),
      workspaceId: brand.workspaceId,
      brandId,
      section: input.section,
      fieldKey: input.fieldKey,
      value: input.value,
      state: "inferred",
      sourceIds: [...input.sourceIds],
      version: (existing?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.brainFields.set(key, field);
    return copyField(field);
  }

  async listKnowledgeSources(accountId: string, brandId: string): Promise<KnowledgeSourceDto[]> {
    await this.requireBrand(accountId, brandId);
    return [...this.sources.values()].filter((source) => source.brandId === brandId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(toSourceDto);
  }

  async listActiveKnowledgeExtractsForBrandBrain(accountId: string, brandId: string) {
    if (!(await this.getBrandForAccount(accountId, brandId))) throw new ResourceNotFoundError("Brand not found");
    return [...this.sources.values()]
      .filter((source) => source.brandId === brandId && source.status === "active" && Boolean(source.rawContent))
      .map((source) => ({ sourceId: source.id, ...(source.title ? { title: source.title } : {}), ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}), excerpt: source.rawContent!.slice(0, 20_000), ...(source.contentType ? { contentType: source.contentType } : {}), updatedAt: source.updatedAt }));
  }

  async createKnowledgeSource(accountId: string, brandId: string, input: PreparedKnowledgeSourceInput): Promise<KnowledgeSourceDto> {
    const brand = await this.requireBrand(accountId, brandId);
    const now = new Date().toISOString();
    const source: StoredSource = {
      id: randomUUID(),
      workspaceId: brand.workspaceId,
      brandId,
      type: input.type,
      status: input.status,
      ...(input.title ? { title: input.title } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.rawContent ? { rawContent: input.rawContent } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.sizeBytes ? { sizeBytes: input.sizeBytes } : {}),
      ...(input.contentHash ? { contentHash: input.contentHash } : {}),
      hasPrivateContent: Boolean(input.rawContent),
      createdAt: now,
      updatedAt: now,
    };
    this.sources.set(source.id, source);
    return toSourceDto(source);
  }

  async setKnowledgeSourceStatus(accountId: string, brandId: string, sourceId: string, status: "active" | "disabled"): Promise<KnowledgeSourceDto> {
    await this.requireBrand(accountId, brandId);
    const source = this.sources.get(sourceId);
    if (!source || source.brandId !== brandId || source.status === "removed") throw new ResourceNotFoundError("Knowledge source not found");
    if (source.status === "quarantined" || source.status === "failed" || source.status === "replaced") {
      throw new DomainValidationError(`Knowledge source in ${source.status} state cannot be ${status === "active" ? "enabled" : "disabled"}`);
    }
    source.status = status;
    source.updatedAt = new Date().toISOString();
    return toSourceDto(source);
  }

  async removeKnowledgeSource(accountId: string, brandId: string, sourceId: string): Promise<KnowledgeSourceDto> {
    await this.requireBrand(accountId, brandId);
    const source = this.sources.get(sourceId);
    if (!source || source.brandId !== brandId || source.status === "removed") throw new ResourceNotFoundError("Knowledge source not found");
    const now = new Date().toISOString();
    for (const [key, field] of this.brainFields.entries()) {
      if (field.brandId !== brandId || !field.sourceIds.includes(sourceId)) continue;
      const remaining = field.sourceIds.filter((id) => id !== sourceId);
      const updated: BrandBrainFieldDto = {
        ...field,
        sourceIds: remaining,
        ...(field.state === "inferred" && remaining.length === 0 ? { state: "stale" as const } : {}),
        version: field.version + 1,
        updatedAt: now,
      };
      this.brainFields.set(key, updated);
    }
    const tombstone: StoredSource = {
      id: source.id,
      workspaceId: source.workspaceId,
      brandId: source.brandId,
      type: source.type,
      status: "removed",
      hasPrivateContent: false,
      createdAt: source.createdAt,
      updatedAt: now,
      removedAt: now,
    };
    this.sources.set(sourceId, tombstone);
    return toSourceDto(tombstone);
  }

  private async requireBrand(accountId: string, brandId: string): Promise<BrandDto> {
    const brand = await this.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    return brand;
  }
}

function assertExpectedVersion(actual: number | undefined, expected: number | undefined): void {
  if (expected === undefined) return;
  if (actual !== expected) throw new ConcurrencyConflictError("Brand Brain field changed; reload and retry");
}

function copyField(field: BrandBrainFieldDto): BrandBrainFieldDto { return { ...field, sourceIds: [...field.sourceIds] }; }

function toSourceDto(source: StoredSource): KnowledgeSourceDto {
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    brandId: source.brandId,
    type: source.type,
    status: source.status,
    ...(source.title ? { title: source.title } : {}),
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
    ...(source.contentType ? { contentType: source.contentType } : {}),
    ...(source.sizeBytes ? { sizeBytes: source.sizeBytes } : {}),
    ...(source.contentHash ? { contentHash: source.contentHash } : {}),
    hasPrivateContent: source.hasPrivateContent,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    ...(source.removedAt ? { removedAt: source.removedAt } : {}),
  };
}
