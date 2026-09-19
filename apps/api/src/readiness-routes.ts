import type { FastifyInstance, FastifyReply } from "fastify";

export interface ReadinessRouteOptions {
  releaseSha: string;
  check: () => Promise<void>;
}

export function registerReadinessRoutes(app: FastifyInstance, options: ReadinessRouteOptions): void {
  if (!/^[0-9a-f]{40}$/i.test(options.releaseSha)) throw new Error("KAIRO_RELEASE_SHA must be a 40-character Git SHA");

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => ready(reply, options.check));
  app.get("/version", async () => ({ releaseSha: options.releaseSha }));
}

async function ready(reply: FastifyReply, check: () => Promise<void>) {
  try {
    await check();
    return { status: "ready" };
  } catch {
    return reply.status(503).send({ status: "not-ready" });
  }
}
