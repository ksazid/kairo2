import { randomUUID } from "node:crypto";
import type { BrandDto, OpportunityStatus, PublicSignalDto } from "@kairo/contracts";
import type { BrandOpportunityWithConceptDto } from "@kairo/contracts/concept-mockup";
import { ResourceNotFoundError, type KairoRepository } from "@kairo/domain";
import type { PreparedPublicSignal } from "@kairo/domain/discovery";
import type { CreateBrandOpportunityInput, DiscoveryRepository } from "@kairo/domain/discovery-service";

export class MemoryDiscoveryRepository implements DiscoveryRepository {
  private readonly signals = new Map<string, PublicSignalDto>();
  private readonly opportunities = new Map<string, BrandOpportunityWithConceptDto>();

  constructor(private readonly brandAccess: Pick<KairoRepository, "getBrandForAccount">) {}

  async upsertPublicSignal(input: PreparedPublicSignal): Promise<PublicSignalDto> {
    const existing = [...this.signals.values()].find(
      (signal) => signal.duplicateKey === input.duplicateKey || Boolean(input.contentHash && signal.contentHash === input.contentHash),
    );
    if (existing) return copySignal(existing);
    const now = new Date().toISOString();
    const signal: PublicSignalDto = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.signals.set(signal.id, signal);
    return copySignal(signal);
  }

  async listBrandOpportunities(accountId: string, brandId: string): Promise<BrandOpportunityWithConceptDto[]> {
    await this.requireBrand(accountId, brandId);
    return [...this.opportunities.values()]
      .filter((opportunity) => opportunity.brandId === brandId)
      .sort((a, b) => b.scores.overall - a.scores.overall || b.createdAt.localeCompare(a.createdAt))
      .map(copyOpportunity);
  }

  async getBrandOpportunity(accountId: string, brandId: string, opportunityId: string): Promise<BrandOpportunityWithConceptDto | null> {
    await this.requireBrand(accountId, brandId);
    const opportunity = this.opportunities.get(opportunityId);
    if (!opportunity || opportunity.brandId !== brandId) return null;
    return copyOpportunity(opportunity);
  }

  async createBrandOpportunity(accountId: string, brandId: string, input: CreateBrandOpportunityInput): Promise<BrandOpportunityWithConceptDto> {
    const brand = await this.requireBrand(accountId, brandId);
    if (!input.signalIds.length || input.signalIds.some((signalId) => !this.signals.has(signalId))) throw new ResourceNotFoundError("Signal not found");
    const now = new Date().toISOString();
    const opportunity: BrandOpportunityWithConceptDto = {
      id: randomUUID(),
      workspaceId: brand.workspaceId,
      brandId,
      title: input.title,
      rationale: input.rationale,
      whyNow: input.whyNow,
      developmentDirection: input.developmentDirection,
      status: "new",
      signalIds: [...new Set(input.signalIds)],
      scores: { ...input.scores },
      brandContextVersion: input.brandContextVersion,
      ...(input.details ? { details: structuredClone(input.details) } : {}),
      ...(input.conceptMockup ? { conceptMockup: structuredClone(input.conceptMockup) } : {}),
      ...(input.conceptMockupGeneratedAt ? { conceptMockupGeneratedAt: input.conceptMockupGeneratedAt } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.opportunities.set(opportunity.id, opportunity);
    return copyOpportunity(opportunity);
  }

  async setBrandOpportunityStatus(
    accountId: string,
    brandId: string,
    opportunityId: string,
    status: OpportunityStatus,
  ): Promise<BrandOpportunityWithConceptDto> {
    await this.requireBrand(accountId, brandId);
    const opportunity = this.opportunities.get(opportunityId);
    if (!opportunity || opportunity.brandId !== brandId) throw new ResourceNotFoundError("Opportunity not found");
    const updated: BrandOpportunityWithConceptDto = { ...opportunity, status, updatedAt: new Date().toISOString() };
    this.opportunities.set(opportunityId, updated);
    return copyOpportunity(updated);
  }

  private async requireBrand(accountId: string, brandId: string): Promise<BrandDto> {
    const brand = await this.brandAccess.getBrandForAccount(accountId, brandId);
    if (!brand) throw new ResourceNotFoundError("Brand not found");
    return brand;
  }
}

function copySignal(signal: PublicSignalDto): PublicSignalDto {
  return { ...signal };
}

function copyOpportunity(opportunity: BrandOpportunityWithConceptDto): BrandOpportunityWithConceptDto {
  return {
    ...opportunity,
    signalIds: [...opportunity.signalIds],
    scores: { ...opportunity.scores },
    ...(opportunity.details ? { details: structuredClone(opportunity.details) } : {}),
    ...(opportunity.conceptMockup ? { conceptMockup: structuredClone(opportunity.conceptMockup) } : {}),
  };
}
