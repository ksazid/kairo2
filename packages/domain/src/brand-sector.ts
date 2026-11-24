import type { BrandBrainFieldDto } from "@kairo/contracts";
import { SECTOR_INTELLIGENCE_PACKS } from "./sector-packs";

export const BRAND_SECTOR_FIELD_KEY = "identity.sector-pack-id";
export type CanonicalSectorPackId = keyof typeof SECTOR_INTELLIGENCE_PACKS;

export interface BrandSectorClassification {
  status: "ready" | "missing" | "needs-confirmation" | "conflicting";
  sectorPackId?: CanonicalSectorPackId;
  candidatePackIds: CanonicalSectorPackId[];
  evidenceFieldKeys: string[];
  sourceIds: string[];
  reason: string;
}

const SIGNAL_KEYS = new Set([
  "identity.category", "identity.sector", "identity.subsector", "identity.description",
  "identity.products-services", "identity.offers", "content.core-topics", "content.pillars",
  "content.preferred-topics", "content.authority-areas",
]);
const SIGNALS: ReadonlyArray<readonly [CanonicalSectorPackId, RegExp]> = [
  ["ai-technology", /\b(?:artificial intelligence|ai|saas|developer (?:technology|tools?)|software (?:engineering|architecture))\b/i],
  ["umrah-religious-travel", /\b(?:umrah|hajj|pilgrimage|religious travel|makkah|madinah)\b/i],
  ["motorcycles", /\b(?:motorcycles?|motorcycling|motorbikes?|ktm|duke\s*(?:125|200|250|390|690|790|890|990|1290|1390))\b/i],
  ["ias-upsc-education", /\b(?:upsc|ias|civil services)\b/i],
  ["hospitality", /\b(?:restaurants?|hospitality|caf[eé]s?|dining|food service)\b/i],
];
const PLACEHOLDER = /business or organization website|not yet confirmed|to be confirmed|could not be identified|connected or readable source evidence/i;

export function isCanonicalSectorPackId(value: string): value is CanonicalSectorPackId {
  return Object.hasOwn(SECTOR_INTELLIGENCE_PACKS, value);
}

/** Pure projection: a suggestion never silently becomes an owner-confirmed decision. */
export function resolveBrandSectorClassification(fields: readonly BrandBrainFieldDto[], activeSourceIds?: readonly string[]): BrandSectorClassification {
  const activeSources = activeSourceIds ? new Set(activeSourceIds) : undefined;
  const active = newestFields(fields).filter((field) => field.state !== "stale")
    .map((field) => activeSources && field.state !== "confirmed" ? { ...field, sourceIds: field.sourceIds.filter((id) => activeSources.has(id)) } : field);
  const signals = active.filter((field) => SIGNAL_KEYS.has(field.fieldKey) && !PLACEHOLDER.test(field.value)
    && (field.state === "confirmed" || field.sourceIds.length > 0));
  const matches = signals.flatMap((field) => SIGNALS.filter(([, pattern]) => pattern.test(field.value)).map(([id]) => ({ id, field })));
  const candidatePackIds = [...new Set(matches.map((match) => match.id))].sort();
  const evidenceFieldKeys = [...new Set(matches.map((match) => match.field.fieldKey))].sort();
  const sourceIds = [...new Set(matches.flatMap((match) => match.field.sourceIds))].sort();
  const base = { candidatePackIds, evidenceFieldKeys, sourceIds };
  const stored = active.find((field) => field.fieldKey === BRAND_SECTOR_FIELD_KEY && field.section === "identity");
  const selected = stored && isCanonicalSectorPackId(stored.value) ? stored.value : undefined;

  if (candidatePackIds.length > 1 || (selected && candidatePackIds.some((id) => id !== selected))) {
    return { ...base, status: "conflicting", reason: "Brand sector conflicts with Category, Products & services or Content focus. Correct those fields and confirm the sector." };
  }
  if (selected && stored) {
    if (stored.state === "confirmed") {
      if (selected === "generic" && signals.some((field) => /\bbikes?\b/i.test(field.value))
        && !signals.some((field) => /\b(?:bicycles?|cycling|mountain[- ]bikes?|e[-\s‑–]?bikes?)\b/i.test(field.value))) {
        return { ...base, status: "needs-confirmation", reason: "Bike is ambiguous. Confirm whether this Brand covers motorcycles or clarify its Category and Content focus." };
      }
      return { ...base, status: "ready", sectorPackId: selected, reason: "Owner-confirmed Brand sector." };
    }
    // An inferred ID must still be supported by the current classification evidence.
    if (candidatePackIds.length === 1 && candidatePackIds[0] === selected && stored.sourceIds.some((id) => sourceIds.includes(id))) {
      return { ...base, status: "ready", sectorPackId: selected, reason: "Brand sector is backed by current Brand evidence." };
    }
  }
  return {
    ...base,
    status: candidatePackIds.length ? "needs-confirmation" : "missing",
    reason: candidatePackIds.length
      ? "Confirm the suggested Brand sector before running Hunter."
      : "Choose a Brand sector in Brand DNA before running Hunter. Use General only when no specialist sector applies.",
  };
}

function newestFields(fields: readonly BrandBrainFieldDto[]): BrandBrainFieldDto[] {
  const newest = new Map<string, BrandBrainFieldDto>();
  for (const field of fields) {
    const previous = newest.get(field.fieldKey);
    if (!previous || field.version > previous.version || (field.version === previous.version && field.updatedAt > previous.updatedAt)) newest.set(field.fieldKey, field);
  }
  return [...newest.values()];
}
