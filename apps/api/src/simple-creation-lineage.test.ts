import { describe, expect, it } from "vitest";
import type { BrandPresenterDto } from "@kairo/contracts/presenter";
import { SimpleCreationService, type SimpleCreationRequest, type SimpleCreationStore } from "./simple-creation";

class MemoryStore implements SimpleCreationStore {
  rows: SimpleCreationRequest[] = [];
  async create(value: SimpleCreationRequest) { this.rows.push(value); return value; }
  async get(accountId: string, brandId: string, id: string) { return this.rows.find((row) => row.accountId === accountId && row.brandId === brandId && row.id === id) ?? null; }
  async claim() { return null; }
  async advance() {}
  async getPresenter() { return null; }
  async putPresenter(value: BrandPresenterDto) { return value; }
}

function researchRepo(workspaceId = "w", brandId = "b") {
  return {
    async getIdeaBundle(_accountId: string, requestedBrandId: string, ideaId: string) {
      if (ideaId !== "idea-opportunity" || requestedBrandId !== brandId) return null;
      return {
        idea: {
          id: ideaId,
          workspaceId,
          brandId,
          title: "Opportunity idea",
          premise: "Evidence-linked direction",
          source: { type: "opportunity", opportunityId: "opp-1" },
          status: "new",
          createdAt: "2026-08-26T00:00:00.000Z",
        },
        research: null,
        angles: [],
      };
    },
  } as never;
}

describe("VS-104 simple creation lineage", () => {
  it("continues an existing opportunity-linked Idea instead of creating an unrelated user Idea", async () => {
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, researchRepo(), {} as never, { develop: async () => {} });
    const created = await service.start("a", "w", "b", {
      goal: "Develop the recommendation",
      input: "Use the evidence-backed direction",
      contentPreference: "carousel",
      ideaId: "idea-opportunity",
    });
    expect(created.ideaId).toBe("idea-opportunity");
    expect(store.rows[0]?.ideaId).toBe("idea-opportunity");
  });

  it("rejects a cross-Brand or missing Idea before persisting a creation request", async () => {
    const store = new MemoryStore();
    const service = new SimpleCreationService(store, researchRepo("other-workspace", "other-brand"), {} as never, { develop: async () => {} });
    await expect(service.start("a", "w", "b", {
      goal: "Develop",
      contentPreference: "image",
      ideaId: "idea-opportunity",
    })).rejects.toThrow("Idea not found");
    expect(store.rows).toHaveLength(0);
  });
});
