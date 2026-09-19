import { getSettingsData } from "../../lib/api";
import { isSettingsTabId } from "../../lib/settings";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { SettingsClient } from "./settings-client";
import styles from "./settings-page-header.module.css";

type SearchParams = Promise<{ brand?: string; authError?: string; error?: string; notice?: string; tab?: string }>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getSettingsData(params.brand), "/settings");

  return <KairoShell
    active="Settings"
    authenticated={data.authenticated}
    brandId={data.brand?.id}
    brandName={data.brand?.name ?? data.account.displayName}
    workspaceClassName="settings-avatar-workspace"
    proTip="Keep account, publishing, and provider access current so Kairo can work reliably in the background."
    proTipAction="Review settings"
    proTipHref="#settings-content"
    statusLabel="Discovery ready"
  >
    {params.authError || params.error ? <p className="auth-error" role="alert">{params.authError ?? params.error}</p> : null}
    {params.notice ? <p className="auth-notice" role="status">{params.notice}</p> : null}
    <div className={styles.settingsPage}>
      <header className={styles.pageHeader}>
        <h1>Settings</h1>
        <p>Manage your account, workspace, channels, AI providers, and team access.</p>
      </header>
      <div className={styles.client}>
        <SettingsClient data={data} initialTab={params.tab && isSettingsTabId(params.tab) ? params.tab : "account"}/>
      </div>
    </div>
  </KairoShell>;
}
