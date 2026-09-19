import type { CommandSearchResultDto } from "@kairo/contracts";

export interface CommandSearchQuery {
  query: string;
  brandId?: string;
  limit: number;
}

export interface CommandSearchRepository {
  search(accountId: string, query: CommandSearchQuery): Promise<CommandSearchResultDto[]>;
}
