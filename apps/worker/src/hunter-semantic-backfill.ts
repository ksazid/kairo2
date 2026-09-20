import { createHash, randomUUID } from "node:crypto";
import {
  prepareEmbeddingDocument,
  prepareEmbeddingVector,
  prepareSemanticEmbeddingRecord,
  type EmbeddingPort,
  type SemanticEmbeddingRecord,
  type SemanticEntityType,
} from "@kairo/domain/hunter-semantic";

export interface SemanticBackfillItem {
  workspaceId: string;
  brandId: string;
  entityType: SemanticEntityType;
  entityId: string;
  chunkKey?: string;
  text: string;
}

export interface SemanticBackfillSink {
  save(record: SemanticEmbeddingRecord): Promise<void>;
}

export interface SemanticBackfillOptions {
  maxItems?: number;
  batchSize?: number;
  now?: () => Date;
}

export interface SemanticBackfillResult {
  requested: number;
  processed: number;
  skipped: number;
  failed: number;
  provider?: string;
  model?: string;
}

/**
 * Shadow-only helper. It has no source discovery, scheduler, or ranking authority.
 * A caller must explicitly supply both corpus items and an EmbeddingPort.
 */
export async function runBoundedSemanticBackfill(
  items: readonly SemanticBackfillItem[],
  embedder: EmbeddingPort,
  sink: SemanticBackfillSink,
  options: SemanticBackfillOptions = {},
): Promise<SemanticBackfillResult> {
  const maxItems = boundedInteger(options.maxItems ?? 100, "maxItems", 1, 500);
  const batchSize = boundedInteger(options.batchSize ?? 16, "batchSize", 1, 64);
  const selected = items.slice(0, maxItems);
  const result: SemanticBackfillResult = {
    requested: selected.length,
    processed: 0,
    skipped: Math.max(0, items.length - selected.length),
    failed: 0,
  };
  const now = options.now ?? (() => new Date());

  for (let offset = 0; offset < selected.length; offset += batchSize) {
    const batch = selected.slice(offset, offset + batchSize);
    const documents = batch.map((item, index) => prepareEmbeddingDocument({
      id: `${offset + index}:${item.entityType}:${item.entityId}:${item.chunkKey ?? "document"}`,
      text: item.text,
    }));

    let vectors: readonly ReturnType<typeof prepareEmbeddingVector>[];
    try {
      const output = await embedder.embedDocuments(documents);
      if (output.length !== batch.length) throw new Error("EmbeddingPort returned a different vector count than requested");
      vectors = output.map((value) => prepareEmbeddingVector(value));
    } catch {
      result.failed += batch.length;
      continue;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index]!;
      const vector = vectors[index]!;
      if (result.provider && (result.provider !== vector.provider || result.model !== vector.model)) {
        result.failed += 1;
        continue;
      }
      result.provider ??= vector.provider;
      result.model ??= vector.model;
      try {
        await sink.save(prepareSemanticEmbeddingRecord({
          id: randomUUID(),
          workspaceId: item.workspaceId,
          brandId: item.brandId,
          entityType: item.entityType,
          entityId: item.entityId,
          chunkKey: item.chunkKey?.trim() || "document",
          provider: vector.provider,
          model: vector.model,
          dimensions: vector.dimensions,
          contentHash: createHash("sha256").update(item.text).digest("hex"),
          values: vector.values,
          createdAt: now().toISOString(),
        }));
        result.processed += 1;
      } catch {
        result.failed += 1;
      }
    }
  }

  return result;
}

function boundedInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}
