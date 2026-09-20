import { describe, expect, it, vi } from "vitest";
import type { DiscoveryEvidence } from "@kairo/agent-contracts";
import type { HunterRetrievalPlan } from "@kairo/domain/hunter-retrieval";
import { runShadowRetrieval } from "./hunter-shadow-retrieval";

const basePlan: HunterRetrievalPlan = {
  schemaVersion: "1",
  workspaceId: "w",
  brandId: "b",
  snapshotVersion: "s1",
  planVersion: "p1",
  explorationBudget: 0.1,
  intents: [
    { id:"i1",generator:"brand-core",mode:"lexical-search",topicId:"t1",topicName:"EV battery",query:"ev battery",semanticQuery:"ev battery",audience:"buyers",sourceClasses:["Industry news"],priority:"high",maxResults:5,reason:"core" },
    { id:"i2",generator:"rising-breaking",mode:"lexical-search",topicId:"t1",topicName:"EV battery",query:"ev battery rising",semanticQuery:"ev battery rising",audience:"buyers",sourceClasses:["Industry news"],priority:"high",maxResults:5,reason:"rising" },
    { id:"i3",generator:"adjacent-exploration",mode:"semantic-expansion",topicId:"t1",topicName:"EV battery",query:"adjacent",semanticQuery:"ev charging adjacent",audience:"buyers",sourceClasses:["Industry news"],priority:"exploration",maxResults:3,reason:"explore" },
    { id:"i4",generator:"cross-source-confirmation",mode:"corroboration",topicId:"t1",topicName:"EV battery",query:"corroborate",semanticQuery:"corroborate",audience:"buyers",sourceClasses:["Industry news"],priority:"high",maxResults:3,reason:"corroborate" },
  ],
  hardNegatives: [{ key:"crypto speculation", source:"discovery-plan", strength:1 }],
};

const evidence = (overrides: Partial<DiscoveryEvidence> = {}): DiscoveryEvidence => ({
  title:"EV battery health checks before buying a used EV",
  summary:"Five battery health checks for used EV buyers",
  sourceUrl:"https://example.com/ev-battery?utm_source=test",
  platform:"web",
  publisher:"Example",
  retrievedAt:"2026-09-20T01:00:00Z",
  provider:"agent-reach",
  ...overrides,
});

describe("runShadowRetrieval", () => {
  it("deduplicates, rejects hard negatives, tracks corroboration and semantic references", async () => {
    const search = {
      search: vi.fn(async (intent: any) => intent.id === "i1" ? [
        evidence(),
        evidence({ title:"Crypto speculation for EV investors", sourceUrl:"https://example.com/crypto" }),
      ] : [
        evidence({
          title:"Used EV battery health checks before buying",
          summary:"Battery health checks for used EV buyers",
          sourceUrl:"https://news.example.org/battery-health",
          platform:"rss",
          publisher:"EV News",
          provider:"rss",
        }),
        evidence({ sourceUrl:"https://example.com/ev-battery?utm_campaign=dup" }),
      ]),
    };
    const semantic = {
      expand: vi.fn(async () => [{ entityId:"signal-77", similarity:0.82, provider:"test", model:"embed-v1" }]),
    };

    const run = await runShadowRetrieval(basePlan, search, semantic);
    expect(run.candidates).toHaveLength(2);
    expect(run.diagnostics.hardNegativeRejectedCount).toBe(1);
    expect(run.diagnostics.duplicateCount).toBe(1);
    expect(run.diagnostics.semanticReferenceCount).toBe(1);
    expect(run.diagnostics.topicRecallProxy).toBe(1);
    expect(run.diagnostics.corroboratedCandidateCount).toBe(2);
    expect(run.candidates.every((candidate) => candidate.generatorKeys.includes("cross-source-confirmation"))).toBe(true);
  });

  it("enforces external and semantic call ceilings", async () => {
    const search = { search: vi.fn(async () => [evidence()]) };
    const semantic = { expand: vi.fn(async () => []) };
    await runShadowRetrieval(basePlan, search, semantic, undefined, { maxExternalCalls:1, maxSemanticCalls:0 });
    expect(search.search).toHaveBeenCalledTimes(1);
    expect(semantic.expand).not.toHaveBeenCalled();
  });
});