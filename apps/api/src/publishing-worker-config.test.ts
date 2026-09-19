import { describe, expect, it } from "vitest";
import { publishingWorkerConfigFromEnv } from "./publishing-worker-config";

const key = Buffer.alloc(32, 7).toString("base64");
const base = {
  DATABASE_URL: "postgresql://example.invalid/kairo",
  META_GRAPH_VERSION: "v23.0",
  CHANNEL_CREDENTIAL_ENCRYPTION_KEY: key,
  OBJECT_STORAGE_PUBLIC_BASE_URL: "https://media.example.test/kairo/",
  OBJECT_STORAGE_SIGNING_SECRET: "x".repeat(32),
};

describe("publishing worker configuration", () => {
  it("uses bounded production-safe defaults", () => {
    expect(publishingWorkerConfigFromEnv(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      graphVersion: "v23.0",
      encryptionKey: key,
      pollMs: 5_000,
      leaseSeconds: 120,
      maxJobsPerTick: 5,
      objectStoragePublicBaseUrl: base.OBJECT_STORAGE_PUBLIC_BASE_URL,
      objectStorageSigningSecret: base.OBJECT_STORAGE_SIGNING_SECRET,
    });
  });

  it.each(["DATABASE_URL", "META_GRAPH_VERSION", "CHANNEL_CREDENTIAL_ENCRYPTION_KEY"] as const)("requires %s", (name) => {
    expect(() => publishingWorkerConfigFromEnv({ ...base, [name]: "" })).toThrow(`${name} is required`);
  });

  it("allows Reel publishing without Carousel object storage", () => {
    const { OBJECT_STORAGE_PUBLIC_BASE_URL: _, OBJECT_STORAGE_SIGNING_SECRET: __, ...withoutStorage } = base;
    expect(publishingWorkerConfigFromEnv(withoutStorage)).not.toHaveProperty("objectStoragePublicBaseUrl");
  });

  it.each(["OBJECT_STORAGE_PUBLIC_BASE_URL", "OBJECT_STORAGE_SIGNING_SECRET"] as const)("rejects incomplete object storage when %s is missing", (name) => {
    expect(() => publishingWorkerConfigFromEnv({ ...base, [name]: "" })).toThrow("Object storage publishing configuration is incomplete");
  });

  it("rejects an invalid Meta Graph version", () => {
    expect(() => publishingWorkerConfigFromEnv({ ...base, META_GRAPH_VERSION: "latest" })).toThrow("META_GRAPH_VERSION is invalid");
  });

  it("rejects a credential key that is not exactly 32 bytes", () => {
    expect(() => publishingWorkerConfigFromEnv({ ...base, CHANNEL_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow("CHANNEL_CREDENTIAL_ENCRYPTION_KEY must be base64 for exactly 32 bytes");
  });

  it("accepts bounded worker tuning", () => {
    expect(publishingWorkerConfigFromEnv({
      ...base,
      KAIRO_PUBLISHING_POLL_MS: "1500",
      KAIRO_PUBLISHING_LEASE_SECONDS: "180",
      KAIRO_PUBLISHING_MAX_JOBS_PER_TICK: "3",
    })).toMatchObject({ pollMs: 1500, leaseSeconds: 180, maxJobsPerTick: 3 });
  });

  it.each([
    ["KAIRO_PUBLISHING_POLL_MS", "999"],
    ["KAIRO_PUBLISHING_POLL_MS", "60001"],
    ["KAIRO_PUBLISHING_LEASE_SECONDS", "29"],
    ["KAIRO_PUBLISHING_LEASE_SECONDS", "601"],
    ["KAIRO_PUBLISHING_MAX_JOBS_PER_TICK", "0"],
    ["KAIRO_PUBLISHING_MAX_JOBS_PER_TICK", "21"],
    ["KAIRO_PUBLISHING_MAX_JOBS_PER_TICK", "1.5"],
  ])("rejects invalid %s=%s", (name, value) => {
    expect(() => publishingWorkerConfigFromEnv({ ...base, [name]: value })).toThrow(`${name} is invalid`);
  });
});
