import { describe, expect, it, vi } from "vitest";
import { PgHunterSemanticRepository } from "./hunter-semantic-postgres";

describe("PgHunterSemanticRepository", () => {
  it("persists a tenant-authorized embedding with explicit provider metadata", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("select b.workspace_id")) return { rows: [{ workspace_id: "workspace-1" }] };
      if (sql.includes("insert into hunter_semantic_embeddings")) {
        expect(sql).toContain("$12::vector");
        expect(params).toEqual([
          "embedding-1",
          "workspace-1",
          "brand-1",
          "public-signal",
          "signal-1",
          "document",
          "1",
          "test-provider",
          "test-model",
          3,
          "a".repeat(64),
          "[0.1,0.2,0.3]",
          "2026-09-20T01:20:00Z",
        ]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const pool = { connect: vi.fn(async () => ({ query, release })) } as any;

    await new PgHunterSemanticRepository(pool).save("account-1", {
      schemaVersion: "1",
      id: "embedding-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      entityType: "public-signal",
      entityId: "signal-1",
      chunkKey: "document",
      provider: "test-provider",
      model: "test-model",
      dimensions: 3,
      contentHash: "a".repeat(64),
      values: [0.1, 0.2, 0.3],
      createdAt: "2026-09-20T01:20:00Z",
    });

    expect(release).toHaveBeenCalledOnce();
  });

  it("returns diagnostic similarity only for matching provider/model/dimensions", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("select b.workspace_id")) return { rows: [{ workspace_id: "workspace-1" }] };
      if (sql.includes("embedding <=> $6::vector")) {
        expect(params).toEqual([
          "workspace-1",
          "brand-1",
          "test-provider",
          "test-model",
          3,
          "[0.1,0.2,0.3]",
          ["public-signal"],
          "query-source",
          5,
        ]);
        return {
          rows: [{
            entity_type: "public-signal",
            entity_id: "signal-2",
            chunk_key: "document",
            provider: "test-provider",
            model: "test-model",
            cosine_distance: "0.25",
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const pool = { connect: vi.fn(async () => ({ query, release })) } as any;

    const matches = await new PgHunterSemanticRepository(pool).diagnoseNearest("account-1", {
      brandId: "brand-1",
      query: {
        provider: "test-provider",
        model: "test-model",
        dimensions: 3,
        values: [0.1, 0.2, 0.3],
      },
      entityTypes: ["public-signal"],
      excludeEntityId: "query-source",
      limit: 5,
    });

    expect(matches).toEqual([expect.objectContaining({
      entityId: "signal-2",
      cosineDistance: 0.25,
      cosineSimilarity: 0.75,
    })]);
    expect(release).toHaveBeenCalledOnce();
  });
});
