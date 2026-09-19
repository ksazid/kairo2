export const SETTINGS_TABS = [
  { id: "account", label: "Account & Profile" },
  { id: "workspace", label: "Brand & Workspace" },
  { id: "avatar", label: "AI Creator Avatar" },
  { id: "channels", label: "Channels & Publishing" },
  { id: "providers", label: "AI & Media Providers" },
  { id: "team", label: "Team & Permissions" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function isSettingsTabId(value: string): value is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}
