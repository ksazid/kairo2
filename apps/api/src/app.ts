import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type {
  AccountDto,
  CreateKnowledgeSourceRequest,
  CreateWorkspaceWithBrandRequest,
  OpportunityAction,
  ProblemDetails,
  PutBrandBrainFieldRequest,
} from "@kairo/contracts";
import {
  ConcurrencyConflictError,
  DomainValidationError,
  KairoService,
  ResourceNotFoundError,
  type KairoRepository,
} from "@kairo/domain";
import { DiscoveryService, type DiscoveryRepository } from "@kairo/domain/discovery-service";
import { ResearchService, type ResearchRepository } from "@kairo/domain/research-service";
import { CampaignService, type CampaignRepository, type ContentGenerationPort, type GenerateContentAction } from "@kairo/domain/campaign-service";
import type { ContentChannel } from "@kairo/domain/campaign";
import { ReviewService, type CriticEvaluationPort, type ReviewRepository } from "@kairo/domain/review-service";
import type { ApprovalDestination } from "@kairo/domain/review";
import { PublishingGateway, PublishingService, type DistributionDestinationInput, type PublishingRepository } from "@kairo/domain/publishing-service";
import type { PublishContentType } from "@kairo/domain/publishing";
import { AnalyticsService, type AnalyticsRepository } from "@kairo/domain/analytics-service";
import type { MetricName } from "@kairo/domain/analytics";
import { LearningService, type LearningRepository } from "@kairo/domain/learning-service";
import type { IdentityVerifier } from "./auth";

export interface IdeaDevelopmentPort {
  develop(input: {
    accountId: string;
    workspaceId: string;
    brandId: string;
    brandContextVersion: string;
    idea: { id: string; title: string; premise: string };
  }): Promise<void>;
}

export interface BuildAppOptions {
  store: KairoRepository;
  discoveryStore?: DiscoveryRepository;
  researchStore?: ResearchRepository;
  ideaDeveloper?: IdeaDevelopmentPort;
  campaignStore?: CampaignRepository;
  contentGenerator?: ContentGenerationPort;
  reviewStore?: ReviewRepository;
  criticEvaluator?: CriticEvaluationPort;
  publishingStore?: PublishingRepository;
  analyticsStore?: AnalyticsRepository;
  learningStore?: LearningRepository;
  identityVerifier: IdentityVerifier;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const service = new KairoService(options.store);
  const discovery = options.discoveryStore ? new DiscoveryService(options.discoveryStore) : null;
  const research = options.researchStore ? new ResearchService(options.researchStore) : null;
  const campaigns = options.campaignStore && options.researchStore ? new CampaignService(options.campaignStore, options.researchStore, options.contentGenerator, undefined, (accountId, brandId) => service.listBrandBrain(accountId, brandId)) : null;
  const reviews = options.campaignStore && options.researchStore && options.reviewStore && options.criticEvaluator ? new ReviewService(options.campaignStore, options.researchStore, options.reviewStore, options.criticEvaluator) : null;
  const publishing = options.campaignStore && options.reviewStore && options.publishingStore ? new PublishingService(options.store, options.campaignStore, options.reviewStore, options.publishingStore) : null;
  const publishingGateway = reviews && publishing ? new PublishingGateway(reviews, publishing) : null;
  const analytics = options.analyticsStore ? new AnalyticsService(options.analyticsStore) : null;
  const learning = options.learningStore ? new LearningService(options.learningStore) : null;

