import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/0044_hunter_vector_intelligence.sql", import.meta.url), "utf8");

describe("HI2-02R vector foundation migration", () => {
  it("adds provider-neutral pgvector storage without ranking indexes", () => {
    expect(sql).toContain("create extension if not exists vector");
    expect(sql).toContain("embedding vector not null");
    expect(sql).toContain("provider text not null");
    expect(sql).toContain("model text not null");
    expect(sql).toContain("dimensions integer not null");
    expect(sql.toLowerCase()).toContain("shadow-only semantic embedding storage");
    expect(sql.toLowerCase()).not.toContain("using hnsw");
    expect(sql.toLowerCase()).not.toContain("using ivfflat");
  });
});
