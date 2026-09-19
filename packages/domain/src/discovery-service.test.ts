import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OpportunityStatus, PublicSignalDto } from "@kairo/contracts";
import type { BrandOpportunityWithConceptDto } from "@kairo/contracts/concept-mockup";
import { ResourceNotFoundError } from "./index";
import type { CreateBrandOpportunityInput, DiscoveryRepository } from "./discovery-service";
import { DiscoveryService } from "./discovery-service";
import type { PreparedPublicSignal } from "./discovery";

class FakeDiscoveryRepository implements DiscoveryRepository {
  signals: PublicSignalDto[] = [];
  opportunities: BrandOpportunityWithConceptDto[] = [];

  async upsertPublicSignal(input: PreparedPublicSignal): Promise<PublicSignalDto> {
    const existing = this.signals.find((signal) => signal.duplicateKey === input.duplicateKey || (input.contentHash && signal.contentHash === input.contentHash));
    if (existing) return existing;
    const now = new Date().toISOString();
    const signal: PublicSignalDto = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.signals.push(signal);
    return signal;
  }

  async listBrandOpportunities(_accountId: string, brandId: string): Promise<BrandOpportunityWithConceptDto[]> {
    return this.opportunities.filter((opportunity) => opportunity.brandId === brandId);
  }

  async getBrandOpportunity(_accountId: string, brandId: string, opportunityId: string): Promise<BrandOpportunityWithConceptDto | null> {
    return this.opportunities.find((opportunity) => opportunity.brandId === brandId && opportunity.id === opportunityId) ?? null;
  }

  async createBrandOpportunity(_accountId: string, brandId: string, input: CreateBrandOpportunityInput): Promise<BrandOpportunityWithConceptDto> {
    const now = new Date().toISOString();
    const opportunity: BrandOpportunityWithConceptDto = {
      id: randomUUID(), workspaceId: "workspace-1", brandId, status: "new", createdAt: now, updatedAt: now, ...input,
    };
    this.opportunities.push(opportunity);
    return opportunity;
  }

  async setBrandOpportunityStatus(_accountId: string, brandId: string, opportunityId: string, status: OpportunityStatus): Promise<BrandOpportunityWithConceptDto> {
    const opportunity = await this.getBrandOpportunity("", brandId, opportunityId);
    if (!opportunity) throw new ResourceNotFoundError("Opportunity not found");
    opportunity.status = status;
    opportunity.updatedAt = new Date().toISOString();
    return opportunity;
  }
}

const signal = {
  title: "Persistent agents change SaaS architecture",
  sourceUrl: "https://example.com/agents",
  platform: "web",
  retrievedAt: "2026-08-13T00:00:00.000Z",
  provider: "fixture",
};

describe("VS-03 DiscoveryService", () => {
  it("retains a public Signal but returns no Opportunity when the candidate is weak", async () => {
    const repository = new FakeDiscoveryRepository();
    const service = new DiscoveryService(repository);
    const result = await service.recordCandidate("account-1", "brand-1", {
      signal,
      title: signal.title,
      rationale: "Possible topic",
      whyNow: "Recent",
      developmentDirection: "Explain the impact",
      brandContextVersion: "brand-1@1",
      scores: { relevance: 0.2, evidence: 0.9, novelty: 0.9, timeliness: 0.9, brandAuthority: 0.9, audienceFit: 0.9 },
    });

    expect(repository.signals).toHaveLength(1);
    expect(result.opportunity).toBeNull();
  });

  it("adds a best-effort concept mockup only after qualification without changing scores", async () => {
    const repository = new FakeDiscoveryRepository();
    const service = new DiscoveryService(repository);
    const result = await service.recordCandidate("account-1", "brand-1", {
      signal,
      title: "Persistent AI agents",
      rationale: "Technical founders need a concrete explanation.",
      whyNow: "Persistent agent runtimes are becoming practical.",
      developmentDirection: "Explain the architecture tradeoffs for multi-tenant SaaS.",
      brandContextVersion: "brand-1@7",
      scores: { relevance: 0.9, evidence: 0.8, novelty: 0.8, timeliness: 0.8, brandAuthority: 0.7, audienceFit: 0.9 },
      details: {
        topic: "Persistent AI agents",
        proposedAngle: "Architecture tradeoffs",
        hook: "Your AI agent now remembers yesterday",
        targetAudience: "Technical founders",
        objective: "Educate",
        recommendedFormat: "carousel",
        recommendedChannel: "linkedin",
        confidence: 0.9,
        estimatedEffort: "medium",
      },
    });

    expect(result.opportunity?.conceptMockup?.format).toBe("carousel");
    expect(result.opportunity?.conceptMockup?.carousel?.slides).toHaveLength(2);
    expect(result.opportunity?.conceptMockupGeneratedAt).toBeTruthy();
    expect(result.opportunity?.scores).toMatchObject({ relevance: 0.9, evidence: 0.8, audienceFit: 0.9 });
    expect(result.opportunity?.scores.scoringVersion).toBe("vs03-deterministic-v1");
  });

  it("suppresses a materially duplicate Opportunity but allows a different direction", async () => {
    const repository = new FakeDiscoveryRepository();
    const service = new DiscoveryService(repository);
    const scores = { relevance: 0.9, evidence: 0.8, novelty: 0.8, timeliness: 0.8, brandAuthority: 0.7, audienceFit: 0.9 };

    const first = await service.recordCandidate("account-1", "brand-1", {
      signal,
      title: "Persistent AI agents",
      rationale: "Useful",
      whyNow: "New capability",
      developmentDirection: "Beginner explanation of what persistent agents are",
      brandContextVersion: "brand-1@1",
      scores,
    });
    expect(first.opportunity).not.toBeNull();

    const duplicate = await service.recordCandidate("account-1", "brand-1", {
      signal: { ...signal, sourceUrl: "https://example.com/agents-2" },
      title: "Persistent AI agents",
      rationale: "Same",
      whyNow: "Still new",
      developmentDirection: "Beginner explanation of what persistent agents are",
      brandContextVersion: "brand-1@1",
      scores,
    });
    expect(duplicate.opportunity).toBeNull();

    const different = await service.recordCandidate("account-1", "brand-1", {
      signal: { ...signal, sourceUrl: "https://example.com/agents-3" },
      title: "Persistent AI agents",
      rationale: "Different audience value",
      whyNow: "Architectural implications",
      developmentDirection: "Architecture tradeoffs for multi-tenant SaaS founders",
      brandContextVersion: "brand-1@1",
      scores,
    });
    expect(different.opportunity).not.toBeNull();
  });

  it("applies bounded Save/Ignore/Develop transitions and hides foreign ids as not found", async () => {
    const repository = new FakeDiscoveryRepository();
    const service = new DiscoveryService(repository);
    const created = await service.recordCandidate("account-1", "brand-1", {
      signal,
      title: signal.title,
      rationale: "Strong fit",
      whyNow: "Current",
      developmentDirection: "Technical founder explanation",
      brandContextVersion: "brand-1@1",
      scores: { relevance: 0.9, evidence: 0.8, novelty: 0.8, timeliness: 0.8, brandAuthority: 0.7, audienceFit: 0.9 },
    });
    const id = created.opportunity!.id;
    expect((await service.act("account-1", "brand-1", id, "save")).status).toBe("saved");
    expect((await service.act("account-1", "brand-1", id, "develop")).status).toBe("developing");
    await expect(service.act("account-1", "brand-2", id, "save")).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
