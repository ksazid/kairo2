"use client";

import { Grid2X2, Rows3 } from "lucide-react";
import type { ListingView } from "../lib/listing-view";

export function ListingViewToggle({ value, onChange }: { value: ListingView; onChange: (view: ListingView) => void }) {
  return <div className="listing-view-toggle" role="group" aria-label="Listing view">
    <button type="button" aria-pressed={value === "table"} onClick={() => onChange("table")}><Rows3 aria-hidden="true"/>Table</button>
    <button type="button" aria-pressed={value === "grid"} onClick={() => onChange("grid")}><Grid2X2 aria-hidden="true"/>Grid</button>
  </div>;
}
