import { Pool } from "pg";
import { buildApp } from "./app";
import { OidcJwtVerifier } from "./auth";
import { PgDiscoveryRepository } from"./discovery-postgres-store";
import { PgKairoRepository } from "./postgres-store";
import { PgResearchRepository } from "./research-postgres-store";
import { PgCampaignRepository } from "./campaign-postgres-store";
import{PgReviewRepository}from"./review-postgres-store";import{CriticEvaluationAdapter}from"./critic-adapter";
import{PgPublishingRepository}from"./publishing-postgres-store";
import{PgAnalyticsRepository}from"./analytics-postgres-store";
import{PgLearningRepository}from"./learning-postgres-store";
import{PgOperationsRepository}from"./operations-postgres-store";
import{registerOperationsRoutes}from"./operations-routes";
import{registerReadinessRoutes}from"./readiness-routes";
import{registerGuidedBrandBrainRoutes}from"./guided-brand-brain-routes";
import{registerHunterRecommendationRoutes}from"./hunter-recommendation-routes";
import{configuredHunterSourceRegistry,createHunterToolGateway}from"./hunter-tool-gateway";
import{PgBrandIntelligenceGraphStore}from"./brand-intelligence-graph-store";
import{createSourceIntelligenceRouter}from"./source-intelligence";
import{PgChannelAccountGroupRepository}from"./channel-account-group-postgres-store";
import{registerChannelAccountGroupRoutes}from"./channel-account-group-routes";
import{PgContentAssetLibraryRepository}from"./content-asset-library-postgres-store";
import{registerContentAssetLibraryRoutes}from"./content-asset-library-routes";
import{registerContentAssetSelectionRoutes}from"./content-asset-selection-routes";
import{PgCarouselStudioStore}from"./carousel-studio-postgres";
import{registerCarouselStudioRoutes}from"./carousel-studio-routes";
import{HmacObjectStorageTemporarySigner}from"./object-storage-temporary-signer";
import{S3PrivateCreativeObjectStore,S3TemporaryObjectSigner,s3PrivateObjectStorageConfigFromEnv}from"./private-object-storage";
import{CarouselRenderService}from"./carousel-render-service";
import{GoogleDriveContentAssetService}from"./google-drive-content-assets";
import{GoogleDriveOAuthClient}from"./google-drive-content-assets-client";
import{PgEncryptedContentAssetCredentialVault,PgGoogleDriveConnectionRepository}from"./google-drive-content-assets-postgres";
import{registerGoogleDriveContentAssetRoutes}from"./google-drive-content-assets-routes";
import{ObservedAgentRuntime}from"./operations-runtime";
import{PgOperationsTelemetrySink}from"./operations-telemetry-postgres";
import{PgBrandCreator}from"./brand-creator";
import{registerBrandRoutes}from"./brand-routes";
import {AgentRuntimeRouter,DirectModelRuntime,hermesBridgeRuntimeFromEnv}from"@kairo/worker/agent-runtime";import{openAICompatibleGatewayFromEnv}from"@kairo/worker/model-gateway";import{BrandBrainBuilder}from"@kairo/worker/brand-brain-builder";import{isHunterDeepAnalysisOutput}from"@kairo/worker/hunter-shadow-lane-adapters";import{DrafterGenerationAdapter}from"./drafter-adapter";
import{HunterOrchestrator,isHunterJudgmentOutput}from"@kairo/worker/hunter";
import{ResearcherOrchestrator,buildFocusedResearchQuery,extractResearchUrls,isResearcherOutput}from"@kairo/worker/researcher";
import{StrategistOrchestrator,isStrategistOutput}from"@kairo/worker/strategist";
import{PgIdeaDevelopmentLock}from"./idea-development-lock";
import{deterministicFallbackAngles}from"./deterministic-angle-fallback";
import{SourceRoutingToolGateway}from"@kairo/worker/discovery-provider";
import{CrossrefResearchEvidenceProvider,OpenAlexResearchEvidenceProvider}from"@kairo/worker/research-evidence-adapters";
import{RetryingDiscoverySourceProvider}from"@kairo/worker/retrying-discovery-provider";
import{DiscoveryService}from"@kairo/domain/discovery-service";
import{ReviewService}from"@kairo/domain/review-service";
import{validateCarouselPlan}from"@kairo/domain/creative-formats";
import{PerformanceCollectionWorker}from"@kairo/worker/performance";
import{InstagramMetricCollector}from"@kairo/worker/instagram-insights";
import{InstagramConnectionService}from"./instagram-connection";
import{PgEncryptedChannelCredentialVault,PgInstagramConnectionRepository}from"./instagram-connection-postgres";
import{MetaInstagramOAuthClient}from"./meta-instagram-oauth";
import{registerInstagramConnectionRoutes}from"./instagram-connection-routes";
import{MetaDirectInstagramOAuthClient}from"./meta-direct-instagram-oauth";
import{MetaFacebookOAuthClient}from"./meta-facebook-oauth";
import{MetaChannelConnectionService}from"./meta-channel-connection";
import{registerBrandDnaReadinessRoutes}from"./brand-dna-readiness-routes";
import{PgMetaConnectionRepository}from"./meta-channel-connection-postgres";
import{registerMetaChannelConnectionRoutes}from"./meta-channel-connection-routes";
import{InstagramMetricCollectionRunner,PgMetricCollectionJobStore}from"./instagram-metric-runner";
import{PgInstagramInsightsStatusStore,registerInstagramInsightsRoutes}from"./instagram-insights-routes";
import{
  executeMarketingShadowEvidenceAttempt,
  marketingShadowEvidenceRequestFromEnv,
  PgMarketingShadowEvidenceRunStore,
  safeFailureKind,
}from"./marketing-shadow-evidence-run";
import{directModelProviderDiagnosticRequested,runDirectModelProviderDiagnostic}from"./direct-model-diagnostic";
import{PublicBrandReferenceHttpReader}from"./public-brand-reference";
import{KairoInstagramPublisher}from"@kairo/domain/instagram-publisher";
import{RepositoryInstagramPublishingOperations,StoredInstagramInsightsReader}from"./instagram-mcp-adapters";
import{MetaMcpToolHandler}from"./meta-mcp-tools";
import{registerMetaMcpRoutes}from"./meta-mcp-routes";
import{SimpleCreationService}from"./simple-creation";import{PgSimpleCreationStore}from"./simple-creation-postgres";import{registerSimpleCreationRoutes}from"./simple-creation-routes";
import{homeMediaServiceFromEnv}from"./home-media-factory";
import{BrandPresenterService}from"./brand-presenter";import{registerBrandPresenterRoutes}from"./brand-presenter-routes";
import{SimplePublishFlowService}from"@kairo/domain/simple-publish-flow";import{PgSimplePublishFlowRepository}from"./simple-publish-flow-postgres";import{registerSimplePublishFlowRoutes}from"./simple-publish-flow-routes";
import{PgCommandSearchRepository}from"./command-search-postgres";import{registerCommandSearchRoutes}from"./command-search-routes";
import{PgBrandNotificationRepository}from"./brand-notifications-postgres";import{registerBrandNotificationRoutes}from"./brand-notifications-routes";
import{ConceptMockupAssetService}from"./concept-mockup-assets";import{registerConceptMockupAssetRoutes}from"./concept-mockup-asset-routes";
import{PgHunterOpportunityIntelligenceWriter}from"./hunter-opportunity-intelligence-postgres";import{executeHunterShadowEvidenceRun,hunterShadowEvidenceRequestFromEnv,hunterShadowSearchCostUsdBySourceFromEnv}from"./hunter-shadow-evidence-run";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });
const privateCarouselStorage=s3PrivateObjectStorageConfigFromEnv(process.env),legacyCarouselStorage=carouselObjectStorageConfig();
const carouselSigner=privateCarouselStorage?new S3TemporaryObjectSigner(privateCarouselStorage):legacyCarouselStorage?new HmacObjectStorageTemporarySigner(legacyCarouselStorage.publicBaseUrl,legacyCarouselStorage.signingSecret):undefined;
const conceptMockupAssets=new ConceptMockupAssetService(pool,privateCarouselStorage?new S3PrivateCreativeObjectStore(privateCarouselStorage):undefined,privateCarouselStorage?.provider,carouselSigner);
const coreStore=new PgKairoRepository(pool);
const discoveryStore=new PgDiscoveryRepository(pool);
const discoveryService=new DiscoveryService(discoveryStore);
const brandIntelligenceGraphStore=new PgBrandIntelligenceGraphStore(pool);
const hunterOpportunityIntelligenceWriter=new PgHunterOpportunityIntelligenceWriter(pool);
const researchStore=new PgResearchRepository(pool);
const campaignStore=new PgCampaignRepository(pool);
const reviewStore=new PgReviewRepository(pool);
const publishingStore=new PgPublishingRepository(pool);
const analyticsStore=new PgAnalyticsRepository(pool);
const groupStore=new PgChannelAccountGroupRepository(pool);
const contentAssetLibraryStore=new PgContentAssetLibraryRepository(pool);
const operationsStore=new PgOperationsRepository(pool);
const brandCreator=new PgBrandCreator(pool);
const telemetrySink=new PgOperationsTelemetrySink(pool,operationsStore);
const agentOutputValidators={
  "content-draft@1":(value:unknown)=>!!value&&typeof value==="object"&&typeof(value as{content?:unknown}).content==="string"&&Array.isArray((value as{supportingClaimIds?:unknown}).supportingClaimIds),
  "critic-review@1":(value:unknown)=>!!value&&typeof value==="object"&&typeof(value as{passed?:unknown}).passed==="boolean"&&typeof(value as{score?:unknown}).score==="number"&&Array.isArray((value as{findings?:unknown}).findings),
  "brand-brain-proposals@1":(value:unknown)=>!!value&&typeof value==="object"&&Array.isArray((value as{proposals?:unknown}).proposals),
  "hunter-opportunities@1":isHunterJudgmentOutput,
  "hunter-opportunities@2":isHunterJudgmentOutput,
  "hunter-deep-intelligence@1":isHunterDeepAnalysisOutput,
  "research-dossier@1":isResearcherOutput,
  "strategist-angles@1":isStrategistOutput,
  "marketing-carousel-plan@1":(value:unknown)=>{try{validateCarouselPlan(value as Parameters<typeof validateCarouselPlan>[0]);return true}catch{return false}},
};
const evidenceRequest=marketingShadowEvidenceRequestFromEnv();
const hunterShadowEvidenceRequest=hunterShadowEvidenceRequestFromEnv();
const hunterShadowSearchCosts=hunterShadowSearchCostUsdBySourceFromEnv();
const evidenceStore=evidenceRequest?new PgMarketingShadowEvidenceRunStore(pool):undefined;
const directModelDiagnosticRequested=directModelProviderDiagnosticRequested();
const gateway=openAICompatibleGatewayFromEnv();
const directRuntime=gateway?new DirectModelRuntime({gateway,policy:request=>({qualityTier:"balanced",privacyClass:"brand-private",maxCostUsd:request.budget.maxCostUsd,maxOutputTokens:request.budget.maxOutputTokens,allowedProviders:[]}),validators:agentOutputValidators}):null;
const directModelDiagnosticRuntime=gateway&&directModelDiagnosticRequested?new DirectModelRuntime({gateway,policy:request=>({qualityTier:"balanced",privacyClass:"global-public",maxCostUsd:request.budget.maxCostUsd,maxOutputTokens:request.budget.maxOutputTokens,allowedProviders:[]}),validators:{"direct-model-diagnostic@1":(value:unknown)=>!!value&&typeof value==="object"&&!Array.isArray(value)&&(value as{ok?:unknown}).ok===true&&Object.keys(value as Record<string,unknown>).length===1}}):null;
const hermesRuntime=hermesBridgeRuntimeFromEnv(agentOutputValidators);
const baseRuntime=hermesRuntime&&directRuntime?new AgentRuntimeRouter(hermesRuntime,directRuntime):(hermesRuntime??directRuntime??undefined);
const runtime=baseRuntime?new ObservedAgentRuntime(baseRuntime,telemetrySink):undefined;
const contentGenerator=runtime?new DrafterGenerationAdapter(runtime):undefined;const criticEvaluator=runtime?new CriticEvaluationAdapter(runtime):undefined;const brandBrainGenerator=runtime?new BrandBrainBuilder(runtime):undefined;
const hunter=runtime?new HunterOrchestrator(createHunterToolGateway(),runtime,discoveryService,configuredHunterSourceRegistry(),(diagnostic):void=>{app.log.warn({event:"hunter_dependency_failure",...diagnostic},"Hunter dependency degraded");},hunterOpportunityIntelligenceWriter):undefined;
const publicReferenceReader=new PublicBrandReferenceHttpReader({timeoutMs:10_000,maxBytes:2_000_000,maxRedirects:2});
const sharedSourceRouter=createSourceIntelligenceRouter({reader:publicReferenceReader});
const researchTools=createResearchToolGateway();
const researcher=runtime?new ResearcherOrchestrator(researchTools,runtime,researchStore):undefined;
const strategist=runtime?new StrategistOrchestrator(runtime,researchStore):undefined;
const ideaDevelopmentLock=new PgIdeaDevelopmentLock(pool);
const ideaDeveloper=researcher&&strategist?{
  async develop(input:{accountId:string;workspaceId:string;brandId:string;brandContextVersion:string;idea:{id:string;title:string;premise:string}}){
   return ideaDevelopmentLock.run(input.brandId,input.idea.id,async()=>{
    let bundle=await researchStore.getIdeaBundle(input.accountId,input.brandId,input.idea.id);
    if(!bundle)throw new Error("Idea not found");
    if(!bundle.research){
      const pinnedEvidence=await loadExplicitResearchEvidence(input.idea);
      await researcher.run({
        accountId:input.accountId,
        workspaceId:input.workspaceId,
        brandId:input.brandId,
        brandContextVersion:input.brandContextVersion,
        idea:input.idea,
        query:researchQuery(input.idea),
        ...(pinnedEvidence.length?{pinnedEvidence}:{}),
        maxEvidence:8,
      });
      bundle=await researchStore.getIdeaBundle(input.accountId,input.brandId,input.idea.id);
    }
    if(!bundle?.research)throw new Error("Research development did not persist a dossier");
    if(bundle.angles.length<2){
      try{
        await strategist.run({accountId:input.accountId,workspaceId:input.workspaceId,brandId:input.brandId,brandContextVersion:input.brandContextVersion,idea:input.idea,research:bundle.research});
      }catch{
        await researchStore.saveCandidateAngles(input.accountId,deterministicFallbackAngles({workspaceId:input.workspaceId,brandId:input.brandId,idea:input.idea,research:bundle.research}));
      }
    }
   });
  },
}:undefined;
const identityVerifier=new OidcJwtVerifier({
  issuer:requiredEnv("OIDC_ISSUER"),
  audience:requiredEnv("OIDC_AUDIENCE"),
  jwksUri:requiredEnv("OIDC_JWKS_URI"),
});
const app = buildApp({
  store:coreStore,
  discoveryStore,
  researchStore,
  ...(ideaDeveloper?{ideaDeveloper}:{}),
  campaignStore,
  reviewStore,
  publishingStore,
  analyticsStore,
  learningStore:new PgLearningRepository(pool),
  ...(contentGenerator?{contentGenerator}:{}),
  ...(criticEvaluator?{criticEvaluator}:{}),
  identityVerifier,
  logger: true,
});
const simpleCreationStore=new PgSimpleCreationStore(pool);
const homeMediaService=homeMediaServiceFromEnv(simpleCreationStore.homeMedia);
const simpleCreationReviewer=criticEvaluator?new ReviewService(campaignStore,researchStore,reviewStore,criticEvaluator):undefined;
registerBrandPresenterRoutes(app,{coreStore,identityVerifier,service:new BrandPresenterService(simpleCreationStore)});
let simpleCreationService:SimpleCreationService|undefined;let simpleCreationRunning=false;
if(ideaDeveloper){simpleCreationService=new SimpleCreationService(simpleCreationStore,researchStore,campaignStore,ideaDeveloper,undefined,undefined,contentGenerator,(accountId,brandId)=>coreStore.listBrandBrainFields(accountId,brandId),simpleCreationReviewer);registerSimpleCreationRoutes(app,{coreStore,identityVerifier,service:simpleCreationService,...(homeMediaService?{homeMedia:homeMediaService}:{}),trigger:()=>void collectSimpleCreationTick()});}
registerBrandRoutes(app,{store:coreStore,creator:brandCreator,identityVerifier});
registerCommandSearchRoutes(app,{coreStore,identityVerifier,search:new PgCommandSearchRepository(pool)});
registerOperationsRoutes(app,{store:operationsStore,coreStore,identityVerifier});
registerGuidedBrandBrainRoutes(app,{store:coreStore,identityVerifier,...(brandBrainGenerator?{generator:brandBrainGenerator}:{})});
registerBrandDnaReadinessRoutes(app,{store:coreStore,identityVerifier});
registerHunterRecommendationRoutes(app,{store:coreStore,identityVerifier,graphStore:brandIntelligenceGraphStore,discovery:discoveryService,onOpportunityDeveloped:async({accountId,brandId,opportunityId})=>{await conceptMockupAssets.generate(accountId,brandId,opportunityId);},...(hunter?{runner:hunter}:{})});
registerChannelAccountGroupRoutes(app,{coreStore,groupStore,channelStore:publishingStore,identityVerifier});
registerContentAssetLibraryRoutes(app,{coreStore,libraryStore:contentAssetLibraryStore,identityVerifier});
registerContentAssetSelectionRoutes(app,{coreStore,campaignStore,libraryStore:contentAssetLibraryStore,identityVerifier});
const carouselStore=new PgCarouselStudioStore(pool,undefined,undefined,carouselSigner,(accountId,brandId)=>coreStore.listBrandBrainFields(accountId,brandId)),carouselRenderer=privateCarouselStorage?new CarouselRenderService(carouselStore,new S3PrivateCreativeObjectStore(privateCarouselStorage),privateCarouselStorage.provider):undefined;
registerCarouselStudioRoutes(app,{coreStore,identityVerifier,store:carouselStore,...(carouselRenderer?{renderer:carouselRenderer}:{})});
registerConceptMockupAssetRoutes(app,{store:coreStore,identityVerifier,service:conceptMockupAssets});
registerSimplePublishFlowRoutes(app,{coreStore,identityVerifier,service:new SimplePublishFlowService(new PgSimplePublishFlowRepository(pool,carouselSigner))});
registerBrandNotificationRoutes(app,{coreStore,identityVerifier,repository:new PgBrandNotificationRepository(pool)});

