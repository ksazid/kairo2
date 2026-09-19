import { formatBrandDnaForUi, type BrandDnaFieldInput, type BrandDnaUiField, type BrandDnaUiSection, type BrandDnaUiViewModel } from "./brand-dna-view-model";

export type BrainOrigin = "user-confirmed" | "source-backed" | "ai-inferred";
export type BrainConfidence = "high" | "medium" | "low";
export type BrainActivationStatus = "ready-for-hunter" | "needs-review" | "needs-enrichment";

export interface BrandBrainFieldInput extends BrandDnaFieldInput {
  version: number;
  updatedAt: string;
}

export interface BrandBrainActivationInput {
  brain: BrandBrainFieldInput[];
  sources: Array<{ id: string; type: string; status: string; title?: string; sourceUrl?: string }>;
  status: BrainActivationStatus;
  hunterReady: boolean;
  readiness: {
    status: "ready" | "needs-enrichment";
    score: number;
    brandIntelligenceScore: number;
    evidenceCoverage: number;
    confidence: number;
    gaps: string[];
  };
  completeness: { score: number; knownGroups: number; totalGroups: number };
  fields: Array<{
    fieldKey: string;
    origin: BrainOrigin;
    confidence: { score: number; level: BrainConfidence };
    sourceIds: string[];
    critical: boolean;
    weak: boolean;
    updatedAt: string;
  }>;
  weakFields: string[];
  recommendedSources: Array<{
    gap: string;
    type: "website" | "public-link" | "confirm-field";
    fieldKey?: string;
    label: string;
    reason: string;
  }>;
  evidenceSourceCount: number;
  updatedAt: string | null;
}

export interface EditableBrainField extends BrandDnaUiField {
  section: BrandBrainFieldInput["section"];
  version?: number;
  origin: BrainOrigin | "unknown";
  originLabel: string;
  confidence: BrainConfidence | "unknown";
  confidenceLabel: string;
  needsReview: boolean;
}

export interface EditableBrainSection extends Omit<BrandDnaUiSection, "fields"> {
  fields: EditableBrainField[];
  chipEditors: Array<{
    fieldKey: string;
    label: string;
    value: string;
    section: BrandBrainFieldInput["section"];
    version: number;
    origin: BrainOrigin;
    originLabel: string;
    confidence: BrainConfidence;
    confidenceLabel: string;
    needsReview: boolean;
  }>;
}

export interface BrandBrainPageViewModel extends Omit<BrandDnaUiViewModel, "sections"> {
  sections: EditableBrainSection[];
  activation: {
    status: BrainActivationStatus;
    label: "Ready for Hunter" | "Needs review" | "Needs enrichment";
    hunterReady: boolean;
    completenessScore: number;
    knownGroups: number;
    totalGroups: number;
    evidenceCoverage: number;
    confidence: number;
    weakFields: string[];
    recommendedSources: BrandBrainActivationInput["recommendedSources"];
    sourceCount: number;
    updatedAt: string | null;
  };
  sources: BrandBrainActivationInput["sources"];
}

const CHIP_FIELD_KEYS = new Set([
  "identity.products-services",
  "identity.offers",
  "voice.vocabulary",
  "content.pillars",
  "content.preferred-topics",
  "content.channels",
]);

const LABEL_BY_KEY: Record<string, string> = {
  "identity.products-services": "Products & Services",
  "identity.offers": "Offers",
  "voice.vocabulary": "Vocabulary",
  "content.pillars": "Content pillars",
  "content.preferred-topics": "Preferred topics",
  "content.channels": "Channels",
};

