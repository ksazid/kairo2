import { describe, expect, it } from "vitest";
import type {
  AccountDto,
  BrandBrainFieldDto,
  BrandDto,
  CreateKnowledgeSourceRequest,
  CreateWorkspaceWithBrandRequest,
  CreateWorkspaceWithBrandResponse,
  ExternalIdentity,
  KnowledgeSourceDto,
  PreparedKnowledgeSourceInput,
  PutBrandBrainFieldRequest,
  RecordInferredBrandBrainFieldInput,
  WorkspaceDto,
} from "./index";
import { DomainValidationError, KairoService, ResourceNotFoundError } from "./index";

class FakeRepository {
  account: AccountDto = { id: "account-1", email: "owner@example.com" };
  workspaceAccess = true;
  brand: BrandDto | null = { id: "brand-1", workspaceId: "workspace-1", name: "Kairo" };
  lastIdentity: ExternalIdentity | null = null;
  lastCreation: CreateWorkspaceWithBrandRequest | null = null;
  lastBrainWrite: { fieldKey: string; input: PutBrandBrainFieldRequest } | null = null;
  lastInference: RecordInferredBrandBrainFieldInput | null = null;
  lastSource: PreparedKnowledgeSourceInput | null = null;

  async resolveAccount(identity: ExternalIdentity): Promise<AccountDto> { this.lastIdentity = identity; return this.account; }
  async createWorkspaceWithBrand(_accountId: string, input: CreateWorkspaceWithBrandRequest): Promise<CreateWorkspaceWithBrandResponse> {
    this.lastCreation = input;
    return { workspace: { id: "workspace-1", name: input.workspaceName, role: "owner" }, brand: { id: "brand-1", workspaceId: "workspace-1", name: input.brandName } };
  }
  async listWorkspacesForAccount(): Promise<WorkspaceDto[]> { return [{ id: "workspace-1", name: "Studio", role: "owner" }]; }
  async hasWorkspaceAccess(): Promise<boolean> { return this.workspaceAccess; }
  async listBrandsForAccount(): Promise<BrandDto[]> { return this.brand ? [this.brand] : []; }
  async getBrandForAccount(): Promise<BrandDto | null> { return this.brand; }
  async listBrandBrainFields(): Promise<BrandBrainFieldDto[]> { return []; }
  async putConfirmedBrandBrainField(_accountId: string, _brandId: string, fieldKey: string, input: PutBrandBrainFieldRequest): Promise<BrandBrainFieldDto> {
    this.lastBrainWrite = { fieldKey, input };
    return { id: "field-1", workspaceId: "workspace-1", brandId: "brand-1", section: input.section, fieldKey, value: input.value, state: "confirmed", sourceIds: [], version: 1, updatedAt: "2026-08-12T00:00:00.000Z", confirmedByAccountId: "account-1" };
  }
  async recordInferredBrandBrainField(_accountId: string, _brandId: string, input: RecordInferredBrandBrainFieldInput): Promise<BrandBrainFieldDto> {
    this.lastInference = input;
    return { id: "field-2", workspaceId: "workspace-1", brandId: "brand-1", section: input.section, fieldKey: input.fieldKey, value: input.value, state: "inferred", sourceIds: input.sourceIds, version: 1, updatedAt: "2026-08-12T00:00:00.000Z" };
  }
  async listKnowledgeSources(): Promise<KnowledgeSourceDto[]> { return []; }
  async createKnowledgeSource(_accountId: string, _brandId: string, input: PreparedKnowledgeSourceInput): Promise<KnowledgeSourceDto> {
    this.lastSource = input;
    return { id: "source-1", workspaceId: "workspace-1", brandId: "brand-1", type: input.type, status: input.status, ...(input.title ? { title: input.title } : {}), ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}), ...(input.contentType ? { contentType: input.contentType } : {}), ...(input.sizeBytes ? { sizeBytes: input.sizeBytes } : {}), ...(input.contentHash ? { contentHash: input.contentHash } : {}), hasPrivateContent: Boolean(input.rawContent), createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" };
  }
  async setKnowledgeSourceStatus(_accountId: string, _brandId: string, _sourceId: string, status: "active" | "disabled"): Promise<KnowledgeSourceDto> {
    return { id: "source-1", workspaceId: "workspace-1", brandId: "brand-1", type: "note", status, hasPrivateContent: true, createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" };
  }
  async removeKnowledgeSource(): Promise<KnowledgeSourceDto> {
    return { id: "source-1", workspaceId: "workspace-1", brandId: "brand-1", type: "note", status: "removed", hasPrivateContent: false, createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z", removedAt: "2026-08-12T00:00:00.000Z" };
  }
}

describe("KairoService", () => {
  it("rejects incomplete external identities", async () => {
    const service = new KairoService(new FakeRepository());
    await expect(service.establishSession({ provider: "oidc", subject: "  " })).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("normalizes identity data before resolving the account", async () => {
    const repository = new FakeRepository();
    const service = new KairoService(repository);
    await service.establishSession({ provider: " issuer ", subject: " user-1 ", email: " owner@example.com " });
    expect(repository.lastIdentity).toEqual({ provider: "issuer", subject: "user-1", email: "owner@example.com" });
  });

  it("normalizes the initial workspace and brand command", async () => {
    const repository = new FakeRepository();
    const service = new KairoService(repository);
    await service.createInitialWorkspace("account-1", { workspaceName: " Studio ", brandName: " Kairo ", publicSourceUrl: "https://example.com" });
    expect(repository.lastCreation).toEqual({ workspaceName: "Studio", brandName: "Kairo", publicSourceUrl: "https://example.com/" });
  });

  it("hides a foreign brand", async () => {
    const repository = new FakeRepository();
    repository.brand = null;
    const service = new KairoService(repository);
    await expect(service.getBrand("account-2", "brand-1")).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("records user corrections as normalized confirmed Brand Brain writes", async () => {
    const repository = new FakeRepository();
    const service = new KairoService(repository);
    const field = await service.putBrandBrainField("account-1", "brand-1", " Voice.Tone ", { section: "voice", value: " Clear and technical ", expectedVersion: 2 });
    expect(repository.lastBrainWrite).toEqual({ fieldKey: "voice.tone", input: { section: "voice", value: "Clear and technical", expectedVersion: 2 } });
    expect(field.state).toBe("confirmed");
  });

  it("requires source-backed inferred Brand Brain fields", async () => {
    const service = new KairoService(new FakeRepository());
    await expect(service.recordInferredBrandBrainField("account-1", "brand-1", { section: "audience", fieldKey: "audience.primary", value: "Founders", sourceIds: [] })).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects local and private literal URL knowledge sources", async () => {
    const service = new KairoService(new FakeRepository());
    for (const url of ["http://localhost/admin", "http://127.0.0.1/", "http://169.254.169.254/latest", "http://192.168.1.10/"]) {
      await expect(service.createKnowledgeSource("account-1", "brand-1", { type: "url", url })).rejects.toBeInstanceOf(DomainValidationError);
    }
  });

  it("registers documents as quarantined metadata only", async () => {
    const repository = new FakeRepository();
    const service = new KairoService(repository);
    const input: CreateKnowledgeSourceRequest = { type: "document", title: "Positioning", contentType: "application/pdf", sizeBytes: 1000, contentHash: "a".repeat(64) };
    const source = await service.createKnowledgeSource("account-1", "brand-1", input);
    expect(repository.lastSource).toMatchObject({ type: "document", status: "quarantined", contentType: "application/pdf", sizeBytes: 1000 });
    expect(source.status).toBe("quarantined");
  });

  it("does not accept document bytes through the metadata API", async () => {
    const service = new KairoService(new FakeRepository());
    await expect(service.createKnowledgeSource("account-1", "brand-1", { type: "document", content: "raw bytes", contentType: "application/pdf", sizeBytes: 10, contentHash: "b".repeat(64) })).rejects.toBeInstanceOf(DomainValidationError);
  });
});