const googleDrive=googleDriveConfig();
let googleDriveService:GoogleDriveContentAssetService|undefined;
if(googleDrive){
  googleDriveService=new GoogleDriveContentAssetService({
    brands:coreStore,
    libraries:contentAssetLibraryStore,
    connections:new PgGoogleDriveConnectionRepository(pool),
    vault:new PgEncryptedContentAssetCredentialVault(pool,googleDrive.encryptionKey),
    oauth:new GoogleDriveOAuthClient(googleDrive.clientId,googleDrive.clientSecret,googleDrive.redirectUri),
    picker:{developerKey:googleDrive.pickerApiKey,appId:googleDrive.pickerAppId},
  });
}
registerGoogleDriveContentAssetRoutes(app,{coreStore,identityVerifier,...(googleDriveService?{service:googleDriveService}:{})});
registerReadinessRoutes(app,{releaseSha:requiredEnv("KAIRO_RELEASE_SHA"),check:async()=>{await pool.query("select 1")}});
registerInstagramInsightsRoutes(app,{coreStore,identityVerifier,store:new PgInstagramInsightsStatusStore(pool)});
registerMetaMcpRoutes(app,{coreStore,identityVerifier,handler:new MetaMcpToolHandler(new KairoInstagramPublisher(new RepositoryInstagramPublishingOperations(publishingStore)),new StoredInstagramInsightsReader(analyticsStore))});

