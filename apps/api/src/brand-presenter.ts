import { randomUUID } from "node:crypto";
import { ConcurrencyConflictError, DomainValidationError } from "@kairo/domain";
import type {
  BrandPresenterCapabilitiesDto,
  BrandPresenterDto,
  BrandPresenterEligibilityDto,
  BrandPresenterResponse,
  PutBrandPresenterRequest,
} from "@kairo/contracts/presenter";
import { UnavailableAvatarProvider, type AvatarProvider } from "./avatar-provider";

export interface BrandPresenterStore {
  getPresenter(workspaceId: string, brandId: string): Promise<BrandPresenterDto | null>;
  putPresenter(value: BrandPresenterDto, expectedVersion?: number): Promise<BrandPresenterDto>;
}

export class BrandPresenterService {
  constructor(
    private store: BrandPresenterStore,
    private now = () => new Date(),
    private avatarProvider: AvatarProvider = new UnavailableAvatarProvider(),
  ) {}

  async get(workspaceId: string, brandId: string): Promise<BrandPresenterResponse> {
    const [presenter, capabilities] = await Promise.all([
      this.store.getPresenter(workspaceId, brandId),
      this.avatarProvider.getCapabilities({ workspaceId, brandId }),
    ]);
    return {
      presenter,
      capabilities,
      eligibility: presenter ? presenterEligibility(presenter, capabilities) : null,
    };
  }

  async save(workspaceId: string, brandId: string, raw: PutBrandPresenterRequest): Promise<BrandPresenterResponse> {
    const current = await this.store.getPresenter(workspaceId, brandId);
    if (current) {
      if (raw.expectedVersion !== current.version) {
        throw new ConcurrencyConflictError("Presenter changed. Refresh and try again.");
      }
    } else if (raw.expectedVersion !== undefined) {
      throw new ConcurrencyConflictError("Presenter changed. Refresh and try again.");
    }

    const at = this.now().toISOString();
    const value: BrandPresenterDto = {
      id: current?.id ?? randomUUID(),
      workspaceId,
      brandId,
      displayName: requiredText(raw.displayName, "displayName", 120),
      status: enumValue(raw.status, ["draft", "ready", "disabled"] as const, "status"),
      mode: enumValue(raw.mode, ["basic", "talking-avatar", "hybrid-explainer"] as const, "mode"),
      ...optionalField("visualStyle", raw.visualStyle, 240),
      ...optionalField("voiceStyle", raw.voiceStyle, 240),
      ...optionalField("locale", raw.locale, 80),
      ...optionalField("accent", raw.accent, 120),
      ...optionalField("pace", raw.pace, 80),
      ...optionalField("framing", raw.framing, 160),
      ...optionalField("background", raw.background, 240),
      ...optionalField("introStyle", raw.introStyle, 240),
      ...optionalField("outroStyle", raw.outroStyle, 240),
      ...optionalField("captionPreference", raw.captionPreference, 160),
      version: current ? current.version + 1 : 1,
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
    };
    const presenter = await this.store.putPresenter(value, raw.expectedVersion);
    const capabilities = await this.avatarProvider.getCapabilities({ workspaceId, brandId });
    return {
      presenter,
      capabilities,
      eligibility: presenterEligibility(presenter, capabilities),
    };
  }

  async requireEligible(workspaceId: string, brandId: string, presenterId: string): Promise<BrandPresenterDto> {
    const presenter = await this.store.getPresenter(workspaceId, brandId);
    if (!presenter || presenter.id !== presenterId || presenter.status !== "ready") {
      throw new DomainValidationError("Presenter is not available for this Brand");
    }
    const capabilities = await this.avatarProvider.getCapabilities({ workspaceId, brandId });
    if (presenterEligibility(presenter, capabilities).status !== "eligible") {
      throw new DomainValidationError("Presenter rendering is not available for this Brand");
    }
    return presenter;
  }
}

function presenterEligibility(
  presenter: BrandPresenterDto,
  capabilities: BrandPresenterCapabilitiesDto,
): BrandPresenterEligibilityDto {
  if (presenter.status === "disabled") {
    return { status: "disabled", reason: "Presenter is disabled" };
  }
  if (presenter.status !== "ready") {
    return { status: "draft", reason: "Presenter profile is still a draft" };
  }
  if (!capabilities.providerConfigured || !capabilities.avatarRendering) {
    return {
      status: "provider-unavailable",
      reason: capabilities.reason ?? "Avatar rendering provider is not available",
    };
  }
  return { status: "eligible" };
}

function requiredText(value: unknown, field: string, max: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new DomainValidationError(`${field} is required`);
  if (normalized.length > max) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function optionalField<K extends string>(key: K, value: unknown, max: number): Partial<Record<K, string>> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") throw new DomainValidationError(`${key} must be text`);
  const normalized = value.trim();
  if (!normalized) return {};
  if (normalized.length > max) throw new DomainValidationError(`${key} is too long`);
  return { [key]: normalized } as Partial<Record<K, string>>;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new DomainValidationError(`${field} is invalid`);
  }
  return value as T;
}
