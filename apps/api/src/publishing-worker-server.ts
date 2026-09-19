import { Pool } from "pg";
import { ApprovedMediaPublishingWorker, DeterministicPublishingWorker, PublishingJobRunner } from "@kairo/worker/publishing";
import { FacebookPageAdapter, InstagramProfessionalAdapter } from "@kairo/worker/publishing-adapters";
import { PgEncryptedChannelCredentialVault } from "./instagram-connection-postgres";
import { PgPublishingExecutionStore } from "./publishing-execution-postgres-store";
import { publishingWorkerConfigFromEnv } from "./publishing-worker-config";
import { runPublishingTick } from "./publishing-worker-runtime";
import { PgApprovedMediaDelivery } from "./approved-media-delivery-postgres";
import { HmacObjectStorageTemporarySigner } from "./object-storage-temporary-signer";
import { S3TemporaryObjectSigner, s3PrivateObjectStorageConfigFromEnv } from "./private-object-storage";

const config = publishingWorkerConfigFromEnv(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const vault = new PgEncryptedChannelCredentialVault(pool, config.encryptionKey);
const store = new PgPublishingExecutionStore(pool, { channels: ["instagram", "facebook"] });
const providerPublishing = new DeterministicPublishingWorker([
  new InstagramProfessionalAdapter(vault, config.graphVersion),
  new InstagramProfessionalAdapter(vault, config.graphVersion, fetch, undefined, "instagram-login"),
  new FacebookPageAdapter(vault, config.graphVersion),
]);
const privateObjectStorage=s3PrivateObjectStorageConfigFromEnv(process.env);
const mediaSigner=privateObjectStorage?new S3TemporaryObjectSigner(privateObjectStorage):config.objectStoragePublicBaseUrl&&config.objectStorageSigningSecret?new HmacObjectStorageTemporarySigner(config.objectStoragePublicBaseUrl,config.objectStorageSigningSecret):undefined;
const mediaDelivery=mediaSigner?new PgApprovedMediaDelivery(pool,mediaSigner):undefined;
const publishing = new ApprovedMediaPublishingWorker(providerPublishing,mediaDelivery);
const leaseOwner = `instagram-publisher-${process.pid}`;
const runner = new PublishingJobRunner(store, publishing, leaseOwner, config.leaseSeconds);

let stopping = false;
let timer: NodeJS.Timeout | undefined;
let activeTick: Promise<void> | undefined;

safeInfo("KAIRO_INSTAGRAM_PUBLISHER_STARTED", {
  leaseOwner,
  graphVersion: config.graphVersion,
  pollMs: config.pollMs,
  leaseSeconds: config.leaseSeconds,
  maxJobsPerTick: config.maxJobsPerTick,
});

startTick();

function startTick(): void {
  if (stopping || activeTick) return;
  activeTick = tick().finally(() => {
    activeTick = undefined;
    if (!stopping) timer = setTimeout(startTick, config.pollMs);
  });
}

async function tick(): Promise<void> {
  try {
    const processed = await runPublishingTick(runner, config.maxJobsPerTick);
    if (processed > 0) safeInfo("KAIRO_INSTAGRAM_PUBLISHER_TICK", { processed });
  } catch (error) {
    safeError("KAIRO_INSTAGRAM_PUBLISHER_TICK_FAILED", error);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  safeInfo("KAIRO_INSTAGRAM_PUBLISHER_STOPPING", { signal });
  try {
    await activeTick;
    await pool.end();
    safeInfo("KAIRO_INSTAGRAM_PUBLISHER_STOPPED", {});
  } catch (error) {
    safeError("KAIRO_INSTAGRAM_PUBLISHER_SHUTDOWN_FAILED", error);
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

function safeInfo(event: string, fields: Record<string, string | number>): void {
  console.info(JSON.stringify({ event, ...fields }));
}

function safeError(event: string, error: unknown): void {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const message = error instanceof Error && error.message ? error.message.slice(0, 500) : "Unknown publishing worker error";
  console.error(JSON.stringify({ event, error: { name, message } }));
}
