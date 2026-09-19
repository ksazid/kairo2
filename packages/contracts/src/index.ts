export type WorkspaceRole = "owner" | "member";

export interface ExternalIdentity {
  provider: string;
  subject: string;
  email?: string;
  displayName?: string;
}

export interface AccountDto {
  id: string;
  email?: string;
  displayName?: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface BrandDto {
  id: string;
  workspaceId: string;
  name: string;
  publicSourceUrl?: string;
  publicProfileUrl?: string;
}

export interface CreateWorkspaceWithBrandRequest {
  workspaceName: string;
  brandName: string;
  publicSourceUrl?: string;
  publicProfileUrl?: string;
}

export interface CreateWorkspaceWithBrandResponse {
  workspace: WorkspaceDto;
  brand: BrandDto;
}

export interface CreateBrandRequest {
  brandName: string;
  publicSourceUrl?: string;
  publicProfileUrl?: string;
}

export interface SessionResponse {
  account: AccountDto;
  workspaces: WorkspaceDto[];
}

export type BrandBrainFieldState = "inferred" | "confirmed" | "stale";
export type BrandBrainSection =
  | "identity"
  | "positioning"
  | "audience"
  | "voice"
  | "content-strategy"
  | "goals"
  | "boundaries";

export interface BrandBrainFieldDto {
  id: string;
  workspaceId: string;
  brandId: string;
  section: BrandBrainSection;
  fieldKey: string;
  value: string;
  state: BrandBrainFieldState;
  sourceIds: string[];
  version: number;
  updatedAt: string;
  confirmedByAccountId?: string;
}

export interface PutBrandBrainFieldRequest {
  section: BrandBrainSection;
  value: string;
  expectedVersion?: number;
}

export type GuidedBrandObjective =
  | "grow-audience"
  | "build-authority"
  | "generate-leads"
  | "build-community"
  | "promote-offer";

export interface BuildBrandBrainRequest {
  primaryObjective?: GuidedBrandObjective;
  publicReferenceUrl?: string;
  ownerBoundary?: string;
}

export interface BrandBrainBuildResponse {
  brain: BrandBrainFieldDto[];
  generatorStatus: "generated" | "unavailable";
  proposedCount: number;
  skippedConfirmedCount: number;
  sourceIds: string[];
}

export type BrandDnaReadinessStatus = "ready" | "needs-enrichment";
export type BrandDnaReadinessGap = "business" | "offerings" | "audience" | "positioning" | "topics" | "boundaries" | "geography";
export type BrandDnaReadinessAction =
  | { type: "add-source"; prompt: string; acceptedSource: "website" | "public-link" }
  | { type: "confirm-field"; fieldKey: string; prompt: string }
  | { type: "confirm-none"; fieldKey: "boundaries.excluded-topics"; prompt: string };

export interface BrandDnaReadinessResponse {
  status: BrandDnaReadinessStatus;
  score: number;
  brandIntelligenceScore: number;
  evidenceCoverage: number;
  confidence: number;
  gaps: BrandDnaReadinessGap[];
  nextAction?: BrandDnaReadinessAction;
  evaluatedAt: string;
}

export type KnowledgeSourceType = "url" | "website" | "document" | "note" | "pasted" | "research" | "product";
export type KnowledgeSourceStatus = "active" | "disabled" | "replaced" | "removed" | "quarantined" | "failed";

export interface KnowledgeSourceDto {
  id: string;
  workspaceId: string;
  brandId: string;
  type: KnowledgeSourceType;
  status: KnowledgeSourceStatus;
  title?: string;
  sourceUrl?: string;
  contentType?: string;
  sizeBytes?: number;
  contentHash?: string;
  hasPrivateContent: boolean;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
}

export interface CreateKnowledgeSourceRequest {
  type: KnowledgeSourceType;
  title?: string;
  url?: string;
  content?: string;
  contentType?: string;
  sizeBytes?: number;
  contentHash?: string;
}

export interface PublicSignalDto {
  id: string;
  title: string;
  summary?: string;
  sourceUrl: string;
  duplicateKey: string;
  platform: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: string;
  provider: string;
  providerVersion?: string;
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}

export type OpportunityStatus = "new" | "saved" | "ignored" | "developing";
export type OpportunityAction = "save" | "ignore" | "develop";

export interface OpportunityScoresDto {
  relevance: number;
  evidence: number;
  novelty: number;
  timeliness: number;
  brandAuthority: number;
  audienceFit: number;
  overall: number;
  scoringVersion: string;
}

export interface OpportunityDetailsDto {
  topic: string;
  proposedAngle: string;
  hook: string;
  targetAudience: string;
  objective: string;
  recommendedFormat: string;
  recommendedChannel: string;
  supportingSourceIds: string[];
  confidence: number;
  expiresAt?: string;
  estimatedEffort: "low" | "medium" | "high";
  intelligenceVersion?: number;
}

export interface BrandOpportunityDto {
  id: string;
  workspaceId: string;
  brandId: string;
  title: string;
  rationale: string;
  whyNow: string;
  developmentDirection: string;
  status: OpportunityStatus;
  signalIds: string[];
  scores: OpportunityScoresDto;
  brandContextVersion: string;
  details?: OpportunityDetailsDto;
  createdAt: string;
  updatedAt: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  correlationId?: string;
}

export type ContentDevelopmentType = "carousel" | "reel";
export type CarouselStructure = "aida" | "pas" | "listicle" | "case-study" | "story" | "comparison";
export type CarouselSlideRole = "hook" | "attention" | "interest" | "desire" | "problem" | "agitation" | "solution" | "list-item" | "context" | "challenge" | "approach" | "result" | "story-beat" | "comparison" | "evidence" | "insight" | "cta";
export type ReelSceneRole = "hook" | "problem" | "insight" | "evidence" | "solution" | "cta" | "story-beat";

export interface ContentDevelopmentLineageDto {
  ideaId: string;
  angleId: string;
  supportingClaimIds: string[];
}

export interface ProductionCarouselSlideDto {
  id: string;
  role: CarouselSlideRole;
  headline: string;
  body: string;
  imageAssetId?: string;
  supportingClaimIds: string[];
}

export interface ProductionCarouselProjectDto {
  schemaVersion: 1;
  format: "carousel";
  structure: CarouselStructure;
  coverHook: string;
  caption: string;
  cta: string;
  slides: ProductionCarouselSlideDto[];
  supportingClaimIds: string[];
}

export interface ProductionReelSceneDto {
  id: string;
  role: ReelSceneRole;
  startSecond: number;
  endSecond: number;
  visual: string;
  onScreenText: string;
  voiceover: string;
  supportingClaimIds: string[];
}

export interface ProductionReelProjectDto {
  schemaVersion: 1;
  contentType: "reel";
  title: string;
  hook: string;
  targetDurationSeconds: number;
  caption: string;
  cta: string;
  scenes: ProductionReelSceneDto[];
  supportingClaimIds: string[];
}

export type ProductionContentProjectDto = ProductionCarouselProjectDto | ProductionReelProjectDto;

export interface StructuredContentDevelopmentDto {
  schemaVersion: 1;
  lineage: ContentDevelopmentLineageDto;
  contentType: ContentDevelopmentType;
  recommendationRationale: string;
  project: ProductionContentProjectDto;
}

export interface SimpleReviewSummaryDto{status:"needs-review"|"ready";contentType:"image"|"carousel"|"reel"|"video"|"text";title:string;itemCount:number;approvedAssetVersionId?:string;previewUrls:string[];quality:{status:"unchecked"|"passed"|"blocked";blockingIssues:number}}
export interface SimplePublishReadinessDto{status:"needs-review"|"needs-destination"|"ready"|"scheduled";destination?:{channel:string;accountRef:string;displayName:string;health:"connected"|"reconnect-required"|"disabled"};scheduledFor?:string;reason?:string}
export interface SimplePublishResultDto{status:"not-started"|"approved"|"publishing"|"processing"|"published"|"failed";publishCommandId?:string;publishId?:string;publishedUrl?:string;failureReason?:string;publishedAt?:string}
export interface SimplePerformanceMetricDto{name:string;status:"available"|"unavailable";value?:number;capturedAt:string;reason?:string}
export interface SimpleAdvancedLinkDto{key:"media-editor"|"approval-history"|"publishing-details"|"performance-details";label:string;href:string}
export type BrandNotificationKind="approval-required"|"publishing-failed"|"connection-reconnect-required";
export interface BrandNotificationDto{id:string;kind:BrandNotificationKind;brandId:string;occurredAt:string;source:{type:"content-review"|"publish-command"|"channel-account";id:string};context:{campaignId?:string;assetId?:string;channel?:string;accountRef?:string;failureReason?:string}}
export interface BrandNotificationsDto{brandId:string;items:BrandNotificationDto[]}
export interface SimpleReviewPublishResultsDto{brandId:string;campaignId:string;assetId:string;review:SimpleReviewSummaryDto;publish:SimplePublishReadinessDto;result:SimplePublishResultDto;performance:{status:"waiting"|"available";metrics:SimplePerformanceMetricDto[]};advancedLinks:SimpleAdvancedLinkDto[]}

export type MetaMcpToolName="publish_reel"|"publish_carousel"|"publish_image"|"get_publish_status"|"get_instagram_insights";
export type InstagramPublishToolInput={brandId:string;publishCommandId:string};
export type GetPublishStatusToolInput={brandId:string;publishCommandId:string};
export type GetInstagramInsightsToolInput={brandId:string;publishedPostId:string};
export type MetaMcpToolInputMap={publish_reel:InstagramPublishToolInput;publish_carousel:InstagramPublishToolInput;publish_image:InstagramPublishToolInput;get_publish_status:GetPublishStatusToolInput;get_instagram_insights:GetInstagramInsightsToolInput};
export type InstagramPublishToolResult={publishCommandId:string;status:"approved"|"publishing"|"processing"|"published"|"failed";containerId?:string;publishId?:string;publishedUrl?:string;failureReason?:string};
export type InstagramInsightValue={name:string;status:"available"|"unavailable";value?:number;reason?:string;capturedAt:string};
export type GetInstagramInsightsToolResult={publishedPostId:string;metrics:InstagramInsightValue[]};
export type MetaMcpToolResultMap={publish_reel:InstagramPublishToolResult;publish_carousel:InstagramPublishToolResult;publish_image:InstagramPublishToolResult;get_publish_status:InstagramPublishToolResult;get_instagram_insights:GetInstagramInsightsToolResult};
export interface MetaMcpToolDefinition{name:MetaMcpToolName;description:string;inputSchema:{type:"object";additionalProperties:false;required:readonly string[];properties:Record<string,{type:"string";minLength:number;maxLength:number}>}}

export type CommandSearchResultKind = "brand" | "campaign" | "content-asset";

export interface CommandSearchResultDto {
  kind: CommandSearchResultKind;
  id: string;
  brandId: string;
  brandName: string;
  label: string;
  detail: string;
  href: string;
  campaignId?: string;
}

export interface CommandSearchResponse {
  query: string;
  scope: { brandId?: string };
  results: CommandSearchResultDto[];
}
