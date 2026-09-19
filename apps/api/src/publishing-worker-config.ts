export interface PublishingWorkerConfig {
  databaseUrl: string;
  graphVersion: string;
  encryptionKey: string;
  pollMs: number;
  leaseSeconds: number;
  maxJobsPerTick: number;
  objectStoragePublicBaseUrl?: string;
  objectStorageSigningSecret?: string;
}

export function publishingWorkerConfigFromEnv(env: Record<string, string | undefined>): PublishingWorkerConfig {
  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");
  const graphVersion = required(env.META_GRAPH_VERSION, "META_GRAPH_VERSION");
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error("META_GRAPH_VERSION is invalid");
  const encryptionKey = required(env.CHANNEL_CREDENTIAL_ENCRYPTION_KEY, "CHANNEL_CREDENTIAL_ENCRYPTION_KEY");
  let decoded: Buffer;
  try { decoded = Buffer.from(encryptionKey, "base64"); } catch { throw new Error("CHANNEL_CREDENTIAL_ENCRYPTION_KEY must be base64 for exactly 32 bytes"); }
  if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/u, "") !== encryptionKey.replace(/=+$/u, "")) {
    throw new Error("CHANNEL_CREDENTIAL_ENCRYPTION_KEY must be base64 for exactly 32 bytes");
  }
  const objectStoragePublicBaseUrl = env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim();
  const objectStorageSigningSecret = env.OBJECT_STORAGE_SIGNING_SECRET?.trim();
  if (Boolean(objectStoragePublicBaseUrl) !== Boolean(objectStorageSigningSecret)) throw new Error("Object storage publishing configuration is incomplete");
  return {
    databaseUrl,
    graphVersion,
    encryptionKey,
    pollMs: boundedInt(env.KAIRO_PUBLISHING_POLL_MS, "KAIRO_PUBLISHING_POLL_MS", 5_000, 1_000, 60_000),
    leaseSeconds: boundedInt(env.KAIRO_PUBLISHING_LEASE_SECONDS, "KAIRO_PUBLISHING_LEASE_SECONDS", 120, 30, 600),
    maxJobsPerTick: boundedInt(env.KAIRO_PUBLISHING_MAX_JOBS_PER_TICK, "KAIRO_PUBLISHING_MAX_JOBS_PER_TICK", 5, 1, 20),
    ...(objectStoragePublicBaseUrl && objectStorageSigningSecret ? { objectStoragePublicBaseUrl, objectStorageSigningSecret } : {}),
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function boundedInt(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || !value.trim()) return fallback;
  if (!/^\d+$/u.test(value.trim())) throw new Error(`${name} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is invalid`);
  return parsed;
}
