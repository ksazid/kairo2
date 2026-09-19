import { describe, expect, it } from "vitest";
import { SanitizingPublicBrandReferenceReader } from "@kairo/domain/brand-brain-sanitizing-reader";
import { SourceIntelligenceBrandReferenceReader } from "./source-intelligence";

const LIVE = process.env.FLOW_1A_LIVE_CERTIFICATION === "1";

interface CertificationSite {
  name: string;
  url: string;
  identity: RegExp;
  offering: RegExp;
  context: RegExp;
}

const SITES: CertificationSite[] = [
  { name: "Smart Mobility Malta", url: "https://smartmobilitymalta.com/", identity: /smart mobility|mobility|vehicle rental|car rental/i, offering: /rent|rental|booking|fleet|vehicle|car|motorcycle/i, context: /malta|airport|gudja/i },
  { name: "KPMG Malta", url: "https://kpmg.com/mt/en/services.html", identity: /kpmg/i, offering: /audit|tax|advisory|consulting/i, context: /malta/i },
  { name: "db Hotels & Resorts", url: "https://www.dbhotelsresorts.com/en", identity: /db hotels|db seabank|db san antonio/i, offering: /hotel|resort|all-inclusive|hospitality/i, context: /malta|mellieha|qawra/i },
  { name: "Hard Rock Cafe Malta", url: "https://cafe.hardrock.com/malta-bar-valletta/", identity: /hard rock/i, offering: /food|restaurant|cafe|cocktail/i, context: /malta|valletta/i },
  { name: "Corinthia", url: "https://www.corinthia.com/en-gb/hotels/", identity: /corinthia/i, offering: /hotel|luxury|hospitality/i, context: /malta|london|rome|new york|brussels/i },
  { name: "Wolt Malta", url: "https://wolt.com/en/mlt/malta", identity: /wolt/i, offering: /restaurant|grocery|delivery|food/i, context: /malta/i },
  { name: "Bolt Food Malta", url: "https://bolt.eu/en-mt/food/", identity: /bolt/i, offering: /food|delivery|restaurant|store/i, context: /malta/i },
  { name: "Stripe", url: "https://stripe.com/en-mt", identity: /stripe/i, offering: /payment|financial|billing|revenue/i, context: /business|internet|platform|company/i },
  { name: "Notion", url: "https://www.notion.com/product", identity: /notion/i, offering: /workspace|docs|projects|wiki|ai/i, context: /team|work/i },
  { name: "Linear", url: "https://linear.app/", identity: /linear/i, offering: /product|issue|project|development/i, context: /team|software/i },
  { name: "GitHub / Next.js", url: "https://github.com/vercel/next.js", identity: /next\.js|nextjs|vercel/i, offering: /react|framework|web|application/i, context: /github|repository|developer|software/i },
  { name: "Vercel", url: "https://vercel.com/", identity: /vercel/i, offering: /frontend|cloud|deploy|web|developer/i, context: /platform|team|application|website/i },
];

const CONTROL_OR_BIDI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/;
const RESIDUAL_MARKUP = /<\s*(?:script|style|iframe|object|embed|template|svg|noscript|main|span)\b/i;
const INJECTION = /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|prompts?|messages?)\b/i;

interface SiteResult {
  name: string;
  url: string;
  score: number;
  passed: string[];
  failed: string[];
  canonicalUrl?: string;
  error?: string;
}

describe.skipIf(!LIVE)("Flow 1A 12-site live certification", () => {
  it("keeps every site at >=90 and the matrix at >=95 overall", async () => {
    expect(SITES).toHaveLength(12);
    const reader = new SanitizingPublicBrandReferenceReader(new SourceIntelligenceBrandReferenceReader());
    const results: SiteResult[] = [];

    for (const site of SITES) {
      try {
        const reference = await reader.read(site.url);
        const combined = [reference.title, reference.summary, reference.excerpt].filter(Boolean).join(" ");
        const checks: Array<[string, boolean]> = [
          ["fetchable", true],
          ["canonical-url", /^https?:\/\//i.test(reference.url)],
          ["retrieval-provenance", Number.isFinite(Date.parse(reference.retrievedAt))],
          ["usable-evidence", reference.excerpt.trim().length >= 120],
          ["identity-metadata", Boolean(reference.title?.trim() || reference.summary?.trim())],
          ["residual-markup-clean", !RESIDUAL_MARKUP.test(combined)],
          ["unicode-control-clean", !CONTROL_OR_BIDI.test(combined)],
          ["prompt-injection-inert", !INJECTION.test(combined)],
          ["identity-signal", site.identity.test(combined)],
          ["offering-signal", site.offering.test(combined)],
          ["context-signal", site.context.test(combined)],
        ];
        const passed = checks.filter(([, ok]) => ok).map(([name]) => name);
        const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
        results.push({
          name: site.name,
          url: site.url,
          canonicalUrl: reference.url,
          score: Math.round((passed.length / checks.length) * 1_000) / 10,
          passed,
          failed,
        });
      } catch (error) {
        results.push({
          name: site.name,
          url: site.url,
          score: 0,
          passed: [],
          failed: ["fetchable"],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const overall = Math.round((results.reduce((sum, result) => sum + result.score, 0) / results.length) * 10) / 10;
    console.log(`FLOW_1A_CERTIFICATION=${JSON.stringify({ overall, minimum: 90, overallTarget: 95, results })}`);

    expect(results.filter((result) => result.score < 90), JSON.stringify(results, null, 2)).toEqual([]);
    expect(overall, JSON.stringify(results, null, 2)).toBeGreaterThanOrEqual(95);
  }, 600_000);
});
