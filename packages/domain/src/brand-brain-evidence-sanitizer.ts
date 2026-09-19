export type EvidenceTrustLevel = "untrusted_external" | "untrusted_knowledge";

export type EvidenceRejectionReason =
  | "prompt_injection"
  | "control_unicode"
  | "field_too_long"
  | "malformed_json_ld"
  | "invalid_url"
  | "duplicate_semantic_value";

export interface BrandEvidenceReference {
  url: string;
  title?: string;
  summary?: string;
  excerpt: string;
  retrievedAt: string;
  contentType?: string;
  sizeBytes?: number;
  links?: string[];
}

export interface EvidenceSanitizationIssue {
  reason: EvidenceRejectionReason;
  field: "url" | "title" | "summary" | "excerpt" | "contentType" | "links" | "jsonLd";
  count: number;
}

export interface SanitizedBrandEvidenceReference extends BrandEvidenceReference {
  trustLevel: EvidenceTrustLevel;
  sanitization: {
    sanitized: true;
    rejectedInstructionCount: number;
    issues: EvidenceSanitizationIssue[];
  };
}

const LIMITS = {
  title: 300,
  summary: 2_000,
  excerpt: 20_000,
  link: 2_048,
  links: 100,
  jsonLd: 100_000,
} as const;

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?previous\s+instructions?\b/i,
  /\b(?:disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|messages?)\b/i,
  /\bignore\s+(?:the\s+)?(?:system|developer)\s+(?:message|prompt|instructions?)\b/i,
  /\breveal\s+(?:the\s+)?(?:system|developer)\s+(?:message|prompt|instructions?)\b/i,
  /\b(?:system|developer)\s*:\s*/i,
  /\b(?:you\s+are|act\s+as)\s+(?:chatgpt|the\s+system|an?\s+assistant)\b/i,
  /\byou\s+are\s+(?:chatgpt|an?\s+assistant|the\s+assistant)\b/i,
  /\b(?:call|invoke|execute|run)\s+(?:the\s+)?(?:tool|function|command)\b/i,
  /\bdo\s+not\s+follow\s+(?:the\s+)?(?:previous|system|developer)\b/i,
  /\btool[_ -]?call\b/i,
];

const INVISIBLE_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function sanitizeBrandEvidenceReference(
  input: BrandEvidenceReference,
  trustLevel: EvidenceTrustLevel = "untrusted_external",
): SanitizedBrandEvidenceReference {
  assertBrandEvidenceInput(input);
  assertEvidenceTextIsNotCorrupt(input.title);
  assertEvidenceTextIsNotCorrupt(input.summary);
  assertEvidenceTextIsNotCorrupt(input.excerpt);
  const issues: EvidenceSanitizationIssue[] = [];
  const canonicalUrl = canonicalizeHttpUrl(input.url);
  if (!canonicalUrl || canonicalUrl.length > LIMITS.link) throw new Error("Brand evidence URL must be a valid HTTP(S) URL");

  const titleResult = sanitizeInstructionBearingField(input.title, "title", LIMITS.title, issues);
  const summaryResult = sanitizeInstructionBearingField(input.summary, "summary", LIMITS.summary, issues);
  const excerptResult = sanitizeInstructionBearingField(input.excerpt, "excerpt", LIMITS.excerpt, issues);

  if (!excerptResult.value) throw new Error("Brand evidence excerpt is empty after sanitization");
  if (!isIsoDate(input.retrievedAt)) throw new Error("Brand evidence retrievedAt must be an ISO timestamp");

  const links = dedupeCanonicalUrls(input.links ?? [], issues);
  const rejectedInstructionCount = titleResult.rejectedInstructionCount + summaryResult.rejectedInstructionCount + excerptResult.rejectedInstructionCount;

  return {
    url: canonicalUrl,
    ...(titleResult.value ? { title: titleResult.value } : {}),
    ...(summaryResult.value ? { summary: summaryResult.value } : {}),
    excerpt: excerptResult.value,
    retrievedAt: new Date(input.retrievedAt).toISOString(),
    ...(input.contentType ? { contentType: normalizeWhitespace(stripControlUnicode(input.contentType, issues, "contentType")).slice(0, 200) } : {}),
    ...(Number.isFinite(input.sizeBytes) && Number(input.sizeBytes) >= 0 ? { sizeBytes: Number(input.sizeBytes) } : {}),
    ...(links.length ? { links } : {}),
    trustLevel,
    sanitization: {
      sanitized: true,
      rejectedInstructionCount,
      issues: coalesceIssues(issues),
    },
  };
}

