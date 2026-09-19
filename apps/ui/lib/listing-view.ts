export type ListingView = "table" | "grid";

export const DEFAULT_LISTING_VIEW: ListingView = "table";

export function normalizeListingView(value: string | null | undefined): ListingView {
  return value === "grid" ? "grid" : DEFAULT_LISTING_VIEW;
}
