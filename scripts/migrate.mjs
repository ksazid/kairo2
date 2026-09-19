import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const directory = new URL("../apps/api/migrations/", import.meta.url);
const files = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
if (!files.length) throw new Error("No migrations found");

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`create table if not exists kairo_schema_migrations(
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);

  for (const filename of files) {
    const source = await readFile(new URL(filename, directory), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const prior = await client.query("select checksum from kairo_schema_migrations where filename=$1", [filename]);
    if (prior.rows[0]) {
      if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${filename}`);
      continue;
    }

    const body = source.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
    await client.query("begin");
    try {
      await client.query(body);
      await client.query("insert into kairo_schema_migrations(filename,checksum) values($1,$2)", [filename, checksum]);
      await client.query("commit");
      console.log(`applied ${filename}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}
