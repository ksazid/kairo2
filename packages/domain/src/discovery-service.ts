import type {
  OpportunityAction,
  OpportunityScoresDto,
  OpportunityStatus,
  PublicSignalDto,
  OpportunityDetailsDto,
} from "@kairo/contracts";
import type { BrandOpportunityWithConceptDto, ConceptMockupDto } from "@kairo/contracts/concept-mockup";
import { ResourceNotFoundError } from "./index";
import { buildConceptMockup } from "./concept-mockup";
import {
  evaluateOpportunity,
  materiallySimilarOpportunity,
  preparePublicSignal,
  transitionOpportunityStatus,
  type OpportunityEvaluationInput,
  type PreparedPublicSignal,
  type PublicSignalInput,
} from "./discovery";

export interface CreateBrandOpportunityInput {
  title: string;
  rationale: string;
  whyNow: string;
  developmentDirection: string;
  signalIds: string[];
  scores: OpportunityScoresDto;
  brandContextVersion: string;
  details?: OpportunityDetailsDto;
  conceptMockup?: ConceptMockupDto;
  conceptMockupGeneratedAt?: string;
}

export interface OpportunityCandidateInput {
  signal: PublicSignalInput;
  title: string;
  rationale: string;
  whyNow: string;
  developmentDirection: string;
  brandContextVersion: string;
  scores: OpportunityEvaluationInput;
  details?: Omit<OpportunityDetailsDto, "supportingSourceIds">;
  conceptMockup?: ConceptMockupDto;
  conceptMockupGeneratedAt?: string;
}

export interface DiscoveryRepository {
  upsertPublicSignal(input: PreparedPublicSignal): Promise<PublicSignalDto>;
  listBrandOpportunities(accountId: string, brandId: string): Promise<BrandOpportunityWithConceptDto[]>;
  getBrandOpportunity(accountId: string, brandId: string, opportunityId: string): Promise<BrandOpportunityWithConceptDto | null>;
  createBrandOpportunity(accountId: string, brandId: string, input: CreateBrandOpportunityInput): Promise<BrandOpportunityWithConceptDto>;
  setBrandOpportunityStatus(accountId: string, brandId: string, opportunityId: string, status: OpportunityStatus): Promise<BrandOpportunityWithConceptDto>;
}

export interface RecordCandidateResult {
  signal: PublicSignalDto;
  opportunity: BrandOpportunityWithConceptDto | null;
}

export class DiscoveryService {
  constructor(private readonly repository: DiscoveryRepository) {}

  list(accountId: string, brandId: string): Promise<BrandOpportunityWithConceptDto[]> {
    return this.repository.listBrandOpportunities(accountId, brandId);
  }

  async recordCandidate(accountId: string, brandId: string, input: OpportunityCandidateInput): Promise<RecordCandidateResult> {
    const signal = await this.repository.upsertPublicSignal(preparePublicSignal(input.signal));
    const evaluation = evaluateOpportunity(input.scores);
    if (!evaluation.qualifies) return { signal, opportunity: null };

    const existing = await this.repository.listBrandOpportunities(accountId, brandId);
    const materialDuplicate = existing.some((opportunity) =>
      materiallySimilarOpportunity(
        { topic: input.title, developmentDirection: input.developmentDirection },
        { topic: opportunity.title, developmentDirection: opportunity.developmentDirection },
      ),
    );
    if (materialDuplicate) return { signal, opportunity: null };

    const scores: OpportunityScoresDto = {
      relevance: evaluation.relevance,
      evidence: evaluation.evidence,
      novelty: evaluation.novelty,
      timeliness: evaluation.timeliness,
      brandAuthority: evaluation.brandAuthority,
      audienceFit: evaluation.audienceFit,
      overall: evaluation.overall,
      scoringVersion: evaluation.scoringVersion,
    };
    const generatedMockup = input.conceptMockup ?? projectConceptMockup(input);
    const generatedAt = input.conceptMockupGeneratedAt ?? (generatedMockup ? new Date().toISOString() : undefined);

    const opportunity = await this.repository.createBrandOpportunity(accountId, brandId, {
      title: input.title.trim(),
      rationale: input.rationale.trim(),
      whyNow: input.whyNow.trim(),
      developmentDirection: input.developmentDirection.trim(),
      signalIds: [signal.id],
      scores,
      brandContextVersion: input.brandContextVersion.trim(),
      ...(input.details ? { details: { ...input.details, supportingSourceIds: [signal.id] } } : {}),
      ...(generatedMockup ? { conceptMockup: structuredClone(generatedMockup) } : {}),
      ...(generatedAt ? { conceptMockupGeneratedAt: generatedAt } : {}),
    });
    return { signal, opportunity };
  }

  async act(
    accountId: string,
    brandId: string,
    opportunityId: string,
    action: OpportunityAction,
  ): Promise<BrandOpportunityWithConceptDto> {
    const current = await this.repository.getBrandOpportunity(accountId, brandId, opportunityId);
    if (!current) throw new ResourceNotFoundError("Opportunity not found");
    const next = transitionOpportunityStatus(current.status, action);
    if (next === current.status) return current;
    return this.repository.setBrandOpportunityStatus(accountId, brandId, opportunityId, next);
  }
}

function projectConceptMockup(input: OpportunityCandidateInput): ConceptMockupDto | undefined {
  try {
    return buildConceptMockup({
      title: input.title,
      rationale: input.rationale,
      whyNow: input.whyNow,
      developmentDirection: input.developmentDirection,
      ...(input.details?.hook ? { hook: input.details.hook } : {}),
      ...(input.details?.proposedAngle ? { proposedAngle: input.details.proposedAngle } : {}),
      ...(input.details?.targetAudience ? { targetAudience: input.details.targetAudience } : {}),
      ...(input.details?.objective ? { objective: input.details.objective } : {}),
      ...(input.details?.recommendedFormat ? { recommendedFormat: input.details.recommendedFormat } : {}),
    });
  } catch {
    // A rough presentation mockup is optional. It must never suppress a qualified Hunter opportunity.
    return undefined;
  }
}