const meta=metaInstagramConfig();
let instagramMetricRunner:InstagramMetricCollectionRunner|undefined;
let instagramConnectionRepo:PgInstagramConnectionRepository|undefined;
if(meta){
  const vault=new PgEncryptedChannelCredentialVault(pool,meta.encryptionKey);
  instagramConnectionRepo=new PgInstagramConnectionRepository(pool);
  const connectionService=new InstagramConnectionService({
    brands:coreStore,
    publishing:publishingStore,
    knowledge:coreStore,
    repo:instagramConnectionRepo,
    vault,
    meta:new MetaInstagramOAuthClient(meta.appId,meta.appSecret,meta.graphVersion,meta.redirectUri),
  });
  registerInstagramConnectionRoutes(app,{coreStore,identityVerifier,service:connectionService});
  const direct=metaDirectInstagramConfig(meta.graphVersion);
  if(direct){
    registerMetaChannelConnectionRoutes(app,{coreStore,identityVerifier,service:new MetaChannelConnectionService({
      brands:coreStore,
      publishing:publishingStore,
      knowledge:coreStore,
      repo:new PgMetaConnectionRepository(pool),
      vault,
      directInstagram:new MetaDirectInstagramOAuthClient(direct.appId,direct.appSecret,direct.graphVersion,direct.redirectUri),
      facebook:new MetaFacebookOAuthClient(meta.appId,meta.appSecret,meta.graphVersion,meta.redirectUri),
    })});
  }
  instagramMetricRunner=new InstagramMetricCollectionRunner(
    new PgMetricCollectionJobStore(pool),
    new PerformanceCollectionWorker([new InstagramMetricCollector(vault,meta.graphVersion)]),
    `api-${process.pid}`,
  );
}