function assertEvidenceTextIsNotCorrupt(value: string | undefined): void {
  if (!value) return;
  const replacementCount = (value.match(/\uFFFD/g) ?? []).length;
  const binaryControlCount = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) ?? []).length;
  const limit = Math.max(2, Math.floor(value.length * 0.005));
  if (replacementCount > limit || binaryControlCount > limit) {
    throw new Error("Brand evidence contains corrupt or binary text");
  }
}

export function assertSanitizedBrandEvidenceReference(value: unknown): asserts value is SanitizedBrandEvidenceReference {
  if (!isPlainObject(value)) throw new Error("Sanitized evidence must be an object");
  const item = value as Partial<SanitizedBrandEvidenceReference>;
  const canonicalUrl = canonicalizeHttpUrl(item.url ?? "");
  if (!canonicalUrl || canonicalUrl.length > LIMITS.link) throw new Error("Sanitized evidence URL is invalid");
  if (typeof item.excerpt !== "string" || !item.excerpt.trim() || item.excerpt.length > LIMITS.excerpt) throw new Error("Sanitized evidence excerpt is invalid");
  if (!isIsoDate(item.retrievedAt ?? "")) throw new Error("Sanitized evidence timestamp is invalid");
  if (item.title !== undefined && (typeof item.title !== "string" || item.title.length > LIMITS.title)) throw new Error("Sanitized evidence title is invalid");
  if (item.summary !== undefined && (typeof item.summary !== "string" || item.summary.length > LIMITS.summary)) throw new Error("Sanitized evidence summary is invalid");
  if (item.trustLevel !== "untrusted_external" && item.trustLevel !== "untrusted_knowledge") throw new Error("Sanitized evidence trust marker is invalid");
  if (!item.sanitization || item.sanitization.sanitized !== true) throw new Error("Sanitized evidence marker is missing");
  if (item.links !== undefined && (!Array.isArray(item.links) || item.links.length > LIMITS.links || item.links.some((url) => typeof url !== "string" || !canonicalizeHttpUrl(url) || url.length > LIMITS.link))) {
    throw new Error("Sanitized evidence links are invalid");
  }
  if (!isPlainObject(item.sanitization) || !Array.isArray(item.sanitization.issues) || !Number.isInteger(item.sanitization.rejectedInstructionCount) || item.sanitization.rejectedInstructionCount < 0) {
    throw new Error("Sanitized evidence audit marker is invalid");
  }
}

export function safeParseJsonLd(raw: string): { values: Record<string, unknown>[]; malformed: boolean } {
  const clean = normalizeWhitespace(decodeHtmlEntities(raw)).trim();
  if (!clean || clean.length > LIMITS.jsonLd) return { values: [], malformed: Boolean(clean) };
  try {
    const parsed: unknown = JSON.parse(clean);
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    return {
      values: candidates.filter(isPlainObject),
      malformed: false,
    };
  } catch {
    return { values: [], malformed: true };
  }
}

export function semanticDeduplicateValues(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = normalizeWhitespace(decodeHtmlEntities(raw)).trim();
    if (!value) continue;
    const key = semanticKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonicalDisplayValue(value));
  }
  return result;
}

