import { describe, expect, it } from "vitest";
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
} from "@kairo/contracts";
import type {
  KairoRepository,
  PreparedKnowledgeSourceInput,
  RecordInferredBrandBrainFieldInput,
} from "./index";
import {
  BrandBrainBootstrapService,
  type BrandBrainProposalGenerator,
  type PublicBrandReferenceReader,
} from "./brand-brain-bootstrap";
import { evaluateBrandDnaReadiness } from "./brand-dna-readiness";

const NOW = "2026-08-15T18:23:00.000Z";

class FakeRepository implements KairoRepository {
  account: AccountDto = { id: "account-1" };
  brand: BrandDto = {
    id: "brand-1",
    workspaceId: "workspace-1",
    name: "The Duke 390",
    publicProfileUrl: "https://www.instagram.com/_dukeman390/",
  };
  fields: BrandBrainFieldDto[] = [];
  sources: KnowledgeSourceDto[] = [];
  activeExtracts: Array<{ sourceId: string; title?: string; sourceUrl?: string; excerpt: string; contentType?: string; updatedAt: string }> = [];

  resolveAccount(_identity: ExternalIdentity): Promise<AccountDto> { return Promise.resolve(this.account); }
  createWorkspaceWithBrand(_accountId: string, _input: CreateWorkspaceWithBrandRequest): Promise<CreateWorkspaceWithBrandResponse> { throw new Error("unused"); }
  listWorkspacesForAccount(): Promise<WorkspaceDto[]> { return Promise.resolve([]); }
  hasWorkspaceAccess(): Promise<boolean> { return Promise.resolve(true); }
  listBrandsForAccount(): Promise<BrandDto[]> { return Promise.resolve([this.brand]); }
  getBrandForAccount(): Promise<BrandDto | null> { return Promise.resolve(this.brand); }
  listBrandBrainFields(): Promise<BrandBrainFieldDto[]> { return Promise.resolve(this.fields.map((field) => ({ ...field, sourceIds: [...field.sourceIds] }))); }
  putConfirmedBrandBrainField(accountId: string, _brandId: string, fieldKey: string, input: PutBrandBrainFieldRequest): Promise<BrandBrainFieldDto> {
    const existing = this.fields.find((field) => field.fieldKey === fieldKey);
    const field: BrandBrainFieldDto = {
      id: existing?.id ?? `field-${this.fields.length + 1}`,
      workspaceId: this.brand.workspaceId,
      brandId: this.brand.id,
      section: input.section,
      fieldKey,
      value: input.value,
      state: "confirmed",
      sourceIds: [],
      version: (existing?.version ?? 0) + 1,
      updatedAt: NOW,
      confirmedByAccountId: accountId,
    };
    this.fields = [...this.fields.filter((item) => item.fieldKey !== fieldKey), field];
    return Promise.resolve(field);
  }
  recordInferredBrandBrainField(_accountId: string, _brandId: string, input: RecordInferredBrandBrainFieldInput): Promise<BrandBrainFieldDto> {
    const existing = this.fields.find((field) => field.fieldKey === input.fieldKey);
    if (existing?.state === "confirmed") return Promise.resolve(existing);
    const field: BrandBrainFieldDto = {
      id: existing?.id ?? `field-${this.fields.length + 1}`,
      workspaceId: this.brand.workspaceId,
      brandId: this.brand.id,
      section: input.section,
      fieldKey: input.fieldKey,
      value: input.value,
      state: "inferred",
      sourceIds: [...input.sourceIds],
      version: (existing?.version ?? 0) + 1,
      updatedAt: NOW,
    };
    this.fields = [...this.fields.filter((item) => item.fieldKey !== input.fieldKey), field];
    return Promise.resolve(field);
  }
  listKnowledgeSources(): Promise<KnowledgeSourceDto[]> { return Promise.resolve(this.sources.map((source) => ({ ...source }))); }
  listActiveKnowledgeExtractsForBrandBrain() { return Promise.resolve(this.activeExtracts); }
  createKnowledgeSource(_accountId: string, _brandId: string, input: PreparedKnowledgeSourceInput): Promise<KnowledgeSourceDto> {
    const source: KnowledgeSourceDto = {
      id: `source-${this.sources.length + 1}`,
      workspaceId: this.brand.workspaceId,
      brandId: this.brand.id,
      type: input.type,
      status: input.status,
      ...(input.title ? { title: input.title } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.sizeBytes ? { sizeBytes: input.sizeBytes } : {}),
      hasPrivateContent: Boolean(input.rawContent),
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.sources.push(source);
    return Promise.resolve(source);
  }
  setKnowledgeSourceStatus(): Promise<KnowledgeSourceDto> { throw new Error("unused"); }
  removeKnowledgeSource(): Promise<KnowledgeSourceDto> { throw new Error("unused"); }
}

class FakeReferenceReader implements PublicBrandReferenceReader {
  calls: string[] = [];
  async read(url: string) {
    this.calls.push(url);
    return {
      url,
      title: "The Duke 390",
      summary: "Duke 390 riding, ownership and motorcycle content.",
      excerpt: "Duke 390 rides, ownership notes, modifications and rider questions.",
      retrievedAt: NOW,
    };
  }
}

class FakeGenerator implements BrandBrainProposalGenerator {
  calls = 0;
  async propose() {
    this.calls += 1;
    return [
      { section: "positioning" as const, fieldKey: "positioning.market-position", value: "Rider-first Duke 390 media focused on useful ownership and riding insight.", sourceIds: ["source-1"] },
      { section: "audience" as const, fieldKey: "audience.primary", value: "Duke 390 owners, prospective owners and performance-bike enthusiasts.", sourceIds: ["source-1"] },
      { section: "boundaries" as const, fieldKey: "boundaries.sensitive-subjects", value: "Safety-critical modifications and risky public-road riding require extra care.", sourceIds: ["source-1"] },
    ];
  }
}

describe("BrandBrainBootstrapService", () => {
  it("does not confuse database career text with car rental evidence", async () => {
    const repository = new FakeRepository();
    repository.brand = { id: "brand-1", workspaceId: "workspace-1", name: "PostgreSQL", publicProfileUrl: "https://www.postgresql.org/" };
    const service = new BrandBrainBootstrapService(repository, undefined, { read: async (url) => ({
      url, title: "PostgreSQL", excerpt: "PostgreSQL is an open source object-relational database system. Discover how it works and find career opportunities.", retrievedAt: NOW,
    }) });
    await service.build("account-1", "brand-1", {});
    expect(repository.fields.find((field) => field.fieldKey === "audience.primary")?.value).not.toMatch(/vehicle|rental|fleet/);
    expect(repository.fields.find((field) => field.fieldKey === "identity.products-services")?.value).not.toMatch(/vehicle|rental|fleet/i);
  });

  it("never labels a generic website without a title as a GitHub repository", async () => {
    const repository = new FakeRepository();
    repository.brand = { id: "brand-1", workspaceId: "workspace-1", name: "Python", publicSourceUrl: "https://www.python.org/" };
    const service = new BrandBrainBootstrapService(repository, undefined, { read: async (url) => ({
      url, excerpt: "Python is a programming language for developers and software teams.", retrievedAt: NOW,
    }) });

    await service.build("account-1", "brand-1", {});
    expect(repository.fields.find((field) => field.fieldKey === "identity.description")?.value).toMatch(/^Public Brand website\./);
    expect(repository.fields.find((field) => field.fieldKey === "identity.description")?.value).not.toMatch(/GitHub repository/i);
    expect(repository.fields.find((field) => field.fieldKey === "identity.products-services")?.value).toMatch(/programming language|developer tooling/i);
    expect(repository.fields.find((field) => field.fieldKey === "audience.primary")?.value).toMatch(/software developers/i);
    expect(repository.fields.find((field) => field.fieldKey === "content.pillars")?.value).toMatch(/programming tutorials|documentation/i);
    expect(repository.fields.find((field) => field.fieldKey === "identity.category")?.value).toMatch(/software|developer tools/i);
    expect(repository.fields.find((field) => field.fieldKey === "content.preferred-topics")?.value).toMatch(/programming capabilities|ecosystem news/i);
    expect(repository.fields.find((field) => field.fieldKey === "content.preferred-topics")?.value).not.toMatch(/What the Brand offers/i);
    expect(evaluateBrandDnaReadiness(repository.fields).gaps).toEqual(["boundaries"]);
  });

  it("keeps generic website descriptions concise instead of persisting whole-page copy", async () => {
    const repository = new FakeRepository();
    repository.brand = { id: "brand-1", workspaceId: "workspace-1", name: "Notion", publicSourceUrl: "https://www.notion.so/" };
    const repeated = "The AI workspace that works for you. ".repeat(25);
    const service = new BrandBrainBootstrapService(repository, undefined, { read: async (url) => ({
      url, title: "Notion", excerpt: `${repeated}Build custom agents, search across connected apps, and automate busywork.`, retrievedAt: NOW,
    }) });

    await service.build("account-1", "brand-1", {});
    const description = repository.fields.find((field) => field.fieldKey === "identity.description")?.value ?? "";
    expect(description).toBe("Notion. The AI workspace that works for you.");
    expect(description.length).toBeLessThan(120);
  });

  it.each([
    ["vehicle rental", "Malta Cars", "Car rental with online booking and a flexible vehicle fleet.", /vehicle rental/i, /rental booking/i],
    ["automotive owner content", "The Duke 390", "Motorcycle rides, ownership notes and maintenance advice for riders.", /automotive|vehicle|mobility/i, /ownership guidance/i],
    ["restaurant", "Harbour Kitchen", "A restaurant menu featuring local food and seasonal dining experiences.", /food, dining, menu/i, /menus, food, dining/i],
  ])("derives useful, non-placeholder %s Brand DNA without cross-category claims", async (_kind, title, excerpt, offering, pillars) => {
    const repository = new FakeRepository();
    repository.brand = { id: "brand-1", workspaceId: "workspace-1", name: title, publicSourceUrl: "https://example.com/" };
    const service = new BrandBrainBootstrapService(repository, undefined, { read: async (url) => ({ url, title, excerpt, retrievedAt: NOW }) });

    await service.build("account-1", "brand-1", {});
    expect(repository.fields.find((field) => field.fieldKey === "identity.products-services")?.value).toMatch(offering);
    expect(repository.fields.find((field) => field.fieldKey === "content.pillars")?.value).toMatch(pillars);
    expect(evaluateBrandDnaReadiness(repository.fields).gaps).toEqual(["boundaries"]);
    if (_kind === "automotive owner content") {
      expect(repository.fields.find((field) => field.fieldKey === "identity.products-services")?.value).not.toMatch(/rental|fleet booking/i);
    }
  });

  it("fails closed when a persisted Brand URL is malformed", async () => {
    const repository = new FakeRepository();
    repository.brand = { ...repository.brand, publicProfileUrl: "javascript:alert(1)" };
    const service = new BrandBrainBootstrapService(repository, undefined, { read: async () => { throw new Error("unavailable"); } });

    await expect(service.build("account-1", "brand-1", { primaryObjective: "build-authority" })).resolves.toMatchObject({
      generatorStatus: "unavailable",
      proposedCount: 0,
    });
  });
  it.each([
    ["instagram", "https://www.instagram.com/malta_bikes/", "audience.primary", /to be confirmed|connected|readable/i],
    ["facebook", "https://www.facebook.com/malta.cars/", "audience.primary", /to be confirmed|connected|readable/i],
    ["substack", "https://example.substack.com/", "identity.category", /independent publishing|newsletter/i],
    ["website", "https://example.com/", "identity.category", /business|organization/i],
  ])("creates a truthful %s fallback when the public source is blocked", async (_kind, url, expectedKey, expectedValue) => {
    const repository = new FakeRepository();
    repository.brand = { ...repository.brand, publicProfileUrl: url };
    const service = new BrandBrainBootstrapService(
      repository,
      undefined,
      { read: async () => { throw new Error("blocked"); } },
    );
    const result = await service.build("account-1", "brand-1", { primaryObjective: "grow-audience" });
    expect(result.generatorStatus).toBe("generated");
    expect(repository.fields.find((field) => field.fieldKey === expectedKey)?.value).toMatch(expectedValue);
    expect(repository.fields.find((field) => field.fieldKey === expectedKey)?.sourceIds).toHaveLength(1);
  });

  it("records owner objective/directive as confirmed and generated strategy as source-backed inferred context", async () => {
    const repository = new FakeRepository();
    const reader = new FakeReferenceReader();
    const generator = new FakeGenerator();
    const service = new BrandBrainBootstrapService(repository, generator, reader);

    const result = await service.build("account-1", "brand-1", {
      primaryObjective: "grow-audience",
      ownerBoundary: "Do not present dangerous street riding as something to imitate.",
    });

    expect(result.generatorStatus).toBe("generated");
    expect(result.proposedCount).toBe(3);
    expect(reader.calls).toEqual(["https://www.instagram.com/_dukeman390/"]);

    const goal = repository.fields.find((field) => field.fieldKey === "goals.objectives");
    expect(goal).toMatchObject({ state: "confirmed", value: "Grow audience" });
    const directive = repository.fields.find((field) => field.fieldKey === "boundaries.owner-directive");
    expect(directive).toMatchObject({ state: "confirmed" });

    const audience = repository.fields.find((field) => field.fieldKey === "audience.primary");
    expect(audience?.state).toBe("inferred");
    expect(audience?.sourceIds).toEqual(["source-1"]);
  });

  it("generates provisional inferred suggestions from owner context when every public reference is unreadable", async () => {
    const repository = new FakeRepository();
    let generatorInput: Parameters<BrandBrainProposalGenerator["propose"]>[0] | undefined;
    const reader: PublicBrandReferenceReader = { read: async () => { throw new Error("provider blocked public page"); } };
    const generator: BrandBrainProposalGenerator = {
      propose: async (input) => {
        generatorInput = input;
        return [{
          section: "positioning",
          fieldKey: "positioning.market-position",
          value: "A provisional motorcycle content Brand oriented around the owner's audience-growth objective.",
          sourceIds: [],
        }];
      },
    };
    const service = new BrandBrainBootstrapService(repository, generator, reader);

    const result = await service.build("account-1", "brand-1", {
      primaryObjective: "grow-audience",
      ownerBoundary: "Never glorify dangerous public-road riding.",
    });

    expect(generatorInput?.references).toHaveLength(1);
    expect(generatorInput?.existingConfirmed).toMatchObject({
      "goals.objectives": "Grow audience",
      "boundaries.owner-directive": "Never glorify dangerous public-road riding.",
    });
    expect(result).toMatchObject({ generatorStatus: "generated", proposedCount: 1, sourceIds: [] });
    expect(repository.fields.find((field) => field.fieldKey === "positioning.market-position")).toMatchObject({
      state: "inferred",
      sourceIds: [],
    });
  });

  it("never replaces an existing confirmed field with an inferred proposal", async () => {
    const repository = new FakeRepository();
    repository.fields.push({
      id: "field-existing",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      section: "audience",
      fieldKey: "audience.primary",
      value: "Confirmed owner audience",
      state: "confirmed",
      sourceIds: [],
      version: 2,
      updatedAt: NOW,
      confirmedByAccountId: "account-1",
    });
    const service = new BrandBrainBootstrapService(repository, new FakeGenerator(), new FakeReferenceReader());

    const result = await service.build("account-1", "brand-1", { primaryObjective: "build-authority" });

    expect(repository.fields.find((field) => field.fieldKey === "audience.primary")?.value).toBe("Confirmed owner audience");
    expect(result.skippedConfirmedCount).toBe(1);
  });

  it("records bounded visual direction in the existing content-strategy section with active provenance", async () => {
    const repository = new FakeRepository();
    const generator: BrandBrainProposalGenerator = {
      propose: async () => [{
        section: "content-strategy",
        fieldKey: "content.visual-direction",
        value: "High-contrast motorcycle photography with restrained orange accents.",
        sourceIds: ["source-1"],
      }],
    };
    const service = new BrandBrainBootstrapService(repository, generator, new FakeReferenceReader());

    await service.build("account-1", "brand-1", { primaryObjective: "grow-audience" });

    expect(repository.fields.find((field) => field.fieldKey === "content.visual-direction")).toMatchObject({
      section: "content-strategy",
      state: "inferred",
      sourceIds: ["source-1"],
    });
  });

  it("passes an imported Instagram Knowledge snapshot into source-backed proposal generation", async () => {
    const repository = new FakeRepository();
    repository.brand = { id: "brand-1", workspaceId: "workspace-1", name: "Imported Brand" };
    repository.activeExtracts = [{ sourceId: "instagram-source", title: "Instagram profile snapshot", excerpt: JSON.stringify({ biography: "Evidence-led studio", recentMedia: [{ mediaType: "CAROUSEL_ALBUM", caption: "Practical growth lessons" }] }), contentType: "application/vnd.kairo.instagram-profile+json", updatedAt: NOW }];
    let inspected = "";
    const generator: BrandBrainProposalGenerator = { propose: async (input) => {
      inspected = input.references[0]?.excerpt ?? "";
      return [{ section: "voice", fieldKey: "voice.tone", value: "Practical and evidence-led.", sourceIds: ["instagram-source"] }];
    } };
    const service = new BrandBrainBootstrapService(repository, generator, new FakeReferenceReader());

    const result = await service.build("account-1", "brand-1", { primaryObjective: "build-authority" });

    expect(inspected).toContain("CAROUSEL_ALBUM");
    expect(result.sourceIds).toContain("instagram-source");
    expect(repository.fields.find((field) => field.fieldKey === "voice.tone")?.sourceIds).toEqual(["instagram-source"]);
  });

  it("rejects visual direction without active inspected-source provenance", async () => {
    const repository = new FakeRepository();
    const generator: BrandBrainProposalGenerator = {
      propose: async () => [{
        section: "content-strategy",
        fieldKey: "content.color-direction",
        value: "Orange and charcoal.",
        sourceIds: [],
      }],
    };
    const service = new BrandBrainBootstrapService(repository, generator, new FakeReferenceReader());

    await expect(service.build("account-1", "brand-1", { primaryObjective: "grow-audience" })).rejects.toThrow(/active source provenance/i);
  });

  it("keeps confirmed visual direction protected during an imported rebuild", async () => {
    const repository = new FakeRepository();
    repository.fields.push({
      id: "field-visual",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      section: "content-strategy",
      fieldKey: "content.visual-direction",
      value: "Owner-confirmed minimal studio imagery.",
      state: "confirmed",
      sourceIds: [],
      version: 1,
      updatedAt: NOW,
      confirmedByAccountId: "account-1",
    });
    const generator: BrandBrainProposalGenerator = {
      propose: async () => [{
        section: "content-strategy",
        fieldKey: "content.visual-direction",
        value: "Imported alternative direction.",
        sourceIds: ["source-1"],
      }],
    };
    const service = new BrandBrainBootstrapService(repository, generator, new FakeReferenceReader());

    const result = await service.build("account-1", "brand-1", { primaryObjective: "grow-audience" });

    expect(repository.fields.find((field) => field.fieldKey === "content.visual-direction")?.value).toBe("Owner-confirmed minimal studio imagery.");
    expect(result.skippedConfirmedCount).toBe(1);
  });

  it("rejects proposal provenance that does not belong to the inspected Brand references", async () => {
    const repository = new FakeRepository();
    const generator: BrandBrainProposalGenerator = {
      propose: async () => [{ section: "audience", fieldKey: "audience.primary", value: "Unsupported audience", sourceIds: ["foreign-source"] }],
    };
    const service = new BrandBrainBootstrapService(repository, generator, new FakeReferenceReader());

    await expect(service.build("account-1", "brand-1", { primaryObjective: "grow-audience" })).rejects.toThrow(/provenance/i);
  });

  it("can save owner intent without inventing inferred fields when no generator is configured", async () => {
    const repository = new FakeRepository();
    const service = new BrandBrainBootstrapService(repository, undefined, new FakeReferenceReader());

    const result = await service.build("account-1", "brand-1", { primaryObjective: "build-community" });

    expect(result.generatorStatus).toBe("generated");
    expect(result.proposedCount).toBeGreaterThan(0);
    expect(repository.fields.find((field) => field.fieldKey === "goals.objectives")?.state).toBe("confirmed");
  });

  it("uses an explicit setup reference when the Brand has no stored website/profile", async () => {
    const repository = new FakeRepository();
    repository.brand = { id: "brand-1", workspaceId: "workspace-1", name: "New Brand" };
    const reader = new FakeReferenceReader();
    const service = new BrandBrainBootstrapService(repository, new FakeGenerator(), reader);

    await service.build("account-1", "brand-1", {
      primaryObjective: "generate-leads",
      publicReferenceUrl: "https://example.com/about",
    });

    expect(reader.calls).toEqual(["https://example.com/about"]);
    expect(repository.sources[0]?.sourceUrl).toBe("https://example.com/about");
  });

  it("tracks a successfully read public PDF as document evidence", async () => {
    const repository = new FakeRepository();
    repository.brand = { id: "brand-1", workspaceId: "workspace-1", name: "New Brand", publicSourceUrl: "https://example.com/brand.pdf" };
    const reader: PublicBrandReferenceReader = {
      read: async (url) => ({
        url,
        title: "Brand guide",
        excerpt: "A text-based public Brand guide.",
        retrievedAt: NOW,
        contentType: "application/pdf",
        sizeBytes: 2048,
      }),
    };
    const generator: BrandBrainProposalGenerator = {
      propose: async () => [{ section: "voice", fieldKey: "voice.tone", value: "Clear and practical.", sourceIds: ["source-1"] }],
    };
    const service = new BrandBrainBootstrapService(repository, generator, reader);

    await service.build("account-1", "brand-1", { primaryObjective: "build-authority" });

    expect(repository.sources[0]).toMatchObject({ type: "document", contentType: "application/pdf", sizeBytes: 2048 });
  });
});