const port = Number(process.env.PORT ?? "4000");
const host = process.env.HOST ?? "0.0.0.0";
let metricTimer:NodeJS.Timeout|undefined;
let metricTickRunning=false;
let evidenceTimer:NodeJS.Timeout|undefined;
let evidenceTickRunning=false;
let evidenceTerminal=false;
let simpleCreationTimer:NodeJS.Timeout|undefined;

try {
  await app.listen({ port, host });
  if(simpleCreationService){void collectSimpleCreationTick();simpleCreationTimer=setInterval(()=>void collectSimpleCreationTick(),5_000);simpleCreationTimer.unref();}
  if(instagramMetricRunner){
    void collectMetricTick();
    metricTimer=setInterval(()=>void collectMetricTick(),60_000);
    metricTimer.unref();
  }
  if(directModelDiagnosticRequested){
    if(!directModelDiagnosticRuntime){
      app.log.error("KAIRO_DIRECT_MODEL_PROVIDER_DIAGNOSTIC_FAILED: DirectModelRuntime is not configured");
    }else{
      void runDirectModelProviderDiagnostic(directModelDiagnosticRuntime)
        .then(metadata=>app.log.warn({metadata},"KAIRO_DIRECT_MODEL_PROVIDER_DIAGNOSTIC_OK"))
        .catch(error=>app.log.error({err:error},"KAIRO_DIRECT_MODEL_PROVIDER_DIAGNOSTIC_FAILED"));
    }
  }
  if(evidenceRequest){
    if(!directRuntime){
      evidenceTerminal=true;
      app.log.error({runId:evidenceRequest.runId,releaseSha:evidenceRequest.releaseSha},"KAIRO_MARKETING_SHADOW_EVIDENCE_FAILED: DirectModelRuntime is not configured");
    }else{
      void collectEvidenceTick();
      evidenceTimer=setInterval(()=>void collectEvidenceTick(),5_000);
      evidenceTimer.unref();
    }
  }
  if(hunterShadowEvidenceRequest){
    if(!baseRuntime){
      app.log.error({runId:hunterShadowEvidenceRequest.runId,releaseSha:hunterShadowEvidenceRequest.releaseSha},"KAIRO_HUNTER_SHADOW_EVIDENCE_FAILED: base AgentRuntime is not configured");
    }else{
      void executeHunterShadowEvidenceRun({
        pool,
        store:coreStore,
        discovery:discoveryService,
        tools:createHunterToolGateway(),
        runtime:baseRuntime,
        sourceRegistry:configuredHunterSourceRegistry(),
        request:hunterShadowEvidenceRequest,
        searchCostUsdBySource:hunterShadowSearchCosts,
      }).then(evidence=>app.log.info({evidence},"KAIRO_HUNTER_SHADOW_EVIDENCE_COMPLETE"))
        .catch(error=>app.log.error({err:error,runId:hunterShadowEvidenceRequest.runId,releaseSha:hunterShadowEvidenceRequest.releaseSha},"KAIRO_HUNTER_SHADOW_EVIDENCE_FAILED"));
    }
  }
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
async function collectSimpleCreationTick(){if(simpleCreationRunning||!simpleCreationService)return;simpleCreationRunning=true;try{for(let i=0;i<3&&await simpleCreationService.runOnce(`api-${process.pid}`);i++);}catch(error){app.log.error({err:error},"simple creation runner failed");}finally{simpleCreationRunning=false;}}

async function collectMetricTick(){
  if(metricTickRunning||!instagramMetricRunner)return;
  metricTickRunning=true;
  try{
    const at=new Date().toISOString();
    await instagramConnectionRepo?.purgeExpiredPendingCredentials(at);
    await instagramConnectionRepo?.markExpiredConnectionsReconnectRequired(at);
    for(let i=0;i<5;i++)if(!(await instagramMetricRunner.runOnce()))break;
  }catch(error){app.log.error({err:error},"Instagram maintenance tick failed")}finally{metricTickRunning=false}
}

async function collectEvidenceTick(){
  if(evidenceTickRunning||evidenceTerminal||!evidenceRequest||!directRuntime||!evidenceStore)return;
  evidenceTickRunning=true;
  try{
    const result=await executeMarketingShadowEvidenceAttempt(evidenceStore,directRuntime,evidenceRequest);
    if(result.kind==="skipped"){
      if(result.priorStatus==="not-authorized")return;
      evidenceTerminal=true;
      stopEvidenceTimer();
      app.log.warn({runId:evidenceRequest.runId,releaseSha:evidenceRequest.releaseSha,priorStatus:result.priorStatus},"KAIRO_MARKETING_SHADOW_EVIDENCE_SKIPPED_ALREADY_CONSUMED");
      return;
    }
    evidenceTerminal=true;
    stopEvidenceTimer();
    app.log.info({
      runId:evidenceRequest.runId,
      releaseSha:evidenceRequest.releaseSha,
      persisted:true,
      pairCount:result.evidence.pairs.length,
      runtimeRoute:result.evidence.runtimeRoute,
    },"KAIRO_MARKETING_SHADOW_EVIDENCE_COMPLETE");
  }catch(error){
    const failureKind=safeFailureKind(error);
    let status:Awaited<ReturnType<PgMarketingShadowEvidenceRunStore["status"]>>|undefined;
    try{status=await evidenceStore.status(evidenceRequest.runId,evidenceRequest.releaseSha)}catch{}
    if(status==="authorized"){
      app.log.warn({runId:evidenceRequest.runId,releaseSha:evidenceRequest.releaseSha,failureKind},"KAIRO_MARKETING_SHADOW_EVIDENCE_CONTROL_RETRY");
      return;
    }
    if(status===undefined){
      app.log.error({runId:evidenceRequest.runId,releaseSha:evidenceRequest.releaseSha,failureKind},"KAIRO_MARKETING_SHADOW_EVIDENCE_CONTROL_CHECK_FAILED");
      return;
    }
    evidenceTerminal=true;
    stopEvidenceTimer();
    app.log.error({runId:evidenceRequest.runId,releaseSha:evidenceRequest.releaseSha,status,failureKind},"KAIRO_MARKETING_SHADOW_EVIDENCE_FAILED");
  }finally{evidenceTickRunning=false}
}

function stopEvidenceTimer(){if(evidenceTimer){clearInterval(evidenceTimer);evidenceTimer=undefined}}

async function shutdown(): Promise<void> {
  if(metricTimer)clearInterval(metricTimer);
  if(simpleCreationTimer)clearInterval(simpleCreationTimer);
  stopEvidenceTimer();
  await app.close();
  await pool.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

function createResearchToolGateway(){
  const openAlexBase=new OpenAlexResearchEvidenceProvider({apiKey:process.env.OPENALEX_API_KEY});
  const crossrefBase=new CrossrefResearchEvidenceProvider({contactEmail:process.env.CROSSREF_CONTACT_EMAIL,userAgent:"Kairo/0.1"});
  const openAlex=new RetryingDiscoverySourceProvider(openAlexBase);
  const crossref=new RetryingDiscoverySourceProvider(crossrefBase);
  const fallback={
    async discover(request:Parameters<OpenAlexResearchEvidenceProvider["discover"]>[0]){
      const settled=await Promise.allSettled([openAlex.discover(request),crossref.discover(request)]);
      const evidence=settled.flatMap(result=>result.status==="fulfilled"?result.value:[]);
      const unique=[...new Map(evidence.map(item=>[item.sourceUrl,item])).values()].slice(0,request.maxResults);
      if(unique.length)return unique;
      const failed=settled.find(result=>result.status==="rejected");
      if(failed?.status==="rejected")throw failed.reason;
      return [];
    },
  };
  return new SourceRoutingToolGateway(fallback,{openalex:openAlex,crossref},sharedSourceRouter);
}

async function loadExplicitResearchEvidence(idea:{title:string;premise:string}){
  const urls=extractResearchUrls(idea);
  if(!urls.length)return[];
  const documents=await Promise.all(urls.map(async url=>(await sharedSourceRouter.fetch({url,scope:{visibility:"global-public"},timeoutMs:20_000})).document));
  return documents.map(document=>{
    const publisher=document.publisher??new URL(document.canonicalUrl).hostname.toLowerCase();
    const summary=[document.description,document.transcript,document.body].filter((value):value is string=>typeof value==="string"&&value.trim().length>0).join("\n").slice(0,8_000);
    return{
      title:document.title?.trim()||publisher,
      ...(summary?{summary}:{}),
      sourceUrl:document.canonicalUrl,
      platform:document.platform,
      publisher,
      retrievedAt:document.retrievedAt,
      provider:document.provider,
      providerVersion:document.providerVersion,
      contentHash:document.contentHash.replace(/^sha256:/,""),
    };
  });
}

function researchQuery(idea:{title:string;premise:string}){
  return buildFocusedResearchQuery(idea);
}

function metaInstagramConfig(){
  const names=["META_APP_ID","META_APP_SECRET","META_GRAPH_VERSION","META_OAUTH_REDIRECT_URI","CHANNEL_CREDENTIAL_ENCRYPTION_KEY"] as const;
  const values=Object.fromEntries(names.map(name=>[name,process.env[name]?.trim()??""])) as Record<(typeof names)[number],string>;
  if(names.every(name=>!values[name]))return null;
  const missing=names.filter(name=>!values[name]);
  if(missing.length)throw new Error(`Meta Instagram configuration is incomplete: ${missing.join(", ")}`);
  return{appId:values.META_APP_ID,appSecret:values.META_APP_SECRET,graphVersion:values.META_GRAPH_VERSION,redirectUri:values.META_OAUTH_REDIRECT_URI,encryptionKey:values.CHANNEL_CREDENTIAL_ENCRYPTION_KEY};
}

function carouselObjectStorageConfig(){
  const publicBaseUrl=process.env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim()??"",signingSecret=process.env.OBJECT_STORAGE_SIGNING_SECRET?.trim()??"";
  if(!publicBaseUrl&&!signingSecret)return null;
  if(!publicBaseUrl||!signingSecret)throw new Error("Carousel object-storage signing configuration is incomplete");
  return{publicBaseUrl,signingSecret};
}

function metaDirectInstagramConfig(graphVersion:string){
  const names=["META_INSTAGRAM_APP_ID","META_INSTAGRAM_APP_SECRET","META_INSTAGRAM_OAUTH_REDIRECT_URI"] as const;
  const values=Object.fromEntries(names.map(name=>[name,process.env[name]?.trim()??""])) as Record<(typeof names)[number],string>;
  if(names.every(name=>!values[name]))return null;
  const missing=names.filter(name=>!values[name]);
  if(missing.length)throw new Error(`Meta Instagram Login configuration is incomplete: ${missing.join(", ")}`);
  return{appId:values.META_INSTAGRAM_APP_ID,appSecret:values.META_INSTAGRAM_APP_SECRET,redirectUri:values.META_INSTAGRAM_OAUTH_REDIRECT_URI,graphVersion};
}

function googleDriveConfig(){
  const names=["GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_CLIENT_SECRET","GOOGLE_DRIVE_OAUTH_REDIRECT_URI","GOOGLE_DRIVE_PICKER_API_KEY","GOOGLE_DRIVE_PICKER_APP_ID","CONTENT_ASSET_CREDENTIAL_ENCRYPTION_KEY"] as const;
  const values=Object.fromEntries(names.map(name=>[name,process.env[name]?.trim()??""])) as Record<(typeof names)[number],string>;
  if(names.every(name=>!values[name]))return null;
  const missing=names.filter(name=>!values[name]);
  if(missing.length)throw new Error(`Google Drive Content Asset configuration is incomplete: ${missing.join(", ")}`);
  return{clientId:values.GOOGLE_DRIVE_CLIENT_ID,clientSecret:values.GOOGLE_DRIVE_CLIENT_SECRET,redirectUri:values.GOOGLE_DRIVE_OAUTH_REDIRECT_URI,pickerApiKey:values.GOOGLE_DRIVE_PICKER_API_KEY,pickerAppId:values.GOOGLE_DRIVE_PICKER_APP_ID,encryptionKey:values.CONTENT_ASSET_CREDENTIAL_ENCRYPTION_KEY};
}