  app.addHook("onRequest", async (request, reply) => { reply.header("x-correlation-id", request.id); });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainValidationError) return reply.status(400).send(problem(400, "Invalid request", error.message, error.code, request.id));
    if (error instanceof ResourceNotFoundError) return reply.status(404).send(problem(404, "Not found", error.message, error.code, request.id));
    if (error instanceof ConcurrencyConflictError) return reply.status(409).send(problem(409, "Conflict", error.message, error.code, request.id));
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send(problem(500, "Internal server error", undefined, "internal_error", request.id));
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/session", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return { account, workspaces: await service.listWorkspaces(account.id) };
  });

  app.get("/api/v1/workspaces", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.listWorkspaces(account.id);
  });

  app.post<{ Body: CreateWorkspaceWithBrandRequest }>("/api/v1/workspaces", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    const created = await service.createInitialWorkspace(account.id, request.body ?? ({} as CreateWorkspaceWithBrandRequest));
    return reply.status(201).send(created);
  });

  app.get<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/brands", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.listBrands(account.id, request.params.workspaceId);
  });

  app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.getBrand(account.id, request.params.brandId);
  });

  app.delete<{ Params: { brandId: string } }>("/api/v1/brands/:brandId", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    await service.deleteBrand(account.id, request.params.brandId);
    return reply.status(204).send();
  });

  app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/brain", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.listBrandBrain(account.id, request.params.brandId);
  });

  app.put<{ Params: { brandId: string; fieldKey: string }; Body: PutBrandBrainFieldRequest }>(
    "/api/v1/brands/:brandId/brain/:fieldKey",
    async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      return service.putBrandBrainField(account.id, request.params.brandId, request.params.fieldKey, request.body ?? ({} as PutBrandBrainFieldRequest));
    },
  );

  app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/sources", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.listKnowledgeSources(account.id, request.params.brandId);
  });

  app.post<{ Params: { brandId: string }; Body: CreateKnowledgeSourceRequest }>("/api/v1/brands/:brandId/sources", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    const source = await service.createKnowledgeSource(account.id, request.params.brandId, request.body ?? ({} as CreateKnowledgeSourceRequest));
    return reply.status(201).send(source);
  });

  app.post<{ Params: { brandId: string; sourceId: string } }>("/api/v1/brands/:brandId/sources/:sourceId/disable", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.setKnowledgeSourceStatus(account.id, request.params.brandId, request.params.sourceId, "disabled");
  });

  app.post<{ Params: { brandId: string; sourceId: string } }>("/api/v1/brands/:brandId/sources/:sourceId/enable", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.setKnowledgeSourceStatus(account.id, request.params.brandId, request.params.sourceId, "active");
  });

  app.delete<{ Params: { brandId: string; sourceId: string } }>("/api/v1/brands/:brandId/sources/:sourceId", async (request, reply) => {
    const account = await authenticate(request, reply, service, options.identityVerifier);
    if (!account) return;
    return service.removeKnowledgeSource(account.id, request.params.brandId, request.params.sourceId);
  });

  if (discovery) {
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/opportunities", async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      return discovery.list(account.id, request.params.brandId);
    });

    for (const action of ["save", "ignore", "develop"] as const satisfies readonly OpportunityAction[]) {
      app.post<{ Params: { brandId: string; opportunityId: string } }>(
        `/api/v1/brands/:brandId/opportunities/:opportunityId/${action}`,
        async (request, reply) => {
          const account = await authenticate(request, reply, service, options.identityVerifier);
          if (!account) return;
          return discovery.act(account.id, request.params.brandId, request.params.opportunityId, action);
        },
      );
    }
  }

  if (research) {
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/ideas", async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      return research.listIdeas(account.id, request.params.brandId);
    });

    app.post<{ Params: { brandId: string }; Body: { title: string; premise: string } }>("/api/v1/brands/:brandId/ideas", async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      const brand = await service.getBrand(account.id, request.params.brandId);
      const idea = await research.createUserIdea(account.id, brand.workspaceId, brand.id, request.body ?? ({} as { title: string; premise: string }));
      return reply.status(201).send(idea);
    });

    app.get<{ Params: { brandId: string; ideaId: string } }>("/api/v1/brands/:brandId/ideas/:ideaId", async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      const bundle = await research.getIdea(account.id, request.params.brandId, request.params.ideaId);
      if (!bundle) throw new ResourceNotFoundError("Idea not found");
      return bundle;
    });

    app.post<{ Params: { brandId: string; ideaId: string } }>("/api/v1/brands/:brandId/ideas/:ideaId/research", async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      const bundle = await research.getIdea(account.id, request.params.brandId, request.params.ideaId);
      if (!bundle) throw new ResourceNotFoundError("Idea not found");
      if (bundle.research && bundle.angles.length >= 2) return bundle;
      if (!options.ideaDeveloper) throw new DomainValidationError("Research generation is not configured");
      const brand = await service.getBrand(account.id, request.params.brandId);
      try {
        await options.ideaDeveloper.develop({
          accountId: account.id,
          workspaceId: brand.workspaceId,
          brandId: brand.id,
          brandContextVersion: `${brand.id}@current`,
          idea: { id: bundle.idea.id, title: bundle.idea.title, premise: bundle.idea.premise },
        });
      } catch (error) {
        const recovered = await research.getIdea(account.id, request.params.brandId, request.params.ideaId);
        if (recovered?.research && recovered.angles.length >= 2) return recovered;
        throw error;
      }
      const developed = await research.getIdea(account.id, request.params.brandId, request.params.ideaId);
      if (!developed?.research || developed.angles.length < 2) throw new DomainValidationError("Research development did not produce usable candidate Angles");
      return developed;
    });

    app.post<{ Params: { brandId: string; ideaId: string; angleId: string }; Body: { expectedVersion: number } }>(
      "/api/v1/brands/:brandId/ideas/:ideaId/angles/:angleId/select",
      async (request, reply) => {
        const account = await authenticate(request, reply, service, options.identityVerifier);
        if (!account) return;
        const expectedVersion = request.body?.expectedVersion;
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new DomainValidationError("expectedVersion must be a positive integer");
        return research.selectAngle(account.id, request.params.brandId, request.params.ideaId, request.params.angleId, expectedVersion);
      },
    );

    app.patch<{ Params: { brandId: string; ideaId: string; angleId: string }; Body: { framing: string; expectedVersion: number } }>(
      "/api/v1/brands/:brandId/ideas/:ideaId/angles/:angleId",
      async (request, reply) => {
        const account = await authenticate(request, reply, service, options.identityVerifier);
        if (!account) return;
        return research.editAngleFraming(account.id, request.params.brandId, request.params.ideaId, request.params.angleId, request.body?.framing, request.body?.expectedVersion);
      },
    );
  }

  if (campaigns) {
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/campaigns", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return campaigns.list(account.id, request.params.brandId); });
    app.post<{ Params: { brandId: string }; Body: { ideaId: string; name: string; objective: string } }>("/api/v1/brands/:brandId/campaigns", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; const campaign = await campaigns.createFromSelectedAngle(account.id, request.params.brandId, request.body?.ideaId, { name: request.body?.name, objective: request.body?.objective }); return reply.status(201).send(campaign); });
    app.get<{ Params: { brandId: string; campaignId: string } }>("/api/v1/brands/:brandId/campaigns/:campaignId", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; const detail = await campaigns.get(account.id, request.params.brandId, request.params.campaignId); if (!detail) throw new ResourceNotFoundError("Campaign not found"); return detail; });
    app.post<{ Params: { brandId: string; campaignId: string }; Body: { channel: ContentChannel; format: string; audience: string; topic: string; hookType: string; cta: string; content: string } }>("/api/v1/brands/:brandId/campaigns/:campaignId/assets", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return reply.status(201).send(await campaigns.createAsset(account.id, request.params.brandId, request.params.campaignId, request.body)); });
    app.post<{ Params: { brandId: string; campaignId: string; assetId: string }; Body: { expectedVersion: number; content: string } }>("/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/versions", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return reply.status(201).send(await campaigns.appendManualEdit(account.id, request.params.brandId, request.params.campaignId, request.params.assetId, request.body)); });
    app.post<{ Params: { brandId: string; campaignId: string; assetId: string }; Body: { expectedVersion: number; action: GenerateContentAction; section?: string; brandContextVersion: string } }>("/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/generate", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return reply.status(201).send(await campaigns.generateVersion(account.id, request.params.brandId, request.params.campaignId, request.params.assetId, request.body)); });
  }

  if (reviews) {
    app.get<{ Params: { brandId: string; assetId: string } }>("/api/v1/brands/:brandId/assets/:assetId/review-status", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return reviews.status(account.id, request.params.brandId, request.params.assetId); });
    app.post<{ Params: { brandId: string; campaignId: string; assetId: string }; Body: { expectedVersion: number; brandContextVersion: string; revisionCycle: number } }>("/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/review", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return reply.status(201).send(await reviews.review(account.id, request.params.brandId, request.params.campaignId, request.params.assetId, request.body)); });
    app.post<{ Params: { brandId: string; campaignId: string; assetId: string }; Body: { expectedVersion: number; destination: ApprovalDestination } }>("/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/approve", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return reply.status(201).send(await reviews.approve(account.id, request.params.brandId, request.params.campaignId, request.params.assetId, request.body)); });
  }

  if (publishing) {
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/channel-accounts", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return (await publishing.accounts(account.id, request.params.brandId)).map(({ credentialRef: _, ...safe }) => safe); });
    app.get<{ Params: { brandId: string }; Querystring: { from?: string; to?: string } }>("/api/v1/brands/:brandId/calendar", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; for (const [name, value] of Object.entries(request.query)) if (value && Number.isNaN(Date.parse(value))) throw new DomainValidationError(`${name} must be a valid timestamp`); if (request.query.from && request.query.to && Date.parse(request.query.from) > Date.parse(request.query.to)) throw new DomainValidationError("from cannot be after to"); return publishing.calendar(account.id, request.params.brandId, request.query.from, request.query.to); });
    app.post<{ Params: { brandId: string; campaignId: string; assetId: string }; Body: { channelAccountId: string; contentType: PublishContentType; scheduledFor: string } }>("/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/schedule", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return reply.status(201).send(await publishing.schedule(account.id, request.params.brandId, request.params.campaignId, request.params.assetId, request.body)); });
    app.post<{ Params: { brandId: string; commandId: string } }>("/api/v1/brands/:brandId/publish-commands/:commandId/retry", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return publishing.retry(account.id, request.params.brandId, request.params.commandId); });
    app.post<{ Params: { brandId: string; commandId: string } }>("/api/v1/brands/:brandId/publish-commands/:commandId/cancel", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return publishing.cancel(account.id, request.params.brandId, request.params.commandId); });
  }

  if (publishingGateway) {
    app.post<{
      Params: { brandId: string; campaignId: string };
      Body: { scheduledFor: string; destinations: DistributionDestinationInput[] };
    }>("/api/v1/brands/:brandId/campaigns/:campaignId/distributions", async (request, reply) => {
      const account = await authenticate(request, reply, service, options.identityVerifier);
      if (!account) return;
      return reply.status(201).send(await publishingGateway.distribute(account.id, request.params.brandId, request.params.campaignId, request.body));
    });
  }

  if (analytics) {
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/performance", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return analytics.performance(account.id, request.params.brandId); });
    app.get<{ Params: { brandId: string }; Querystring: { name: MetricName } }>("/api/v1/brands/:brandId/performance/baseline", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; if (!request.query.name) throw new DomainValidationError("name is required"); return analytics.baseline(account.id, request.params.brandId, request.query.name); });
  }

  if (learning) {
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/learnings", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return learning.list(account.id, request.params.brandId); });
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/performance-patterns", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return learning.patterns(account.id, request.params.brandId); });
    app.post<{ Params: { brandId: string; learningId: string }; Body: { action: "accept" | "reject" | "correct"; expectedVersion: number; reason?: string; statement?: string; interpretation?: string } }>("/api/v1/brands/:brandId/learnings/:learningId/decision", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return learning.decide(account.id, request.params.brandId, request.params.learningId, request.body); });
    app.get<{ Params: { brandId: string } }>("/api/v1/brands/:brandId/experiments", async (request, reply) => { const account = await authenticate(request, reply, service, options.identityVerifier); if (!account) return; return learning.experiments(account.id, request.params.brandId); });
  }

  return app;
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  service: KairoService,
  verifier: IdentityVerifier,
): Promise<AccountDto | null> {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply.status(401).send(problem(401, "Unauthorized", "A valid bearer token is required.", "unauthorized", request.id));
    return null;
  }
  return service.establishSession(identity);
}

function problem(status: number, title: string, detail: string | undefined, code: string, correlationId: string): ProblemDetails {
  return { type: `https://kairo.local/problems/${code}`, title, status, ...(detail ? { detail } : {}), code, correlationId };
}
