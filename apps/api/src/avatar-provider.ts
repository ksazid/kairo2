export interface AvatarProviderCapabilities {
  providerConfigured: boolean;
  avatarRendering: boolean;
  testClip: boolean;
  reason?: string;
}

export interface AvatarProvider {
  getCapabilities(scope: { workspaceId: string; brandId: string }): Promise<AvatarProviderCapabilities>;
}

export class UnavailableAvatarProvider implements AvatarProvider {
  constructor(private readonly reason = "Avatar provider is not configured") {}

  async getCapabilities(_scope: { workspaceId: string; brandId: string }): Promise<AvatarProviderCapabilities> {
    return {
      providerConfigured: false,
      avatarRendering: false,
      testClip: false,
      reason: this.reason,
    };
  }
}
