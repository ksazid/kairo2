import { DomainValidationError } from "./index";

export const HUNTER_SEMANTIC_SCHEMA_VERSION = "1" as const;

export const SEMANTIC_ENTITY_TYPES = [
  "public-signal",
  "brand-topic",
  "opportunity",
  "accepted-learning",
  "published-mechanism",
] as const;

export type SemanticEntityType = (typeof SEMANTIC_ENTITY_TYPES)[number];

export interface EmbeddingDocumentInput {
  id: string;
  text: string;
}

export interface EmbeddingQueryInput {
  text: string;
}

export interface EmbeddingVector {
  provider: string;
  model: string;
  dimensions: number;
  values: number[];
}

export interface EmbeddingPort {
  embedDocuments(inputs: readonly EmbeddingDocumentInput[]): Promise<readonly EmbeddingVector[]>;
  embedQuery(input: EmbeddingQueryInput): Promise<EmbeddingVector>;
}

export interface SemanticEmbeddingRecord {
  schemaVersion: typeof HUNTER_SEMANTIC_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  brandId: string;
  entityType: SemanticEntityType;
  entityId: string;
  chunkKey: string;
  provider: string;
  model: string;
  dimensions: number;
  contentHash: string;
  values: number[];
  createdAt: string;
}

export type SemanticEmbeddingRecordInput = Omit<SemanticEmbeddingRecord, "schemaVersion">;

export function prepareSemanticEmbeddingRecord(input: SemanticEmbeddingRecordInput): SemanticEmbeddingRecord {
  if (!SEMANTIC_ENTITY_TYPES.includes(input.entityType)) {
    throw new DomainValidationError("semantic entityType is not supported");
  }
  const values = prepareEmbeddingValues(input.values, input.dimensions);
  return {
    schemaVersion: HUNTER_SEMANTIC_SCHEMA_VERSION,
    id: requiredText(input.id, "id", 200),
    workspaceId: requiredText(input.workspaceId, "workspaceId", 200),
    brandId: requiredText(input.brandId, "brandId", 200),
    entityType: input.entityType,
    entityId: requiredText(input.entityId, "entityId", 300),
    chunkKey: requiredText(input.chunkKey, "chunkKey", 200),
    provider: requiredText(input.provider, "provider", 120),
    model: requiredText(input.model, "model", 200),
    dimensions: input.dimensions,
    contentHash: sha256(input.contentHash),
    values,
    createdAt: timestamp(input.createdAt, "createdAt"),
  };
}

export function prepareEmbeddingDocument(input: EmbeddingDocumentInput): EmbeddingDocumentInput {
  return {
    id: requiredText(input.id, "id", 300),
    text: requiredText(input.text, "text", 50_000),
  };
}

export function prepareEmbeddingQuery(input: EmbeddingQueryInput): EmbeddingQueryInput {
  return { text: requiredText(input.text, "text", 20_000) };
}

export function prepareEmbeddingVector(input: EmbeddingVector): EmbeddingVector {
  return {
    provider: requiredText(input.provider, "provider", 120),
    model: requiredText(input.model, "model", 200),
    dimensions: input.dimensions,
    values: prepareEmbeddingValues(input.values, input.dimensions),
  };
}

export interface SemanticSimilarityMatch {
  entityType: SemanticEntityType;
  entityId: string;
  chunkKey: string;
  provider: string;
  model: string;
  cosineDistance: number;
  cosineSimilarity: number;
}

export function prepareSimilarityLimit(value: number | undefined, fallback = 10): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 50) {
    throw new DomainValidationError("semantic similarity limit must be an integer from 1 to 50");
  }
  return candidate;
}

function prepareEmbeddingValues(values: unknown, dimensions: unknown): number[] {
  if (!Number.isInteger(dimensions) || (dimensions as number) < 1 || (dimensions as number) > 8_192) {
    throw new DomainValidationError("embedding dimensions must be an integer from 1 to 8192");
  }
  if (!Array.isArray(values) || values.length !== dimensions) {
    throw new DomainValidationError("embedding values must match dimensions");
  }
  const normalized = values.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new DomainValidationError(`embedding value ${index} must be finite`);
    }
    return value;
  });
  return normalized;
}

function sha256(value: unknown): string {
  const normalized = requiredText(value, "contentHash", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new DomainValidationError("contentHash must be a SHA-256 hex digest");
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(`${field} must be a valid timestamp`);
  return normalized;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(`${field} is required`);
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}
