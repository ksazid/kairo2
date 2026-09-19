import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import { validateBrandDnaForGeneration } from "./campaign-service";

const complete = [
  { fieldKey: "audience.primary", value: "Independent founders", state: "confirmed" },
  { fieldKey: "voice.tone", value: "Clear and practical", state: "confirmed" },
  { fieldKey: "content.pillars", value: "Education, proof and useful next steps", state: "confirmed" },
  { fieldKey: "content.preferred-topics", value: "Product strategy and customer insight", state: "confirmed" },
  { fieldKey: "content.visual-direction", value: "Editorial photography with warm neutrals", state: "confirmed" },
];

describe("end-to-end Brand DNA generation contract", () => {
  it.each(["post", "image", "carousel", "reel", "video"])("allows the %s format with a complete Brand DNA snapshot", (format) => {
    expect(() => validateBrandDnaForGeneration(complete, format)).not.toThrow();
  });

  it.each([
    "audience.primary",
    "voice.tone",
    "content.pillars",
    "content.preferred-topics",
  ])("blocks every format when %s is missing", (missing) => {
    const fields = complete.filter((field) => field.fieldKey !== missing);
    expect(() => validateBrandDnaForGeneration(fields, "post")).toThrow(new RegExp(missing.replace(".", "\\.")));
    expect(() => validateBrandDnaForGeneration(fields, "carousel")).toThrow(/Brand DNA is incomplete/);
  });

  it("requires visual direction for visual formats but not plain posts", () => {
    const fields = complete.filter((field) => field.fieldKey !== "content.visual-direction");
    expect(() => validateBrandDnaForGeneration(fields, "post")).not.toThrow();
    expect(() => validateBrandDnaForGeneration(fields, "carousel")).toThrow(/content\.visual-direction/);
    expect(() => validateBrandDnaForGeneration(fields, "reel")).toThrow(/content\.visual-direction/);
    expect(() => validateBrandDnaForGeneration(fields, "video")).toThrow(/content\.visual-direction/);
  });

  it("treats stale and blank fields as unavailable instead of silently generating", () => {
    const fields = complete.map((field) => field.fieldKey === "voice.tone" ? { ...field, state: "stale" } : field);
    expect(() => validateBrandDnaForGeneration(fields, "post")).toThrow(/voice\.tone/);
    expect(() => validateBrandDnaForGeneration(complete.map((field) => field.fieldKey === "voice.tone" ? { ...field, value: "  " } : field), "post")).toThrow(/voice\.tone/);
  });

  it("reports all missing DNA fields in one actionable error", () => {
    try {
      validateBrandDnaForGeneration([], "video");
      throw new Error("expected the Brand DNA gate to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect(String(error)).toMatch(/audience\.primary/);
      expect(String(error)).toMatch(/voice\.tone/);
      expect(String(error)).toMatch(/content\.pillars/);
      expect(String(error)).toMatch(/content\.preferred-topics/);
      expect(String(error)).toMatch(/content\.visual-direction/);
    }
  });
});
