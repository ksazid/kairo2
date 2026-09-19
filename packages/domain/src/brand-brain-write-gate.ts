import { DomainValidationError } from "./index";
import type { BrandBrainProposal } from "./brand-brain-bootstrap";

export interface BrandBrainWriteGateOptions {
  inspectedSourceIds: ReadonlySet<string>;
  syntheticFallback: boolean;
  sourceRequiredFields: ReadonlySet<string>;
  valueLimit(fieldKey: string): number;
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH_CHARACTERS = /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const HTML_BLOCKS = /<\s*(script|style|iframe|object|embed|template|svg)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const HTML_TAGS = /<[^>]{1,512}>/g;
const UNSAFE_SCHEME = /(?:javascript|vbscript|data|file):/i;
const PROMPT_INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier|system|developer)\s+(?:instructions?|prompts?|messages?)\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\s*:/i,
  /\b(?:reveal|print|return|expose)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /\b(?:you are|act as)\s+(?:chatgpt|the system|an? assistant)\b/i,
  /\b(?:call|invoke|execute|run)\s+(?:the\s+)?(?:tool|function|command)\b/i,
];

export function validateAndDeduplicateBrandBrainProposals(
  proposals: readonly BrandBrainProposal[],
  options: BrandBrainWriteGateOptions,
): BrandBrainProposal[] {
  const byField = new Map<string, BrandBrainProposal>();

  for (const raw of proposals) {
    const fieldKey = sanitizeIdentifier(raw.fieldKey, "Brand Brain field key");
    const value = sanitizeProposalValue(raw.value, options.valueLimit(fieldKey));
    const sourceIds = [...new Set(raw.sourceIds.map((sourceId) => sanitizeIdentifier(sourceId, "Brand Brain source id")))];
    const requireSource = !options.syntheticFallback || options.sourceRequiredFields.has(fieldKey);

    if (requireSource && sourceIds.length === 0) {
      throw new DomainValidationError("Source-backed Brand Brain proposals require active source provenance");
    }
    if (sourceIds.some((sourceId) => !options.inspectedSourceIds.has(sourceId))) {
      throw new DomainValidationError("Brand Brain proposal provenance is invalid");
    }

    const proposal: BrandBrainProposal = { ...raw, fieldKey, value, sourceIds };
    const existing = byField.get(fieldKey);
    if (!existing) {
      byField.set(fieldKey, proposal);
      continue;
    }

    const sameValue = existing.value === proposal.value;
    const sameSources = [...existing.sourceIds].sort().join("\u0000") === [...proposal.sourceIds].sort().join("\u0000");
    if (!sameValue || !sameSources || existing.section !== proposal.section) {
      throw new DomainValidationError("Conflicting duplicate Brand Brain proposals are not allowed");
    }
  }

  return [...byField.values()];
}

function sanitizeProposalValue(value: string, maxLength: number): string {
  if (typeof value !== "string") throw new DomainValidationError("Brand Brain proposal value must be text");
  const normalized = value
    .normalize("NFKC")
    .replace(HTML_BLOCKS, " ")
    .replace(HTML_TAGS, " ")
    .replace(CONTROL_CHARACTERS, "")
    .replace(ZERO_WIDTH_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length > maxLength) throw new DomainValidationError("Brand Brain proposal value is invalid");
  if (UNSAFE_SCHEME.test(normalized)) throw new DomainValidationError("Brand Brain proposal contains an unsafe string");
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new DomainValidationError("Brand Brain proposal contains prompt-injection-style instructions");
  }
  return normalized;
}

function sanitizeIdentifier(value: string, label: string): string {
  if (typeof value !== "string") throw new DomainValidationError(`${label} must be text`);
  const normalized = value.replace(CONTROL_CHARACTERS, "").replace(ZERO_WIDTH_CHARACTERS, "").trim();
  if (!normalized || normalized.length > 256 || /[<>\r\n]/.test(normalized)) throw new DomainValidationError(`${label} is invalid`);
  return normalized;
}
