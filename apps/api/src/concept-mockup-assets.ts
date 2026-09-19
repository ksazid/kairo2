import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ConceptMockupAssetDto, ConceptMockupDto } from "@kairo/contracts/concept-mockup";
import type { OpportunityDetailsDto } from "@kairo/contracts";
import { ResourceNotFoundError } from "@kairo/domain";
import { buildConceptMockup } from "@kairo/domain/concept-mockup";
import type { TemporaryObjectSigner } from "./carousel-studio-postgres";

const PROMPT_VERSION = "concept-svg-v1";

/** Narrow local port so the concept pipeline is storage-provider agnostic. */
export interface ConceptMockupObjectStore {
  putPrivateObject(input: { workspaceId: string; brandId: string; objectKey: string; contentType: string; contentHash: string; bytes: Uint8Array }): Promise<{ objectId: string }>;
}

type AssetRow = Omit<ConceptMockupAssetDto, "url"> & { created_at: Date | string; updated_at: Date | string; mime_type: string; storage_provider: string; storage_key: string; prompt_version: string };

export class ConceptMockupAssetService {
  constructor(
    private readonly pool: Pool,
    private readonly objects: ConceptMockupObjectStore | undefined,
    private readonly storageProvider: string | undefined,
    private readonly signer: TemporaryObjectSigner | undefined,
  ) {}

  async list(accountId: string, brandId: string, opportunityId: string): Promise<ConceptMockupAssetDto[]> {
    const scope = await this.scope(accountId, brandId, opportunityId);
    const result = await this.pool.query<AssetRow>(
      `select id,kind,position,status,mime_type,width,height,storage_provider,storage_key,prompt_version,created_at,updated_at
         from opportunity_concept_mockup_assets
        where workspace_id=$1 and brand_id=$2 and opportunity_id=$3
        order by position,id`,
      [scope.workspaceId, brandId, opportunityId],
    );
    return Promise.all(result.rows.map(async (row) => ({
      id: row.id, kind: row.kind, position: row.position, status: row.status,
      mimeType: row.mime_type, width: row.width, height: row.height,
      storageProvider: row.storage_provider, storageKey: row.storage_key, promptVersion: row.prompt_version,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      ...(row.status === "ready" && this.signer ? { url: await this.signer.sign({ storageProvider: row.storage_provider, objectKey: row.storage_key, expiresInSeconds: 900 }) } : {}),
    })));
  }

  async generate(accountId: string, brandId: string, opportunityId: string): Promise<ConceptMockupAssetDto[]> {
    if (!this.objects || !this.storageProvider) throw new ConceptMockupAssetsUnavailableError();
    const scope = await this.scope(accountId, brandId, opportunityId);
    const source = await this.pool.query<{ name: string; title: string; rationale: string; why_now: string; development_direction: string; opportunity_details: OpportunityDetailsDto | null; concept_mockup: ConceptMockupDto | null }>(
      `select b.name,o.title,o.rationale,o.why_now,o.development_direction,o.opportunity_details,o.concept_mockup from brand_opportunities o
         join brands b on b.workspace_id=o.workspace_id and b.id=o.brand_id
        where o.workspace_id=$1 and o.brand_id=$2 and o.id=$3`,
      [scope.workspaceId, brandId, opportunityId],
    );
    const row = source.rows[0];
    if (!row) throw new ResourceNotFoundError("Opportunity not found");
    const mockup = row.concept_mockup ?? buildConceptMockup({
      title: row.title,
      rationale: row.rationale,
      whyNow: row.why_now,
      developmentDirection: row.development_direction,
      ...(row.opportunity_details?.hook ? { hook: row.opportunity_details.hook } : {}),
      ...(row.opportunity_details?.proposedAngle ? { proposedAngle: row.opportunity_details.proposedAngle } : {}),
      ...(row.opportunity_details?.targetAudience ? { targetAudience: row.opportunity_details.targetAudience } : {}),
      ...(row.opportunity_details?.objective ? { objective: row.opportunity_details.objective } : {}),
      ...(row.opportunity_details?.recommendedFormat ? { recommendedFormat: row.opportunity_details.recommendedFormat } : {}),
    });
    if (!row.concept_mockup) {
      await this.pool.query(
        `update brand_opportunities
            set concept_mockup=$4,concept_mockup_version=$5,concept_mockup_generated_at=now(),updated_at=now()
          where workspace_id=$1 and brand_id=$2 and id=$3`,
        [scope.workspaceId, brandId, opportunityId, JSON.stringify(mockup), mockup.version],
      );
    }

    const existing = await this.list(accountId, brandId, opportunityId);
    if (existing.some((asset) => asset.status === "ready")) return existing;

    const specs = renderSpecs(row.name, row.title, mockup);
    for (const spec of specs) {
      const id = randomUUID();
      const bytes = new TextEncoder().encode(spec.svg);
      const key = `generated/${scopeKey(scope.workspaceId, brandId)}/concept-mockups/${opportunityId}/${PROMPT_VERSION}/${spec.kind}-${spec.position}.svg`;
      await this.objects.putPrivateObject({ workspaceId: scope.workspaceId, brandId, objectKey: key, contentType: "image/svg+xml", contentHash: sha256(bytes), bytes });
      await this.pool.query(
        `insert into opportunity_concept_mockup_assets
          (id,workspace_id,brand_id,opportunity_id,kind,position,status,storage_provider,storage_key,mime_type,width,height,prompt_version)
         values($1,$2,$3,$4,$5,$6,'ready',$7,$8,'image/svg+xml',$9,$10,$11)
         on conflict(workspace_id,brand_id,opportunity_id,kind,position) do update
           set status='ready',storage_provider=excluded.storage_provider,storage_key=excluded.storage_key,mime_type=excluded.mime_type,width=excluded.width,height=excluded.height,prompt_version=excluded.prompt_version,failure_reason=null,updated_at=now()`,
        [id, scope.workspaceId, brandId, opportunityId, spec.kind, spec.position, this.storageProvider, key, spec.width, spec.height, PROMPT_VERSION],
      );
    }
    return this.list(accountId, brandId, opportunityId);
  }

