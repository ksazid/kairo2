import { describe, expect, it, vi } from "vitest";
import { createAccountScopedHunterSemanticExpansionPort } from "./hunter-semantic-expansion";

describe("account-scoped Hunter semantic expansion", () => {
  it("embeds a query and requests only public-signal neighbors", async () => {
    const embedQuery = vi.fn(async () => ({ provider:"test-provider",model:"m1",dimensions:2,values:[0.1,0.9] }));
    const diagnoseNearest = vi.fn(async (_accountId: string, input: any) => {
      expect(input.entityTypes).toEqual(["public-signal"]);
      expect(input.limit).toBe(4);
      return [{ entityType:"public-signal",entityId:"signal-1",chunkKey:"document",provider:"test-provider",model:"m1",cosineDistance:0.2,cosineSimilarity:0.8 }];
    });
    const port = createAccountScopedHunterSemanticExpansionPort({
      accountId:"account-1",
      repository:{ diagnoseNearest } as any,
      embedder:{ embedQuery, embedDocuments:vi.fn() } as any,
    });
    const result = await port.expand({ brandId:"brand-1",queryText:"battery health",limit:4 });
    expect(embedQuery).toHaveBeenCalledWith({ text:"battery health" });
    expect(diagnoseNearest).toHaveBeenCalledWith("account-1", expect.objectContaining({ brandId:"brand-1" }));
    expect(result).toEqual([{ entityId:"signal-1",similarity:0.8,provider:"test-provider",model:"m1" }]);
  });
});