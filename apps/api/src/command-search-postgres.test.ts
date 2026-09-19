import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PgCommandSearchRepository } from "./command-search-postgres";

describe("PgCommandSearchRepository", () => {
  it("enforces active membership in SQL, escapes LIKE input and maps deep links", async () => {
    const query = vi.fn<(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>>(async()=>({rows:[
      {kind:"campaign",id:"campaign-1",brand_id:"brand-1",brand_name:"Kairo",label:"Launch",detail:"Promote",campaign_id:"campaign-1"},
      {kind:"content-asset",id:"asset-1",brand_id:"brand-1",brand_name:"Kairo",label:"Launch reel",detail:"reel · instagram",campaign_id:"campaign-1"},
    ]}));
    const repository = new PgCommandSearchRepository({query} as unknown as Pool);
    const results = await repository.search("account-1",{query:"50%_off",brandId:"brand-1",limit:10});
    const [sql,values] = query.mock.calls[0]!;
    expect(sql).toContain("workspace_memberships");
    expect(sql).toContain("m.active=true");
    expect(sql).toContain("($3::text is null or b.id=$3)");
    expect(values).toEqual(["account-1","%50\\%\\_off%","brand-1",10]);
    expect(results.map(result=>result.href)).toEqual([
      "/brands/brand-1/campaigns/campaign-1",
      "/brands/brand-1/campaigns/campaign-1#asset-asset-1",
    ]);
  });
});
