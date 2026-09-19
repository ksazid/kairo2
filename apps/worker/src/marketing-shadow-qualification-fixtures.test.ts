import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface FixtureClaim { id: string; text: string }
interface BenchmarkFixture {
  id: string;
  sector: string;
  format: string;
  audience: string;
  objective: string;
  opportunity: string;
  claims: FixtureClaim[];
}

const fixtureSet = JSON.parse(
  readFileSync(new URL("../../../evaluation/marketing-lab/benchmark-cases.json", import.meta.url), "utf8"),
) as { schemaVersion: number; fixturePolicy: string; cases: BenchmarkFixture[] };

const qualifyingScope = {
  sector: "Motorcycles / Bikes",
  format: "carousel",
  audience: "enthusiast buyers",
  objective: "comparison and saves",
} as const;

function inQualifyingScope(item: BenchmarkFixture): boolean {
  return item.sector === qualifyingScope.sector &&
    item.format === qualifyingScope.format &&
    item.audience === qualifyingScope.audience &&
    item.objective === qualifyingScope.objective;
}

describe("VS-23 motorcycle carousel qualification fixtures", () => {
  it("provides four distinct cases in one benchmark scope", () => {
    const cases = fixtureSet.cases.filter(inQualifyingScope);
    expect(cases.map((item) => item.id)).toEqual([
      "motorcycle-carousel-01",
      "motorcycle-carousel-02",
      "motorcycle-carousel-03",
      "motorcycle-carousel-04",
    ]);
    expect(new Set(cases.map((item) => item.id)).size).toBe(4);
  });

  it("keeps each qualification case claim-bounded and synthetic/public-safe", () => {
    expect(fixtureSet.fixturePolicy).toMatch(/synthetic\/public-safe/i);
    for (const item of fixtureSet.cases.filter(inQualifyingScope)) {
      expect(item.opportunity.trim().length).toBeGreaterThan(0);
      expect(item.claims.length).toBeGreaterThanOrEqual(2);
      expect(new Set(item.claims.map((claim) => claim.id)).size).toBe(item.claims.length);
      for (const claim of item.claims) {
        expect(claim.id.trim().length).toBeGreaterThan(0);
        expect(claim.text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
