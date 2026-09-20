import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const requestedRange = process.env.KAIRO_STARTUP_MIGRATION_RANGE?.trim();
if (!requestedRange) throw new Error("KAIRO_STARTUP_MIGRATION_RANGE is required");

const match = /^(\d{4}_.+\.sql)\.\.(\d{4}_.+\.sql)$/.exec(requestedRange);
if (!match) {
  throw new Error("KAIRO_STARTUP_MIGRATION_RANGE must use <start.sql>..<end.sql>");
}
const [, startFile, endFile] = match;

const directory = new URL("../apps/api/migrations/", import.meta.url);
const files = (await readdir(directory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

const startIndex = files.indexOf(startFile);
const endIndex = files.indexOf(endFile);
if (startIndex < 0 || endIndex < 0) {
  throw new Error("Requested migration range endpoint does not exist");
}
if (startIndex > endIndex) {
  throw new Error("Requested migration range is reversed");
}
const selected = files.slice(startIndex, endIndex + 1);
if (!selected.length) throw new Error("Requested migration range is empty");

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`create table if not exists kairo_schema_migrations(
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);

  for (const filename of selected) {
    const source = await readFile(new URL(filename, directory), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const prior = await client.query(
      "select checksum from kairo_schema_migrations where filename=$1",
      [filename],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration changed: ${filename}`);
      }
      console.log(JSON.stringify({
        event: "KAIRO_MIGRATION_RANGE_SKIPPED",
        filename,
        reason: "already-applied",
      }));
      continue;
    }

    const body = source
      .replace(/^\s*begin;\s*/i, "")
      .replace(/\s*commit;\s*$/i, "");

    await client.query("begin");
    try {
      await client.query(body);
      await client.query(
        "insert into kairo_schema_migrations(filename,checksum) values($1,$2)",
        [filename, checksum],
      );
      await client.query("commit");
      console.log(JSON.stringify({
        event: "KAIRO_MIGRATION_RANGE_APPLIED",
        filename,
        checksum,
      }));
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  console.log(JSON.stringify({
    event: "KAIRO_MIGRATION_RANGE_COMPLETE",
    requestedRange,
    migrationCount: selected.length,
    startFile,
    endFile,
  }));
} finally {
  await client.end();
}