function sanitizeInstructionBearingField(
  value: string | undefined,
  field: "title" | "summary" | "excerpt",
  limit: number,
  issues: EvidenceSanitizationIssue[],
): { value?: string; rejectedInstructionCount: number } {
  if (!value) return { rejectedInstructionCount: 0 };
  const withoutControls = stripControlUnicode(value, issues, field);
  const decoded = decodeHtmlEntities(withoutControls);
  const chunks = decoded.split(/(?<=[.!?])\s+|\n+/g);
  const safe: string[] = [];
  let rejectedInstructionCount = 0;
  for (const chunk of chunks) {
    const normalized = normalizeWhitespace(chunk).trim();
    if (!normalized) continue;
    if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      rejectedInstructionCount += 1;
      continue;
    }
    safe.push(normalized);
  }
  if (rejectedInstructionCount) issues.push({ reason: "prompt_injection", field, count: rejectedInstructionCount });
  const joined = safe.join(" ");
  const clipped = clip(joined, limit, field, issues);
  return { ...(clipped ? { value: clipped } : {}), rejectedInstructionCount };
}

function stripControlUnicode(value: string, issues: EvidenceSanitizationIssue[], field: EvidenceSanitizationIssue["field"]): string {
  let count = 0;
  const clean = value.replace(INVISIBLE_OR_CONTROL, () => {
    count += 1;
    return "";
  });
  if (count) issues.push({ reason: "control_unicode", field, count });
  return clean.normalize("NFKC");
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return validCodePoint(code) ? String.fromCodePoint(code) : "";
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return validCodePoint(code) ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

function validCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

function clip(value: string, max: number, field: EvidenceSanitizationIssue["field"], issues: EvidenceSanitizationIssue[]): string {
  if (value.length <= max) return value;
  issues.push({ reason: "field_too_long", field, count: 1 });
  return value.slice(0, max).trimEnd();
}

function canonicalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function assertBrandEvidenceInput(value: unknown): asserts value is BrandEvidenceReference {
  if (!isPlainObject(value)) throw new Error("Brand evidence must be an object");
  const item = value as Record<string, unknown>;
  if (typeof item.url !== "string" || typeof item.excerpt !== "string" || typeof item.retrievedAt !== "string") {
    throw new Error("Brand evidence URL, excerpt and retrievedAt must be text");
  }
  for (const field of ["title", "summary", "contentType"] as const) {
    if (item[field] !== undefined && typeof item[field] !== "string") throw new Error("Brand evidence optional fields must be text");
  }
  if (item.links !== undefined && !Array.isArray(item.links)) throw new Error("Brand evidence links must be an array");
  if (item.sizeBytes !== undefined && (typeof item.sizeBytes !== "number" || !Number.isFinite(item.sizeBytes))) throw new Error("Brand evidence sizeBytes must be finite");
}

function dedupeCanonicalUrls(values: readonly string[], issues: EvidenceSanitizationIssue[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const raw of values.slice(0, LIMITS.links * 2)) {
    const canonical = canonicalizeHttpUrl(raw);
    if (!canonical || canonical.length > LIMITS.link) {
      invalid += 1;
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    output.push(canonical);
    if (output.length === LIMITS.links) break;
  }
  if (invalid) issues.push({ reason: "invalid_url", field: "links", count: invalid });
  return output;
}

function semanticKey(value: string): string {
  let key = value.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
  key = key.replace(/\bsolutions?\b/g, "").replace(/\bservices?\b/g, "").replace(/\s+/g, " ").trim();
  const words = key.split(" ").map((word) => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);
  return words.join(" ");
}

function canonicalDisplayValue(value: string): string {
  if (/^[A-Z0-9&+./ -]{2,}$/.test(value)) return value;
  return value.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("en"));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isIsoDate(value: string): boolean {
  if (!value || Number.isNaN(Date.parse(value))) return false;
  return /\d{4}-\d{2}-\d{2}T/.test(value);
}

function coalesceIssues(issues: EvidenceSanitizationIssue[]): EvidenceSanitizationIssue[] {
  const grouped = new Map<string, EvidenceSanitizationIssue>();
  for (const issue of issues) {
    const key = `${issue.reason}:${issue.field}`;
    const existing = grouped.get(key);
    if (existing) existing.count += issue.count;
    else grouped.set(key, { ...issue });
  }
  return [...grouped.values()];
}
