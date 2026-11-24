import { describe, expect, it } from "vitest";
import type { BrandBrainFieldDto } from "@kairo/contracts";
import { BRAND_SECTOR_FIELD_KEY, resolveBrandSectorClassification } from "./brand-sector";
import { projectBrandIntelligenceProfile } from "./source-policy";
import { selectSectorIntelligencePack } from "./sector-packs";
import { evaluateBrandDnaReadiness } from "./brand-dna-readiness";

function field(fieldKey: string, value: string, state: BrandBrainFieldDto["state"] = "inferred", sourceIds = ["source-1"]): BrandBrainFieldDto {
  return { id: fieldKey, workspaceId: "w", brandId: "b", fieldKey, section: fieldKey.startsWith("content.") ? "content-strategy" : "identity", value, state, sourceIds, version: 1, updatedAt: "2026-11-24T00:00:00Z" };
}
const duke = () => [
  field("identity.category", "Business or organization website"),
  field("identity.products-services", "Bike and bike products"),
  field("content.pillars", "KTM Duke 390 motorcycle maintenance and responsible riding"),
];

describe("canonical Brand sector", () => {
  it("suggests motorcycles from Duke content despite a generic website category, without inventing confirmation", () => {
    expect(resolveBrandSectorClassification(duke())).toMatchObject({ status: "needs-confirmation", candidatePackIds: ["motorcycles"], evidenceFieldKeys: ["content.pillars"], sourceIds: ["source-1"] });
    expect(projectBrandIntelligenceProfile(duke()).sectorPackId).toBeUndefined();
    expect(evaluateBrandDnaReadiness(duke()).gaps).toContain("sector");
  });

  it("routes both planning and quality from the sourced stored ID despite the generic category", () => {
    const fields = [...duke(), field(BRAND_SECTOR_FIELD_KEY, "motorcycles")];
    expect(resolveBrandSectorClassification(fields)).toMatchObject({ status: "ready", sectorPackId: "motorcycles" });
    const profile = projectBrandIntelligenceProfile(fields);
    expect(profile).toMatchObject({ sector: "Business or organization website", sectorPackId: "motorcycles" });
    expect(selectSectorIntelligencePack(profile).id).toBe("motorcycles");
  });

  it.each([
    ["AI developer tools", "ai-technology"], ["Umrah guidance", "umrah-religious-travel"],
    ["Duke 390 maintenance", "motorcycles"], ["UPSC preparation", "ias-upsc-education"],
    ["Restaurant seasonal menus", "hospitality"],
  ])("preserves the supported %s sector", (text, id) => {
    expect(resolveBrandSectorClassification([field("identity.category", text), field(BRAND_SECTOR_FIELD_KEY, id)])).toMatchObject({ status: "ready", sectorPackId: id });
  });

  it("blocks conflicting inputs even if an owner previously confirmed a sector", () => {
    const fields = [...duke(), field("identity.sector", "AI developer technology", "confirmed", []), field(BRAND_SECTOR_FIELD_KEY, "motorcycles", "confirmed", [])];
    expect(resolveBrandSectorClassification(fields).status).toBe("conflicting");
    expect(evaluateBrandDnaReadiness(fields).gaps).toContain("sector");
    expect(projectBrandIntelligenceProfile(fields).sectorPackId).toBeUndefined();
  });

  it("does not let General bypass specialist evidence", () => {
    expect(resolveBrandSectorClassification([...duke(), field(BRAND_SECTOR_FIELD_KEY, "generic", "confirmed", [])]).status).toBe("conflicting");
  });

  it("requires explicit General selection for an unsupported sector", () => {
    const fields = [field("identity.category", "Grocery delivery")];
    expect(resolveBrandSectorClassification(fields).status).toBe("missing");
    expect(resolveBrandSectorClassification([...fields, field(BRAND_SECTOR_FIELD_KEY, "generic", "confirmed", [])])).toMatchObject({ status: "ready", sectorPackId: "generic" });
  });

  it("does not infer motorcycles from the ambiguous word bike", () => {
    const fields = [field("identity.products-services", "Bike products")];
    expect(resolveBrandSectorClassification(fields).candidatePackIds).toEqual([]);
    expect(resolveBrandSectorClassification([...fields, field(BRAND_SECTOR_FIELD_KEY, "generic", "confirmed", [])]).status).toBe("needs-confirmation");
    expect(resolveBrandSectorClassification([...fields, field(BRAND_SECTOR_FIELD_KEY, "motorcycles", "confirmed", [])]).status).toBe("ready");
    expect(resolveBrandSectorClassification([...fields, field("identity.category", "Bicycle and cycling accessories"), field(BRAND_SECTOR_FIELD_KEY, "generic", "confirmed", [])]).status).toBe("ready");
  });

  it.each(["unsupported", "__proto__", "constructor", "Motorcycles"])("rejects invalid stored ID %s", (id) => {
    expect(resolveBrandSectorClassification([...duke(), field(BRAND_SECTOR_FIELD_KEY, id, "confirmed", [])]).status).not.toBe("ready");
  });

  it("ignores stale and AI-only classification signals", () => {
    expect(resolveBrandSectorClassification([field("content.pillars", "Duke 390", "stale"), field("identity.category", "AI", "inferred", [])]).candidatePackIds).toEqual([]);
    expect(resolveBrandSectorClassification([...duke(), field(BRAND_SECTOR_FIELD_KEY, "motorcycles", "stale")]).status).toBe("needs-confirmation");
  });

  it("does not trust inferred IDs with unrelated or disabled provenance", () => {
    expect(resolveBrandSectorClassification([...duke(), field(BRAND_SECTOR_FIELD_KEY, "motorcycles", "inferred", ["other-source"])]).status).not.toBe("ready");
    expect(resolveBrandSectorClassification([...duke(), field(BRAND_SECTOR_FIELD_KEY, "motorcycles")], []).status).not.toBe("ready");
  });

  it("rechecks inferred classification when its supporting fields change", () => {
    const fields = [...duke(), field(BRAND_SECTOR_FIELD_KEY, "motorcycles"), { ...field("content.pillars", "Restaurant menus"), version: 2 }];
    expect(resolveBrandSectorClassification(fields).status).toBe("conflicting");
  });
});
