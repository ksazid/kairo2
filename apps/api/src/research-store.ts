import type { KairoRepository } from "@kairo/domain";
import { ConcurrencyConflictError, ResourceNotFoundError } from "@kairo/domain";
import { createResearchDossier, type Angle, type Idea, type ResearchDossier } from "@kairo/domain/research";
import type { IdeaBundle, ResearchRepository } from "@kairo/domain/research-service";

export class MemoryResearchRepository implements ResearchRepository {
  private readonly ideas = new Map<string, Idea>();
  private readonly research = new Map<string, ResearchDossier>();
  private readonly angles = new Map<string, Angle[]>();

  constructor(private readonly core: KairoRepository) {}

  async createIdea(accountId: string, idea: Idea): Promise<Idea> {
    const brand = await this.requireBrand(accountId, idea.brandId);
    if (brand.workspaceId !== idea.workspaceId) throw new ResourceNotFoundError("Brand not found");
    this.ideas.set(idea.id, structuredClone(idea));
    return structuredClone(idea);
  }

  async listIdeas(accountId: string, brandId: string): Promise<Idea[]> {
    await this.requireBrand(accountId, brandId);
    return [...this.ideas.values()].filter((idea) => idea.brandId === brandId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((idea) => structuredClone(idea));
  }

  async getIdeaBundle(accountId: string, brandId: string, ideaId: string): Promise<IdeaBundle | null> {
    await this.requireBrand(accountId, brandId);
    const idea = this.ideas.get(ideaId);
    if (!idea || idea.brandId !== brandId) return null;
    return { idea: structuredClone(idea), research: structuredClone(this.research.get(ideaId) ?? null), angles: structuredClone(this.angles.get(ideaId) ?? []) };
  }

  async selectAngle(accountId: string, brandId: string, ideaId: string, angleId: string, expectedVersion: number): Promise<Angle[]> {
    await this.requireBrand(accountId, brandId);
    const angles = this.angles.get(ideaId);
    const target = angles?.find((angle) => angle.id === angleId && angle.brandId === brandId);
    if (!angles || !target) throw new ResourceNotFoundError("Angle not found");
    if (target.version !== expectedVersion) throw new ConcurrencyConflictError("Angle version is stale");
    const selected = angles.map((angle) => ({ ...angle, status: angle.id === angleId ? "selected" as const : "candidate" as const, version: angle.version + 1 }));
    this.angles.set(ideaId, selected);
    return structuredClone(selected);
  }

  async editAngleFraming(accountId: string, brandId: string, ideaId: string, angleId: string, framing: string, expectedVersion: number): Promise<Angle> {
    await this.requireBrand(accountId, brandId);
    const angles = this.angles.get(ideaId);
    const index = angles?.findIndex((angle) => angle.id === angleId && angle.brandId === brandId) ?? -1;
    if (!angles || index < 0) throw new ResourceNotFoundError("Angle not found");
    const target = angles[index]!;
    if (target.version !== expectedVersion) throw new ConcurrencyConflictError("Angle version is stale");
    const edited = { ...target, framing, version: target.version + 1 };
    angles[index] = edited;
    return structuredClone(edited);
  }

  async seedResearchOnly(ideaId: string): Promise<ResearchDossier> {
    const idea = this.ideas.get(ideaId);
    if (!idea) throw new ResourceNotFoundError("Idea not found");
    const dossier = createResearchDossier({
      id: "research-1", workspaceId: idea.workspaceId, brandId: idea.brandId, ideaId,
      summary: "Supported research", evidence: [{ id: "evidence-1", sourceUrl: "https://example.com/report", sourceTitle: "Report", retrievedAt: "2026-08-13T08:00:00.000Z" }],
      claims: [{ id: "claim-1", text: "The report records a change.", classification: "fact", confidence: 0.9, evidenceStrength: "strong", verificationState: "supported", freshness: "fresh", evidenceIds: ["evidence-1"], firstPersonAuthorization: "not-applicable" }],
      unresolvedUncertainties: ["Long-term impact is unknown."], createdAt: "2026-08-13T08:05:00.000Z",
    });
    this.research.set(ideaId, dossier);
    return structuredClone(dossier);
  }

  async seedAngles(ideaId: string): Promise<void> {
    const idea = this.ideas.get(ideaId);
    if (!idea) throw new ResourceNotFoundError("Idea not found");
    if (!this.research.has(ideaId)) throw new ResourceNotFoundError("Research not found");
    const common = { workspaceId: idea.workspaceId, brandId: idea.brandId, ideaId, audience: "Founders", objective: "Education", hookDirection: "Lead with evidence", expectedValue: "Clarity", effort: "low" as const, recommendedFormat: "text", recommendedChannel: "linkedin", supportingClaimIds: ["claim-1"], status: "candidate" as const, version: 1 };
    this.angles.set(ideaId, [
      { ...common, id: "angle-1", title: "Evidence first", framing: "Explain the finding" },
      { ...common, id: "angle-2", title: "Uncertainty first", framing: "Explain what remains unknown" },
    ]);
  }

  async seedReadyBundle(ideaId: string): Promise<void> {
    await this.seedResearchOnly(ideaId);
    await this.seedAngles(ideaId);
  }

  private async requireBrand(accountId: string, brandId: string) {
    const brand = await this.core.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    return brand;
  }
}
