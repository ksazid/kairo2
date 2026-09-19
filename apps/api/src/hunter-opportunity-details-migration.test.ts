import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/0032_hunter_opportunity_details.sql", import.meta.url), "utf8");

describe("Hunter opportunity details migration", () => {
  it("adds idempotent structured details storage without weakening existing lineage", () => {
    expect(sql).toContain("add column if not exists opportunity_details jsonb");
    expect(sql).toContain("jsonb_typeof(opportunity_details) = 'object'");
    expect(sql).toContain("duplicate_object");
  });
});
