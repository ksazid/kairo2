import type { PublicBrandReference, PublicBrandReferenceReader } from "./brand-brain-bootstrap";
import { assertSanitizedBrandEvidenceReference, type EvidenceTrustLevel } from "./brand-brain-evidence-sanitizer";
import { sanitizeBrandEvidenceAtBoundary } from "./brand-brain-evidence-boundary";

/**
 * Security boundary between acquisition/DOM cleanup and Brand-DNA mapping.
 * The delegate may retrieve arbitrary external text; only sanitized evidence is
 * allowed to cross this reader boundary into BrandBrainBootstrapService.
 */
export class SanitizingPublicBrandReferenceReader implements PublicBrandReferenceReader {
  constructor(
    private readonly delegate: PublicBrandReferenceReader,
    private readonly trustLevel: EvidenceTrustLevel = "untrusted_external",
  ) {}

  async read(url: string): Promise<PublicBrandReference> {
    const raw = await this.delegate.read(url);
    const sanitized = sanitizeBrandEvidenceAtBoundary(raw, this.trustLevel);
    assertSanitizedBrandEvidenceReference(sanitized);
    return sanitized;
  }
}
