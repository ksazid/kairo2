import {
  prepareEmbeddingQuery,
  prepareEmbeddingVector,
  type EmbeddingPort,
} from "@kairo/domain/hunter-semantic";
import type { HunterSemanticExpansionPort } from "@kairo/domain/hunter-retrieval";
import { PgHunterSemanticRepository } from "./hunter-semantic-postgres";

export function createAccountScopedHunterSemanticExpansionPort(input: {
  accountId: string;
  repository: PgHunterSemanticRepository;
  embedder: EmbeddingPort;
}): HunterSemanticExpansionPort {
  const accountId = requiredText(input.accountId, "accountId");
  return {
    async expand(request) {
      const queryInput = prepareEmbeddingQuery({ text: request.queryText });
      const vector = prepareEmbeddingVector(await input.embedder.embedQuery(queryInput));
      const matches = await input.repository.diagnoseNearest(accountId, {
        brandId: request.brandId,
        query: vector,
        entityTypes: ["public-signal"],
        limit: request.limit,
      });
      return matches.map((match) => ({
        entityId: match.entityId,
        similarity: match.cosineSimilarity,
        provider: match.provider,
        model: match.model,
      }));
    },
  };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(field + " is required");
  return value.trim();
}