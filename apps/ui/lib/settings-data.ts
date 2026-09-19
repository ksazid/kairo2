export type SettingsAccount = {
  id?: string;
  displayName: string;
  email?: string;
};

export type SettingsWorkspace = {
  id: string;
  name: string;
  role: "owner" | "member";
};

export type SettingsBrand = {
  id: string;
  workspaceId: string;
  name: string;
};

export type SettingsChannel = {
  id: string;
  channel: "instagram" | "linkedin" | "facebook" | "manual";
  displayName: string;
  accountRef: string;
  status: "connected" | "reconnect-required" | "disabled";
  capabilities: string[];
};

export type PresenterCapabilities = {
  providerConfigured: boolean;
  avatarRendering: boolean;
  testClip: boolean;
  reason?: string;
};

export type SettingsPresenter = {
  id: string;
  displayName: string;
  status: "draft" | "ready" | "disabled";
  mode: "basic" | "talking-avatar" | "hybrid-explainer";
  visualStyle?: string;
  voiceStyle?: string;
  background?: string;
  version: number;
  updatedAt: string;
};

export type PresenterResponse = {
  presenter: SettingsPresenter | null;
  capabilities: PresenterCapabilities;
  eligibility: { status: "eligible" | "draft" | "provider-unavailable" | "disabled"; reason?: string } | null;
};

export type SettingsData = {
  authenticated: boolean;
  account: SettingsAccount;
  workspace: SettingsWorkspace | null;
  brand: SettingsBrand | null;
  channels: SettingsChannel[];
  presenter: PresenterResponse | null;
};

export function settingsFallback(): SettingsData {
  return {
    authenticated: false,
    account: { displayName: "Guest" },
    workspace: null,
    brand: null,
    channels: [],
    presenter: null,
  };
}

export function canPublish(channel: SettingsChannel): boolean {
  return channel.status === "connected" && channel.capabilities.includes("content-publishing");
}

export function channelSettingsHref(brandId: string): string {
  return `/settings?tab=channels&brand=${encodeURIComponent(brandId)}`;
}

export function presenterDraft(input: {
  brandName: string;
  look: string;
  background: string;
  voiceEnabled: boolean;
  expectedVersion?: number;
}) {
  return {
    displayName: `${input.brandName.trim() || "Brand"} Creator`,
    status: "draft" as const,
    mode: input.voiceEnabled ? "talking-avatar" as const : "basic" as const,
    visualStyle: input.look,
    background: input.background,
    voiceStyle: input.voiceEnabled ? "Voice requested; enrollment not configured" : "No voice",
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  };
}