  private async scope(accountId: string, brandId: string, opportunityId: string) {
    const result = await this.pool.query<{ workspace_id: string }>(
      `select o.workspace_id from brand_opportunities o join workspace_memberships m on m.workspace_id=o.workspace_id
        where m.account_id=$1 and m.active=true and o.brand_id=$2 and o.id=$3`, [accountId, brandId, opportunityId],
    );
    const workspaceId = result.rows[0]?.workspace_id;
    if (!workspaceId) throw new ResourceNotFoundError("Opportunity not found");
    return { workspaceId };
  }
}

export class ConceptMockupAssetsUnavailableError extends Error {
  constructor() { super("Concept visual generation is unavailable because private object storage is not configured."); }
}

function renderSpecs(brand: string, title: string, mockup: ConceptMockupDto) {
  if (mockup.format === "carousel" && mockup.carousel) {
    const cards = [mockup.carousel.cover, ...mockup.carousel.slides, ...(mockup.carousel.closingSlide ? [mockup.carousel.closingSlide] : [])];
    return cards.map((card, position) => ({ kind: "carousel-slide" as const, position, width: 1080, height: 1350, svg: cardSvg(brand, card.headline, card.body ?? mockup.cta ?? title, position + 1, cards.length) }));
  }
  if (mockup.format === "reel" && mockup.reel) {
    return [{ kind: "reel-poster" as const, position: 0, width: 1080, height: 1920, svg: cardSvg(brand, mockup.reel.openingFrame, mockup.hook, 1, 1, 1920) }];
  }
  const headline = mockup.format === "image" ? mockup.image?.overlayText ?? mockup.image?.headline ?? mockup.hook : mockup.text?.hook ?? mockup.hook;
  const body = mockup.copyPreview ?? mockup.cta ?? title;
  return [{ kind: "post" as const, position: 0, width: 1080, height: 1350, svg: cardSvg(brand, headline, body, 1, 1) }];
}

function cardSvg(brand: string, headline: string, body: string, position: number, count: number, height = 1350) {
  const safeBrand = xml(brand.toUpperCase()), safeHeadline = wrap(headline, 28).map(xml), safeBody = wrap(body, 52).slice(0, 3).map(xml);
  const headlineY = height > 1500 ? 680 : 520;
  const headlineLines = safeHeadline.map((line, index) => `<text x="84" y="${headlineY + index * 78}" fill="#f7f7fb" font-family="Arial, sans-serif" font-size="66" font-weight="700">${line}</text>`).join("");
  const bodyY = headlineY + safeHeadline.length * 78 + 68;
  const bodyLines = safeBody.map((line, index) => `<text x="84" y="${bodyY + index * 42}" fill="#b9c2d0" font-family="Arial, sans-serif" font-size="32">${line}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}"><rect width="1080" height="${height}" fill="#0d1724"/><circle cx="930" cy="150" r="240" fill="#6d3df2" opacity=".24"/><circle cx="120" cy="${height - 100}" r="280" fill="#c8ed2f" opacity=".12"/><text x="84" y="100" fill="#c7a5ff" font-family="Arial, sans-serif" font-size="27" font-weight="700" letter-spacing="4">${safeBrand}</text><text x="84" y="150" fill="#a5b0c1" font-family="Arial, sans-serif" font-size="24">CONCEPT MOCKUP · ${position}/${count}</text>${headlineLines}${bodyLines}<rect x="84" y="${height - 146}" width="240" height="2" fill="#c8ed2f"/><text x="84" y="${height - 92}" fill="#c8ed2f" font-family="Arial, sans-serif" font-size="24" font-weight="700">KAIRO VISUAL</text></svg>`;
}
function wrap(value: string, width: number) { const words = value.replace(/\s+/g, " ").trim().split(" "); const lines: string[] = []; let current = ""; for (const word of words) { if (`${current} ${word}`.trim().length > width && current) { lines.push(current); current = word; } else current = `${current} ${word}`.trim(); } if (current) lines.push(current); return lines.slice(0, 4); }
function xml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!); }
function scopeKey(workspaceId: string, brandId: string) { return createHash("sha256").update(`${workspaceId}\u0000${brandId}`).digest("hex").slice(0, 24); }
function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function iso(value: Date | string) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
