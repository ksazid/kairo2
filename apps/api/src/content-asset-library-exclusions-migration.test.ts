import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../migrations/0046_quarantine_known_cross_brand_media.sql", import.meta.url), "utf8");
const store = readFileSync(new URL("./content-asset-library-postgres-store.ts", import.meta.url), "utf8");

describe("cross-brand media quarantine", () => {
  it("persists the specific confirmed bad image against its stable provider ID", () => {
    expect(migration).toContain("CREATE TABLE content_library_asset_exclusions");
    expect(migration).toContain("f00f0ec6-53bb-40da-ac20-f4c2ecb381d7");
    expect(migration).toContain("lower(a.name) = lower('IMG_8797.png')");
    expect(migration).toContain("ON CONFLICT (workspace_id, brand_id, library_id, external_id) DO NOTHING");
  });

  it("excludes quarantined assets from both listing and attachment lookup", () => {
    expect(store.match(/not exists \(\s*select 1 from content_library_asset_exclusions/g)).toHaveLength(2);
  });
});
