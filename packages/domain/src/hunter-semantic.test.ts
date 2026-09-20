import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import {
  prepareEmbeddingQuery,
  prepareEmbeddingVector,
  prepareSemanticEmbeddingRecord,
  prepareSimilarityLimit,
} from "./hunter-semantic";

describe("Hunter semantic contracts", () => {
  it("validates provider-neutral vectors and record lineage", () => {
    const vector = prepareEmbeddingVector({
      provider: "test-provider",
      model: "test-model",
      dimensions: 3,
      values: [0.1, 0.2, 0.3],
    });
    expect(vector).toEqual({
      provider: "test-provider",
      model: "test-model",
      dimensions: 3,
      values: [0.1, 0.2, 0.3],
    });

    const record = prepareSemanticEmbeddingRecord({
      id: "embedding-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      entityType: "public-signal",
      entityId: "signal-1",
      chunkKey: "document",
      provider: vector.provider,
      model: vector.model,
      dimensions: vector.dimensions,
      contentHash: "a".repeat(64),
      values: vector.values,
      createdAt: "2026-09-20T01:20:00Z",
    });
    expect(record.schemaVersion).toBe("1");
    expect(record.entityType).toBe("public-signal");
  });

  it("fails closed on dimension mismatch and unsupported entities", () => {
    expect(() => prepareEmbeddingVector({
      provider: "p",
      model: "m",
      dimensions: 2,
      values: [0.1],
    })).toThrow("must match dimensions");

    expect(() => prepareSemanticEmbeddingRecord({
      id: "embedding-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      entityType: "unknown" as any,
      entityId: "x",
      chunkKey: "document",
      provider: "p",
      model: "m",
      dimensions: 1,
      contentHash: "a".repeat(64),
      values: [0.1],
      createdAt: "2026-09-20T01:20:00Z",
    })).toThrow(DomainValidationError);
  });

  it("bounds query text and diagnostic result count", () => {
    expect(prepareEmbeddingQuery({ text: "battery health" })).toEqual({ text: "battery health" });
    expect(prepareSimilarityLimit(undefined)).toBe(10);
    expect(prepareSimilarityLimit(50)).toBe(50);
    expect(() => prepareSimilarityLimit(51)).toThrow("1 to 50");
  });
});
