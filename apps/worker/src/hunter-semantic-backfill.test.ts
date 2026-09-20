import { describe, expect, it, vi } from "vitest";
import { runBoundedSemanticBackfill } from "./hunter-semantic-backfill";

describe("runBoundedSemanticBackfill", () => {
  it("hard-bounds corpus size and requires an injected embedder/sink", async () => {
    const embedDocuments = vi.fn(async (inputs: readonly { id: string; text: string }[]) =>
      inputs.map(() => ({
        provider: "test-provider",
        model: "test-model",
        dimensions: 2,
        values: [0.2, 0.8],
      })),
    );
    const saved: unknown[] = [];
    const sink = { save: vi.fn(async (record: unknown) => { saved.push(record); }) };

    const result = await runBoundedSemanticBackfill([
      { workspaceId:"w",brandId:"b",entityType:"public-signal",entityId:"1",text:"one" },
      { workspaceId:"w",brandId:"b",entityType:"public-signal",entityId:"2",text:"two" },
      { workspaceId:"w",brandId:"b",entityType:"public-signal",entityId:"3",text:"three" },
    ], { embedDocuments, embedQuery: vi.fn() } as any, sink, {
      maxItems: 2,
      batchSize: 2,
      now: () => new Date("2026-09-20T01:20:00Z"),
    });

    expect(embedDocuments).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(2);
    expect(result).toEqual({
      requested: 2,
      processed: 2,
      skipped: 1,
      failed: 0,
      provider: "test-provider",
      model: "test-model",
    });
  });

  it("refuses an unbounded backfill configuration", async () => {
    await expect(runBoundedSemanticBackfill([], {} as any, {} as any, { maxItems: 501 }))
      .rejects.toThrow("maxItems must be an integer from 1 to 500");
  });
});
