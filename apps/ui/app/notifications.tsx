"use client";

import { AlertCircle, Bell, CheckCircle2, X } from "lucide-react";
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
      <Bell aria-hidden="true"/><b aria-label="3 unread notifications">3</b>
    </button>
    {open ? <section className="notifications-panel" role="dialog" aria-label="Notifications">
      <header><div><strong>Notifications</strong><small>Recent activity for this Brand</small></div><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X aria-hidden="true"/></button></header>
      <article><CheckCircle2 aria-hidden="true"/><div><strong>Brand Brain is ready</strong><p>Your latest Brand sources are available for review.</p><small>Today</small></div></article>
      <article><AlertCircle aria-hidden="true"/><div><strong>Review before publishing</strong><p>One content asset still needs approval.</p><small>Today</small></div></article>
      <footer><span>Operational notices only</span></footer>
    </section> : null}
  </div>;
}
