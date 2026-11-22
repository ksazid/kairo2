import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { KairoService, type KairoRepository } from "@kairo/domain";
import type { IdentityVerifier } from "./auth";

type Params = { brandId: string; campaignId: string; assetId: string };
type Body = { publishedUrl?: string; channelAccountId?: string; expectedVersion?: number };
const path = "/api/v1/brands/:brandId/campaigns/:campaignId/assets/:assetId/external-instagram-post";

export function registerExternalInstagramPostRoutes(app: FastifyInstance, deps: { pool: Pool; coreStore: KairoRepository; identityVerifier: IdentityVerifier }) {
  const core = new KairoService(deps.coreStore);
  async function account(request: FastifyRequest, reply: FastifyReply) {
    const identity = await deps.identityVerifier.verify(request.headers.authorization);
    if (!identity) { reply.status(401).send({ error: "Authentication is required" }); return null; }
    return core.establishSession(identity);
  }
  app.get<{ Params: Params }>(path, async (request, reply) => {
    const user = await account(request, reply); if (!user) return;
    const row = await deps.pool.query(`select l.published_url,l.shortcode,l.version_id,l.linked_at from external_instagram_post_links l join workspace_memberships m on m.workspace_id=l.workspace_id and m.account_id=$1 and m.active=true where l.brand_id=$2 and l.campaign_id=$3 and l.asset_id=$4`, [user.id, request.params.brandId, request.params.campaignId, request.params.assetId]);
    return { link: row.rows[0] ?? null };
  });
  app.post<{ Params: Params; Body: Body }>(path, async (request, reply) => {
    const user = await account(request, reply); if (!user) return;
    const { brandId, campaignId, assetId } = request.params;
    const input = request.body ?? {};
    const match = typeof input.publishedUrl === "string" && /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?reel\/([A-Za-z0-9_-]+)\/?$/.exec(input.publishedUrl.trim());
    if (!match || !Number.isInteger(input.expectedVersion) || !input.channelAccountId) return reply.status(400).send({ error: "An Instagram Reel URL, connected destination and current version are required." });
    const client = await deps.pool.connect();
    try {
      await client.query("begin");
      const found = await client.query(`select a.workspace_id,a.current_version,v.id as version_id from content_assets a join workspace_memberships m on m.workspace_id=a.workspace_id and m.account_id=$1 and m.active=true join content_versions v on v.asset_id=a.id and v.version=a.current_version join channel_accounts c on c.workspace_id=a.workspace_id and c.brand_id=a.brand_id and c.id=$5 and c.channel='instagram' and c.status='connected' where a.brand_id=$2 and a.campaign_id=$3 and a.id=$4 and a.channel='instagram' and lower(a.format)='reel' for update of a`, [user.id, brandId, campaignId, assetId, input.channelAccountId]);
      const item = found.rows[0];
      if (!item) return reply.status(404).send({ error: "Connected Instagram Reel draft not found." });
      if (item.current_version !== input.expectedVersion) return reply.status(409).send({ error: "Content Version is stale." });
      const existingPublish = await client.query(`select 1 from published_posts where brand_id=$1 and asset_id=$2 limit 1`, [brandId, assetId]);
      if (existingPublish.rows.length) return reply.status(409).send({ error: "This draft already has a Kairo published result." });
      const pendingPublish = await client.query(`select 1 from publish_commands where brand_id=$1 and asset_id=$2 and status in ('scheduled','dispatching','unknown','manual-required') limit 1`, [brandId, assetId]);
      if (pendingPublish.rows.length) return reply.status(409).send({ error: "Cancel or resolve the existing Kairo publishing command before linking this Reel." });
      const canonical = `https://www.instagram.com/reel/${match[1]}/`;
      await client.query(`insert into external_instagram_post_links(asset_id,workspace_id,brand_id,campaign_id,version_id,channel_account_id,shortcode,published_url,linked_by_account_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(asset_id) do nothing`, [assetId, item.workspace_id, brandId, campaignId, item.version_id, input.channelAccountId, match[1], canonical, user.id]);
      const link = (await client.query(`select published_url,shortcode,version_id,linked_at from external_instagram_post_links where asset_id=$1`, [assetId])).rows[0];
      if (link?.published_url !== canonical || link?.version_id !== item.version_id) return reply.status(409).send({ error: "This draft is linked to a different Instagram post or version." });
      await client.query("commit");
      return { link, metricsStatus: "unavailable", source: "manually-linked" };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.status(409).send({ error: "This Instagram post is already linked to another draft." });
      throw error;
    } finally { await client.query("rollback").catch(() => undefined); client.release(); }
  });
}
