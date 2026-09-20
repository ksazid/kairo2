import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("HI2-10M packages the approved migration range runner into the production image", () => {
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");
  const startApi = fs.readFileSync("scripts/start-api.mjs", "utf8");
  const runner = fs.readFileSync("scripts/migrate-range.mjs", "utf8");

  assert.match(
    dockerfile,
    /COPY --from=build \/app\/scripts\/migrate-range\.mjs \.\/scripts\/migrate-range\.mjs/,
  );
  assert.match(startApi, /0039_hunter_feedback_v2\.sql\.\.0043_hunter_eei_metrics\.sql/);
  assert.match(startApi, /\.\/migrate-range\.mjs/);
  assert.match(runner, /KAIRO_STARTUP_MIGRATION_RANGE/);
  assert.match(runner, /select checksum from kairo_schema_migrations/);
  assert.match(runner, /Applied migration changed/);
  assert.match(runner, /files\.slice\(startIndex, endIndex \+ 1\)/);
  assert.match(runner, /await client\.query\("begin"\)/);
  assert.match(runner, /await client\.query\("rollback"\)/);
  assert.match(runner, /KAIRO_MIGRATION_RANGE_COMPLETE/);
});
