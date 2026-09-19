import { describe, expect, it } from "vitest";
import { sanitizeBrandEvidenceAtBoundary } from "./brand-brain-evidence-boundary";

describe("Flow 1A residual evidence boundary", () => {
  it("removes script/style/template markup before canonical sanitization", () => {
    const result = sanitizeBrandEvidenceAtBoundary({
      url: "https://example.com/services",
      title: "<span>Example</span> Brand",
      summary: "<style>.x{display:none}</style>Useful services",
      excerpt: "<script>alert('x')</script><main>ERP, payroll and reservation management</main>",
      retrievedAt: "2026-09-01T00:00:00Z",
    });

    expect(result.title).toBe("Example Brand");
    expect(result.summary).toBe("Useful services");
    expect(result.excerpt).toBe("ERP, payroll and reservation management");
    expect(result.excerpt).not.toMatch(/alert|script|main/i);
  });
});
