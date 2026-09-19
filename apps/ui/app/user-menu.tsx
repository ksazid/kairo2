"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, LogOut, Plus, Settings2, UserRound } from "lucide-react";

export function UserMenu({ brandId }: { brandId?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const brandQuery = brandId ? `&brand=${encodeURIComponent(brandId)}` : "";
  const settingsHref = brandId ? `/settings?brand=${encodeURIComponent(brandId)}` : "/settings";

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return <div className="user-menu" ref={root}>
    <button className="profile user-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>SK</span><strong>Sazzad</strong><ChevronDown aria-hidden="true" data-open={open}/>
    </button>
    {open ? <div className="user-menu-panel" role="menu" aria-label="User menu">
      <Link href={`/settings?tab=account${brandQuery}`} role="menuitem" onClick={() => setOpen(false)}><UserRound aria-hidden="true"/><span><strong>Account & Profile</strong><small>Your personal details</small></span></Link>
      <Link href="/brands/new" role="menuitem" onClick={() => setOpen(false)}><Plus aria-hidden="true"/><span><strong>Add Brand</strong><small>Set up another Brand</small></span></Link>
      <Link href={`/settings?tab=workspace${brandQuery}`} role="menuitem" onClick={() => setOpen(false)}><Building2 aria-hidden="true"/><span><strong>Manage Brands / Workspace</strong><small>Workspace and Brand settings</small></span></Link>
      <Link href={settingsHref} role="menuitem" onClick={() => setOpen(false)}><Settings2 aria-hidden="true"/><span><strong>Settings</strong><small>Channels, AI and team</small></span></Link>
      <div className="user-menu-divider"/>
      <a className="user-menu-logout" href="/auth/logout" role="menuitem"><LogOut aria-hidden="true"/><span><strong>Log out</strong></span></a>
    </div> : null}
  </div>;
}
