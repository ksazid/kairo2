export type BrandDnaFieldState = "inferred" | "confirmed" | "stale";

export interface BrandDnaFieldInput {
  fieldKey: string;
  section: string;
  value: string;
  state: BrandDnaFieldState;
  sourceIds: string[];
}

export interface BrandDnaReadinessInput {
  brandIntelligenceScore?: number;
  evidenceCoverage?: number;
  confidence?: number;
  gaps?: string[];
}

export interface BrandDnaUiField {
  fieldKey: string;
  label: string;
  value: string | null;
  state: BrandDnaFieldState | "unknown";
  editable: true;
  evidenceCount: number;
}

export interface BrandDnaUiSection {
  id: "identity" | "products-services" | "audience" | "positioning" | "voice" | "content" | "boundaries";
  title: string;
  status: "strong" | "partial" | "missing";
  fields: BrandDnaUiField[];
  chips?: string[];
}

export interface BrandDnaUiViewModel {
  title: "Brand Brain";
  intelligence: {
    label: "Brand Intelligence";
    status: "Strong" | "Developing" | "Needs enrichment";
    score: number | null;
    discoveredCount: number;
    trackedCount: number;
    missingCount: number;
  };
  sections: BrandDnaUiSection[];
  evidence: {
    available: boolean;
    sourceCount: number;
    actionLabel: "View evidence";
    sourceIds: string[];
  };
}

const FIELD_DEFINITIONS = [
  { fieldKey: "identity.description", sectionId: "identity", sectionTitle: "Brand Identity", label: "Description", critical: true },
  { fieldKey: "identity.category", sectionId: "identity", sectionTitle: "Brand Identity", label: "Category", critical: true },
  { fieldKey: "identity.geography", sectionId: "identity", sectionTitle: "Brand Identity", label: "Location", critical: true },
  { fieldKey: "identity.products-services", sectionId: "products-services", sectionTitle: "Products & Services", label: "Products & Services", critical: true, chips: true },
  { fieldKey: "identity.offers", sectionId: "products-services", sectionTitle: "Products & Services", label: "Offers", critical: false, chips: true },
  { fieldKey: "audience.primary", sectionId: "audience", sectionTitle: "Audience", label: "Primary audience", critical: true },
  { fieldKey: "audience.pains", sectionId: "audience", sectionTitle: "Audience", label: "Pain points", critical: false },
  { fieldKey: "audience.motivations", sectionId: "audience", sectionTitle: "Audience", label: "Motivations", critical: false },
  { fieldKey: "positioning.value-proposition", sectionId: "positioning", sectionTitle: "Positioning", label: "Value proposition", critical: true },
  { fieldKey: "positioning.differentiation", sectionId: "positioning", sectionTitle: "Positioning", label: "Differentiation", critical: false },
  { fieldKey: "voice.tone", sectionId: "voice", sectionTitle: "Voice", label: "Tone", critical: false },
  { fieldKey: "voice.vocabulary", sectionId: "voice", sectionTitle: "Voice", label: "Vocabulary", critical: false, chips: true },
  { fieldKey: "content.pillars", sectionId: "content", sectionTitle: "Content Intelligence", label: "Content pillars", critical: true, chips: true },
  { fieldKey: "content.preferred-topics", sectionId: "content", sectionTitle: "Content Intelligence", label: "Preferred topics", critical: false, chips: true },
  { fieldKey: "content.channels", sectionId: "content", sectionTitle: "Content Intelligence", label: "Channels", critical: false, chips: true },
  { fieldKey: "content.visual-direction", sectionId: "content", sectionTitle: "Content Intelligence", label: "Visual direction", critical: true },
  { fieldKey: "boundaries.excluded-topics", sectionId: "boundaries", sectionTitle: "Boundaries", label: "Excluded topics", critical: true },
] as const;

type SectionId = (typeof FIELD_DEFINITIONS)[number]["sectionId"];

