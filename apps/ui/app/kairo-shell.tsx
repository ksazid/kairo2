import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  Compass,
  FileText,
  Home as HomeIcon,
  Megaphone,
  Settings2,
  Sparkles,
} from "lucide-react";
import { getShellBrandOptions } from "../lib/shell-data";
import { BrandSwitcher } from "./brand-switcher";
import { UserMenu } from "./user-menu";
import { Notifications } from "./notifications";

type ActiveDestination = "Home" | "Discover" | "Content" | "Campaigns" | "Calendar" | "Insights" | "Brain" | "Settings";

export async function KairoShell({
  active,
  authenticated,
  brandId,
  brandName,
  children,
  workspaceClassName = "",
  proTip = "Connect more channels to get smarter recommendations.",
  proTipAction = "Connect channels",
  proTipHref,
  statusLabel,
}: {
  active: ActiveDestination;
  authenticated: boolean;
  brandId?: string;
  brandName: string;
  children: ReactNode;
  workspaceClassName?: string;
  proTip?: string;
  proTipAction?: string;
  proTipHref?: string;
  statusLabel?: string;
}) {
  const discoverQuery = brandId ? `?brand=${encodeURIComponent(brandId)}` : "";
  const channelsHref = brandId ? `/settings?tab=channels&brand=${encodeURIComponent(brandId)}` : "/settings?tab=channels";
  const brandOptions = authenticated ? await getShellBrandOptions() : [];
  const nav = [
    { label: "Home" as const, Icon: HomeIcon, href: brandId ? `/?brand=${encodeURIComponent(brandId)}` : "/" },
    { label: "Discover" as const, Icon: Compass, href: `/discover${discoverQuery}` },
    { label: "Content" as const, Icon: FileText, href: brandId ? `/content?brand=${encodeURIComponent(brandId)}` : "/content" },
    { label: "Campaigns" as const, Icon: Megaphone, href: brandId ? `/campaigns?brand=${encodeURIComponent(brandId)}` : "/campaigns" },
    { label: "Calendar" as const, Icon: CalendarDays, href: brandId ? `/calendar?brand=${encodeURIComponent(brandId)}` : "/calendar" },
    { label: "Insights" as const, Icon: BarChart3, href: brandId ? `/insights?brand=${encodeURIComponent(brandId)}` : "/insights" },
    { label: "Brain" as const, Icon: BrainCircuit, href: brandId ? `/brand?brand=${encodeURIComponent(brandId)}` : "/brand" },
    { label: "Settings" as const, Icon: Settings2, href: brandId ? `/settings?brand=${encodeURIComponent(brandId)}` : "/settings" },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand-logo" href={brandId ? `/?brand=${encodeURIComponent(brandId)}` : "/"}><Image src="/kairo-logo.svg" alt="" width="48" height="48" priority/><span>Kairo</span></Link>
      <nav aria-label="Primary navigation">{nav.map(({ label, Icon, href }) => href.startsWith("/") ? <Link key={label} className={active === label ? "active" : ""} href={href}><Icon aria-hidden="true"/>{label}</Link> : <a key={label} className={active === label ? "active" : ""} href={href}><Icon aria-hidden="true"/>{label}</a>)}</nav>
      <div className="pro-tip"><span><Sparkles aria-hidden="true"/>Pro tip</span><p>{proTip}</p><Link href={proTipHref ?? channelsHref}>{proTipAction} <span>›</span></Link></div>
    </aside>
    <main>
      <header className="topbar">
        <BrandSwitcher authenticated={authenticated} brandId={brandId} brandName={brandName} brands={brandOptions}/>
        <span className="ready-dot"><i/>{statusLabel ?? (authenticated ? "Brand ready" : "Preview mode")}</span>
        <div className="top-spacer"/>
        <Notifications/>
        {authenticated ? <UserMenu brandId={brandId}/> : <a className="profile auth-profile" href="/auth/login"><span>SK</span><strong>Sign in</strong></a>}
      </header>
      <div className={`workspace ${workspaceClassName}`.trim()}>{children}</div>
    </main>
  </div>;
}
