import {
  sanitizeBrandEvidenceReference,
  type BrandEvidenceReference,
  type EvidenceTrustLevel,
  type SanitizedBrandEvidenceReference,
} from "./brand-brain-evidence-sanitizer";

const HTML_BLOCKS = /<\s*(script|style|iframe|object|embed|template|svg|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const HTML_TAGS = /<[^>]{1,1024}>/g;

/**
 * Final evidence-entry boundary. Upstream extractors should already emit clean
 * text; this wrapper makes that assumption non-authoritative by removing any
 * residual executable/boilerplate markup before the canonical sanitizer runs.
 */
export function sanitizeBrandEvidenceAtBoundary(
  input: BrandEvidenceReference,
  trustLevel: EvidenceTrustLevel = "untrusted_external",
): SanitizedBrandEvidenceReference {
  return sanitizeBrandEvidenceReference({
    ...input,
    ...(input.title !== undefined ? { title: stripResidualMarkup(input.title) } : {}),
    ...(input.summary !== undefined ? { summary: stripResidualMarkup(input.summary) } : {}),
    excerpt: stripResidualMarkup(input.excerpt),
  }, trustLevel);
}

function stripResidualMarkup(value: string): string {
  return value
    .replace(HTML_BLOCKS, " ")
    .replace(HTML_TAGS, " ")
    .replace(/\s+/g, " ")
    .trim();
}
