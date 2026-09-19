import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import {
  KairoService,
  ResourceNotFoundError,
  type KairoRepository,
} from "@kairo/domain";
import type { IdentityVerifier } from "./auth";
export class PgInstagramInsightsStatusStore {
  constructor(
    private pool: Pool,
    private now: () => Date = () => new Date(),
  ) {}
  async list(accountId: string, brandId: string) {
    const client = await this.pool.connect();
    try {
      const workspaceId = await scope(client, accountId, brandId),
        rows = (
          await client.query(
            `select j.id,j.published_post_id,j.collection_window,j.scheduled_for,j.status,j.attempt,j.next_attempt_at,j.failure_code,j.unavailable_reason,j.completed_at from metric_collection_jobs j where j.workspace_id=$1 and j.brand_id=$2 and j.provider='instagram' order by j.scheduled_for desc,j.id`,
            [workspaceId, brandId],
          )
        ).rows,
        now = this.now().getTime();
      return rows.map((row) => {
        const scheduled = Date.parse(iso(row.scheduled_for)),
          completed = row.completed_at
            ? Date.parse(iso(row.completed_at))
            : undefined,
          permission =
            row.unavailable_reason === "permission-required"
              ? "required"
              : row.status === "complete"
                ? "granted"
                : "unknown",
          freshness =
            row.status === "unavailable"
              ? "unavailable"
              : completed !== undefined
                ? completed - scheduled > 900_000
                  ? "delayed"
                  : "fresh"
                : now < scheduled
                  ? "not-due"
                  : now - scheduled > 900_000
                    ? "delayed"
                    : "due";
        return {
          id: row.id,
          publishedPostId: row.published_post_id,
          window: row.collection_window,
          scheduledFor: iso(row.scheduled_for),
          status: row.status,
          attempt: Number(row.attempt),
          permission,
          freshness,
          ...(row.next_attempt_at
            ? { nextAttemptAt: iso(row.next_attempt_at) }
            : {}),
          ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
          ...(row.failure_code ? { failureCode: row.failure_code } : {}),
          ...(row.unavailable_reason
            ? { unavailableReason: row.unavailable_reason }
            : {}),
        };
      });
    } finally {
      client.release();
    }
  }
}
export function registerInstagramInsightsRoutes(
  app: FastifyInstance,
  deps: {
    coreStore: KairoRepository;
    identityVerifier: IdentityVerifier;
    store: PgInstagramInsightsStatusStore;
  },
) {
  const core = new KairoService(deps.coreStore);
  app.get<{ Params: { brandId: string } }>(
    "/api/v1/brands/:brandId/performance/instagram-insights",
    async (request, reply) => {
      const account = await auth(request, reply, core, deps.identityVerifier);
      if (!account) return;
      return deps.store.list(account.id, request.params.brandId);
    },
  );
}
async function auth(
  request: FastifyRequest,
  reply: FastifyReply,
  core: KairoService,
  verifier: IdentityVerifier,
) {
  const identity = await verifier.verify(request.headers.authorization);
  if (!identity) {
    await reply
      .status(401)
      .send({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Authentication is required",
        code: "unauthorized",
        correlationId: request.id,
      });
    return null;
  }
  return core.establishSession(identity);
}
async function scope(client: PoolClient, accountId: string, brandId: string) {
  const row = (
    await client.query(
      `select b.workspace_id from brands b join workspace_memberships m on m.workspace_id=b.workspace_id where m.account_id=$1 and m.active=true and b.id=$2`,
      [accountId, brandId],
    )
  ).rows[0];
  if (!row) throw new ResourceNotFoundError("Brand not found");
  return String(row.workspace_id);
}
function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
