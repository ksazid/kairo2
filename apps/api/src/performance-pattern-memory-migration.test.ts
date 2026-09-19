import{readFileSync}from"node:fs";
import{describe,expect,it}from"vitest";
const sql=readFileSync(new URL("../migrations/0028_performance_pattern_memory.sql",import.meta.url),"utf8");
describe("performance pattern memory migration",()=>{it("stores structured evidence-bound patterns with the Learning",()=>{expect(sql).toContain("add column if not exists patterns jsonb");expect(sql).toContain("jsonb_typeof(patterns)='array'")})});
