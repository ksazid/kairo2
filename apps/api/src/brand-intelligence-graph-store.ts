import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { buildTopicGraph, nextGraphVersion, type BrandIntelligenceTopicGraph, type SectorPackId } from "@kairo/domain/brand-intelligence";
import type { BrandBrainFieldDto } from "@kairo/contracts";

export interface PersistedBrandIntelligenceGraph {
  id: string;
  workspaceId: string;
  brandId: string;
  version: number;
  graph: BrandIntelligenceTopicGraph;
  createdAt: string;
}

export interface BrandIntelligenceGraphStore {
  getLatest(accountId: string, brandId: string): Promise<PersistedBrandIntelligenceGraph | undefined>;
  ensureCurrent(accountId: string, workspaceId: string, brandId: string, fields: readonly BrandBrainFieldDto[], sectorPack: SectorPackId): Promise<PersistedBrandIntelligenceGraph>;
}

export class PgBrandIntelligenceGraphStore implements BrandIntelligenceGraphStore {
  constructor(private readonly pool: Pool) {}

  async getLatest(accountId: string, brandId: string): Promise<PersistedBrandIntelligenceGraph | undefined> {
    const result = await this.pool.query<GraphRow>(`select g.id,g.workspace_id,g.brand_id,g.version,g.graph,g.created_at
      from brand_intelligence_graph_versions g join workspace_memberships m on m.workspace_id=g.workspace_id
      where m.account_id=$1 and m.active=true and g.brand_id=$2 order by g.version desc limit 1`, [accountId, brandId]);
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async ensureCurrent(accountId: string, workspaceId: string, brandId: string, fields: readonly BrandBrainFieldDto[], sectorPack: SectorPackId) {
    const access = await this.pool.query(`select 1 from brands b join workspace_memberships m on m.workspace_id=b.workspace_id
      where m.account_id=$1 and m.active=true and b.workspace_id=$2 and b.id=$3`, [accountId, workspaceId, brandId]);
    if (!access.rowCount) throw new Error("Brand not found");
    const graph = buildTopicGraph(fields, sectorPack);
    const current = await this.getLatest(accountId, brandId);
    if (current?.graph.fingerprint === graph.fingerprint) return current;
    const version = nextGraphVersion(current ? { version: current.version, fingerprint: current.graph.fingerprint } : undefined, graph.fingerprint);
    const result = await this.pool.query<GraphRow>(`insert into brand_intelligence_graph_versions
      (id,workspace_id,brand_id,version,schema_version,sector_pack,fingerprint,graph)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      on conflict (workspace_id,brand_id,fingerprint) do update set fingerprint=excluded.fingerprint
      returning id,workspace_id,brand_id,version,graph,created_at`,
      [randomUUID(), workspaceId, brandId, version, graph.schemaVersion, graph.sectorPack, graph.fingerprint, JSON.stringify(graph)]);
    return fromRow(result.rows[0]!);
  }
}

type GraphRow = { id: string; workspace_id: string; brand_id: string; version: number; graph: BrandIntelligenceTopicGraph; created_at: Date | string };
function fromRow(row: GraphRow): PersistedBrandIntelligenceGraph { return { id: row.id, workspaceId: row.workspace_id, brandId: row.brand_id, version: row.version, graph: row.graph, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString() }; }
