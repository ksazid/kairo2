import{readFileSync}from"node:fs";
import{describe,expect,it}from"vitest";
const sql=readFileSync(new URL("../migrations/0027_creative_thumbnail_lineage.sql",import.meta.url),"utf8");
describe("creative thumbnail lineage migration",()=>{it("binds a complete immutable-addressed thumbnail to each rendered version",()=>{expect(sql).toContain("thumbnail_object_key");expect(sql).toContain("thumbnail_sha256");expect(sql).toContain("carousel_thumbnail_complete_check");expect(sql).toContain("unique index carousel_rendered_thumbnail_object")})});