export function formatBrandDnaForUi(
  fields: readonly BrandDnaFieldInput[],
  readiness?: BrandDnaReadinessInput,
): BrandDnaUiViewModel {
  const byKey = new Map(fields.filter(isDisplayableField).map((field) => [field.fieldKey, field]));
  const sourceIds = [...new Set(fields.flatMap((field) => field.sourceIds).filter(Boolean))];
  const discoveredCount = FIELD_DEFINITIONS.filter((definition) => Boolean(byKey.get(definition.fieldKey))).length;
  const trackedCount = FIELD_DEFINITIONS.length;
  const missingCount = trackedCount - discoveredCount;

  const sectionOrder: SectionId[] = ["identity", "products-services", "audience", "positioning", "voice", "content", "boundaries"];
  const sections = sectionOrder.map((sectionId) => buildSection(sectionId, byKey)).filter(Boolean) as BrandDnaUiSection[];

  return {
    title: "Brand Brain",
    intelligence: {
      label: "Brand Intelligence",
      status: intelligenceStatus(readiness?.brandIntelligenceScore, discoveredCount, trackedCount),
      score: boundedScore(readiness?.brandIntelligenceScore),
      discoveredCount,
      trackedCount,
      missingCount,
    },
    sections,
    evidence: {
      available: sourceIds.length > 0,
      sourceCount: sourceIds.length,
      actionLabel: "View evidence",
      sourceIds,
    },
  };
}

function buildSection(sectionId: SectionId, byKey: ReadonlyMap<string, BrandDnaFieldInput>): BrandDnaUiSection | undefined {
  const definitions = FIELD_DEFINITIONS.filter((item) => item.sectionId === sectionId);
  const sectionTitle = definitions[0]?.sectionTitle;
  if (!sectionTitle) return undefined;

  const fields: BrandDnaUiField[] = [];
  const chips: string[] = [];
  let known = 0;

  for (const definition of definitions) {
    const source = byKey.get(definition.fieldKey);
    if (source) {
      known += 1;
      if ("chips" in definition && definition.chips) {
        chips.push(...splitDisplayValues(source.value));
      } else {
        fields.push({
          fieldKey: source.fieldKey,
          label: definition.label,
          value: displayValue(source.value, source.fieldKey),
          state: source.state,
          editable: true,
          evidenceCount: new Set(source.sourceIds).size,
        });
      }
      continue;
    }

    if (definition.critical) {
      fields.push({
        fieldKey: definition.fieldKey,
        label: definition.label,
        value: null,
        state: "unknown",
        editable: true,
        evidenceCount: 0,
      });
    }
  }

  const uniqueChips = dedupeDisplayValues(chips);
  const status: BrandDnaUiSection["status"] = known === definitions.length ? "strong" : known > 0 ? "partial" : "missing";

  return {
    id: sectionId,
    title: sectionTitle,
    status,
    fields,
    ...(uniqueChips.length ? { chips: uniqueChips } : {}),
  };
}

function isDisplayableField(field: BrandDnaFieldInput): boolean {
  return Boolean(field.fieldKey && field.value && field.value.trim());
}

function displayValue(value: string, fieldKey: string): string {
  const clean = normalize(value);
  if (fieldKey === "identity.description") return summarize(clean, 240);
  if (fieldKey === "identity.geography") return splitDisplayValues(clean).join(" · ");
  return summarize(clean, 320);
}

function splitDisplayValues(value: string): string[] {
  return normalize(value)
    .split(/\s*(?:\||•|·|;|,|\n)\s*/g)
    .map((item) => item.replace(/^[-–—]\s*/, "").trim())
    .filter(Boolean)
    .map(canonicalPhrase);
}

function dedupeDisplayValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const key = semanticKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function semanticKey(value: string): string {
  let key = value.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
  key = key.replace(/\bsolutions?\b/g, "").replace(/\bservices?\b/g, "").replace(/\s+/g, " ").trim();
  return key.split(" ").map((word) => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word).join(" ");
}

function canonicalPhrase(value: string): string {
  if (/^[A-Z0-9&+./ -]{2,}$/.test(value)) return value;
  return value.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("en"));
}

function summarize(value: string, max: number): string {
  if (value.length <= max) return value;
  const clipped = value.slice(0, max + 1);
  const sentence = clipped.match(/^(.{80,}?[.!?])(?:\s|$)/)?.[1];
  if (sentence) return sentence;
  const safe = clipped.slice(0, max).replace(/\s+\S*$/, "").trim();
  return `${safe || value.slice(0, max).trim()}…`;
}

function normalize(value: string): string {
  return value.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function intelligenceStatus(score: number | undefined, discovered: number, total: number): BrandDnaUiViewModel["intelligence"]["status"] {
  if (typeof score === "number") {
    if (score >= 75) return "Strong";
    if (score >= 45) return "Developing";
    return "Needs enrichment";
  }
  const coverage = total ? discovered / total : 0;
  if (coverage >= 0.75) return "Strong";
  if (coverage >= 0.45) return "Developing";
  return "Needs enrichment";
}

function boundedScore(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}