export function buildBrandBrainPageViewModel(input: BrandBrainActivationInput): BrandBrainPageViewModel {
  const base = formatBrandDnaForUi(input.brain, input.readiness);
  const fieldByKey = new Map(input.brain.map((field) => [field.fieldKey, field]));
  const activationByKey = new Map(input.fields.map((field) => [field.fieldKey, field]));

  const sections: EditableBrainSection[] = base.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => enrichField(field, fieldByKey.get(field.fieldKey), activationByKey.get(field.fieldKey))),
    chipEditors: input.brain
      .filter((field) => CHIP_FIELD_KEYS.has(field.fieldKey) && sectionForField(field.fieldKey) === section.id)
      .map((field) => {
        const activation = activationByKey.get(field.fieldKey);
        const origin = activation?.origin ?? originFor(field);
        const confidence = activation?.confidence.level ?? confidenceFor(field);
        return {
          fieldKey: field.fieldKey,
          label: LABEL_BY_KEY[field.fieldKey] ?? humanize(field.fieldKey),
          value: field.value,
          section: field.section,
          version: field.version,
          origin,
          originLabel: originLabel(origin),
          confidence,
          confidenceLabel: confidenceLabel(confidence),
          needsReview: activation?.weak ?? (confidence !== "high"),
        };
      }),
  }));

  return {
    ...base,
    sections,
    activation: {
      status: input.status,
      label: input.status === "ready-for-hunter" ? "Ready for Hunter" : input.status === "needs-review" ? "Needs review" : "Needs enrichment",
      hunterReady: input.hunterReady,
      completenessScore: input.completeness.score,
      knownGroups: input.completeness.knownGroups,
      totalGroups: input.completeness.totalGroups,
      evidenceCoverage: input.readiness.evidenceCoverage,
      confidence: input.readiness.confidence,
      weakFields: input.weakFields,
      recommendedSources: input.recommendedSources,
      sourceCount: input.evidenceSourceCount,
      updatedAt: input.updatedAt,
    },
    sources: input.sources,
  };
}

function enrichField(
  field: BrandDnaUiField,
  source: BrandBrainFieldInput | undefined,
  activation: BrandBrainActivationInput["fields"][number] | undefined,
): EditableBrainField {
  const origin = activation?.origin ?? (source ? originFor(source) : "unknown");
  const confidence = activation?.confidence.level ?? (source ? confidenceFor(source) : "unknown");
  return {
    ...field,
    section: source?.section ?? sectionValueForField(field.fieldKey),
    ...(source ? { version: source.version } : {}),
    origin,
    originLabel: origin === "unknown" ? "Unknown" : originLabel(origin),
    confidence,
    confidenceLabel: confidence === "unknown" ? "Unknown" : confidenceLabel(confidence),
    needsReview: activation?.weak ?? (field.state === "unknown" || confidence !== "high"),
  };
}

function originFor(field: BrandBrainFieldInput): BrainOrigin {
  if (field.state === "confirmed") return "user-confirmed";
  return field.sourceIds.length ? "source-backed" : "ai-inferred";
}

function confidenceFor(field: BrandBrainFieldInput): BrainConfidence {
  if (field.state === "stale") return "low";
  if (field.state === "confirmed" || field.sourceIds.length) return "high";
  return "medium";
}

function originLabel(origin: BrainOrigin): string {
  return origin === "user-confirmed" ? "User confirmed" : origin === "source-backed" ? "Source backed" : "AI inferred";
}

function confidenceLabel(confidence: BrainConfidence): string {
  return confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : "Low confidence";
}

function sectionForField(fieldKey: string): BrandDnaUiSection["id"] {
  if (fieldKey.startsWith("identity.products") || fieldKey === "identity.offers") return "products-services";
  if (fieldKey.startsWith("identity.")) return "identity";
  if (fieldKey.startsWith("audience.")) return "audience";
  if (fieldKey.startsWith("positioning.")) return "positioning";
  if (fieldKey.startsWith("voice.")) return "voice";
  if (fieldKey.startsWith("content.")) return "content";
  return "boundaries";
}

function sectionValueForField(fieldKey: string): BrandBrainFieldInput["section"] {
  if (fieldKey.startsWith("identity.")) return "identity";
  if (fieldKey.startsWith("audience.")) return "audience";
  if (fieldKey.startsWith("positioning.")) return "positioning";
  if (fieldKey.startsWith("voice.")) return "voice";
  if (fieldKey.startsWith("content.")) return "content-strategy";
  if (fieldKey.startsWith("goals.")) return "goals";
  return "boundaries";
}

function humanize(value: string): string {
  const part = value.split(".").at(-1) ?? value;
  return part.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
