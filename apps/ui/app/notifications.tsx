"use client";

import { Bell, Inbox, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function Notifications() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  return <div className="notifications" ref={root}>
    <button className="bell" type="button" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell aria-hidden="true"/>
    </button>
    {open ? <section className="notifications-panel" role="dialog" aria-label="Notifications">
      <header><div><strong>Notifications</strong><small>Updates for this Brand</small></div><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X aria-hidden="true"/></button></header>
      <article><Inbox aria-hidden="true"/><div><strong>No new notifications</strong><p>Kairo will show Brand and publishing updates here.</p></div></article>
    </section> : null}
  </div>;
}
