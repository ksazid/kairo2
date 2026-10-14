import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const filename = process.env.KAIRO_STARTUP_MIGRATION?.trim();
if (!filename || !/^\d{4}_[a-z0-9_]+\.sql$/.test(filename)) {
  throw new Error("KAIRO_STARTUP_MIGRATION must name one exact migration file");
}

const directory = new URL("../apps/api/migrations/", import.meta.url);
const files = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name));
if (!files.includes(filename)) throw new Error(`Requested migration does not exist: ${filename}`);

const source = await readFile(new URL(filename, directory), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`create table if not exists kairo_schema_migrations(
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);

  const prior = await client.query(
    "select checksum from kairo_schema_migrations where filename=$1",
    [filename],
  );
  if (prior.rows[0]) {
    if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${filename}`);
    console.log(JSON.stringify({ event: "KAIRO_MIGRATION_SKIPPED", filename, reason: "already-applied" }));
  } else {
    const body = source.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
    await client.query("begin");
    try {
      await client.query(body);
      await client.query(
        "insert into kairo_schema_migrations(filename,checksum) values($1,$2)",
        [filename, checksum],
      );
      await client.query("commit");
      console.log(JSON.stringify({ event: "KAIRO_MIGRATION_APPLIED", filename, checksum }));
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}
