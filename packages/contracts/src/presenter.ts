export type BrandPresenterStatus = "draft" | "ready" | "disabled";
export type BrandPresenterMode = "basic" | "talking-avatar" | "hybrid-explainer";
export type BrandPresenterEligibilityStatus = "eligible" | "draft" | "provider-unavailable" | "disabled";

export interface BrandPresenterDto {
  id: string;
  workspaceId: string;
  brandId: string;
  displayName: string;
  status: BrandPresenterStatus;
  mode: BrandPresenterMode;
  visualStyle?: string;
  voiceStyle?: string;
  locale?: string;
  accent?: string;
  pace?: string;
  framing?: string;
  background?: string;
  introStyle?: string;
  outroStyle?: string;
  captionPreference?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PutBrandPresenterRequest {
  displayName: string;
  status: BrandPresenterStatus;
  mode: BrandPresenterMode;
  visualStyle?: string;
  voiceStyle?: string;
  locale?: string;
  accent?: string;
  pace?: string;
  framing?: string;
  background?: string;
  introStyle?: string;
  outroStyle?: string;
  captionPreference?: string;
  expectedVersion?: number;
}

export interface BrandPresenterCapabilitiesDto {
  providerConfigured: boolean;
  avatarRendering: boolean;
  testClip: boolean;
  reason?: string;
}

export interface BrandPresenterEligibilityDto {
  status: BrandPresenterEligibilityStatus;
  reason?: string;
}

export interface BrandPresenterResponse {
  presenter: BrandPresenterDto | null;
  capabilities: BrandPresenterCapabilitiesDto;
  eligibility: BrandPresenterEligibilityDto | null;
}

export interface SimpleCreationPresenterDto {
  id: string;
  displayName: string;
  mode: BrandPresenterMode;
}
