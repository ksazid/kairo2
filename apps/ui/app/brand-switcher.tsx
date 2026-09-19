"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ShellBrandOption } from "../lib/shell-data";

function stableBrandPath(pathname: string) {
  if (pathname === "/") return "/";
  for (const root of ["/discover", "/content", "/campaigns", "/calendar", "/insights", "/brand", "/settings"]) {
    if (pathname === root) return root;
    if (pathname.startsWith(`${root}/`)) return root;
  }
  return "/";
}

export function BrandSwitcher({
  authenticated,
  brandId,
  brandName,
  brands,
}: {
  authenticated: boolean;
  brandId?: string;
  brandName: string;
  brands: ShellBrandOption[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canOpen = authenticated && brands.length > 0;

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function chooseBrand(nextBrandId: string) {
    setOpen(false);
    if (!nextBrandId || nextBrandId === brandId) return;

    const url = new URL(window.location.href);
    url.pathname = stableBrandPath(url.pathname);
    url.searchParams.set("brand", nextBrandId);
    window.location.assign(`${url.pathname}?${url.searchParams.toString()}`);
  }

  return <div className="brand-switcher" ref={rootRef}>
    <button
      className="brand-select"
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={!canOpen}
      onClick={() => canOpen && setOpen((value) => !value)}
      title={!authenticated ? "Sign in to switch Brands" : brands.length ? "Switch Brand" : "No Brands available"}
    >
      <span className="brand-avatar">{brandName.slice(0, 1).toUpperCase()}</span>
      <strong>{brandName}</strong>
      {canOpen ? <ChevronDown aria-hidden="true" data-open={open}/> : null}
    </button>

    <select
      className="brand-mobile-select"
      aria-label="Choose Brand"
      value={brandId ?? ""}
      disabled={!canOpen}
      onFocus={() => setOpen(false)}
      onChange={(event) => chooseBrand(event.currentTarget.value)}
    >
      {!brandId ? <option value="" disabled>Choose Brand</option> : null}
      {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
    </select>

    {open ? <div className="brand-menu" role="listbox" aria-label="Choose Brand">
      {brands.map((brand) => <button
        key={brand.id}
        type="button"
        role="option"
        aria-selected={brand.id === brandId}
        onClick={() => chooseBrand(brand.id)}
      >
        <span className="brand-avatar">{brand.name.slice(0, 1).toUpperCase()}</span>
        <strong>{brand.name}</strong>
        {brand.id === brandId ? <Check aria-hidden="true"/> : null}
      </button>)}
    </div> : null}
  </div>;
}