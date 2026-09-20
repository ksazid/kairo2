import type { Pool, PoolClient } from "pg";
import { ResourceNotFoundError } from "@kairo/domain";
import {
  prepareEmbeddingVector,
  prepareSemanticEmbeddingRecord,
  prepareSimilarityLimit,
  type EmbeddingVector,
  type SemanticEmbeddingRecord,
  type SemanticEntityType,
  type SemanticSimilarityMatch,
} from "@kairo/domain/hunter-semantic";

export interface SemanticSimilarityDiagnosticInput {
  brandId: string;
  query: EmbeddingVector;
  entityTypes?: SemanticEntityType[];
  limit?: number;
  excludeEntityId?: string;
}

export class PgHunterSemanticRepository {
  constructor(private readonly pool: Pool) {}

  async save(accountId: string, input: SemanticEmbeddingRecord): Promise<void> {
    const value = prepareSemanticEmbeddingRecord(input);
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, value.brandId);
      if (workspaceId !== value.workspaceId) throw new ResourceNotFoundError("Brand not found");
      await client.query(
        `insert into hunter_semantic_embeddings(
          id,workspace_id,brand_id,entity_type,entity_id,chunk_key,schema_version,
          provider,model,dimensions,content_hash,embedding,created_at,updated_at
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector,$13,now())
        on conflict(workspace_id,brand_id,entity_type,entity_id,chunk_key,provider,model)
        do update set
          schema_version=excluded.schema_version,
          dimensions=excluded.dimensions,
          content_hash=excluded.content_hash,
          embedding=excluded.embedding,
          updated_at=now()`,
        [
          value.id,
          workspaceId,
          value.brandId,
          value.entityType,
          value.entityId,
          value.chunkKey,
          value.schemaVersion,
          value.provider,
          value.model,
          value.dimensions,
          value.contentHash,
          vectorLiteral(value.values),
          value.createdAt,
        ],
      );
    } finally {
      client.release();
    }
  }

  async diagnoseNearest(
    accountId: string,
    input: SemanticSimilarityDiagnosticInput,
  ): Promise<SemanticSimilarityMatch[]> {
    const query = prepareEmbeddingVector(input.query);
    const limit = prepareSimilarityLimit(input.limit);
    const entityTypes = input.entityTypes?.length ? [...new Set(input.entityTypes)] : undefined;
    const client = await this.pool.connect();
    try {
      const workspaceId = await requireBrandWorkspace(client, accountId, input.brandId);
      const result = await client.query<{
        entity_type: SemanticEntityType;
        entity_id: string;
        chunk_key: string;
        provider: string;
        model: string;
        cosine_distance: number | string;
      }>(
        `select entity_type,entity_id,chunk_key,provider,model,
                embedding <=> $6::vector as cosine_distance
           from hunter_semantic_embeddings
          where workspace_id=$1
            and brand_id=$2
            and provider=$3
            and model=$4
            and dimensions=$5
            and ($7::text[] is null or entity_type = any($7::text[]))
            and ($8::text is null or entity_id <> $8)
          order by embedding <=> $6::vector, entity_id, chunk_key
          limit $9`,
        [
          workspaceId,
          input.brandId,
          query.provider,
          query.model,
          query.dimensions,
          vectorLiteral(query.values),
          entityTypes ?? null,
          input.excludeEntityId?.trim() || null,
          limit,
        ],
      );
      return result.rows.map((row) => {
        const distance = typeof row.cosine_distance === "number" ? row.cosine_distance : Number(row.cosine_distance);
        const safeDistance = Number.isFinite(distance) ? distance : 2;
        return {
          entityType: row.entity_type,
          entityId: row.entity_id,
          chunkKey: row.chunk_key,
          provider: row.provider,
          model: row.model,
          cosineDistance: safeDistance,
          cosineSimilarity: Math.max(-1, Math.min(1, 1 - safeDistance)),
        };
      });
    } finally {
      client.release();
    }
  }
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

async function requireBrandWorkspace(client: PoolClient, accountId: string, brandId: string): Promise<string> {
  const result = await client.query<{ workspace_id: string }>(
    `select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id
      where m.account_id=$1 and m.active=true and b.id=$2`,
    [accountId, brandId],
  );
  const workspaceId = result.rows[0]?.workspace_id;
  if (!workspaceId) throw new ResourceNotFoundError("Brand not found");
  return workspaceId;
}
