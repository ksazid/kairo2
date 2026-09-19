import { describe, expect, it } from "vitest";
import { compileCarouselProject, validateCarouselProject, type CarouselProject, type CarouselSlideRole, type CarouselStructure } from "./carousel-project";

function project(structure: CarouselStructure, roles: CarouselSlideRole[]): CarouselProject {
  return {
    schemaVersion: 1, format: "carousel", structure, coverHook: "A useful promise",
    slides: roles.map((role, index) => ({ id: `slide-${index + 1}`, role, headline: `${role} headline`, body: `${role} body`, supportingClaimIds: ["claim-1"] })),
    caption: "Useful caption", cta: "Take the next step", supportingClaimIds: ["claim-1"],
  };
}

describe("CarouselProject", () => {
  const structures: Array<[CarouselStructure, CarouselSlideRole[]]> = [
    ["aida", ["attention", "interest", "desire", "cta"]],
    ["pas", ["problem", "agitation", "solution", "cta"]],
    ["listicle", ["hook", "list-item", "cta"]],
    ["case-study", ["context", "challenge", "approach", "result", "cta"]],
    ["story", ["hook", "story-beat", "cta"]],
    ["comparison", ["hook", "comparison", "cta"]],
  ];

  it.each(structures)("validates the %s narrative structure", (structure, roles) => {
    expect(validateCarouselProject(project(structure, roles)).slides.map((slide) => slide.role)).toEqual(roles);
  });

  it("compiles without leaking editor-only identity into CarouselPlan", () => {
    const input = project("listicle", ["hook", "list-item", "cta"]);
    input.slides[1]!.imageAssetId = "image-2";
    const plan = compileCarouselProject(input);
    expect(plan.format).toBe("carousel");
    expect(plan.coverHook).toBe(input.coverHook);
    expect(plan.slides[0]?.headline).toBe("hook headline");
    expect(plan.slides[1]).not.toHaveProperty("id");
    expect(plan.slides[1]).not.toHaveProperty("role");
    expect(plan.slides[1]).not.toHaveProperty("imageAssetId");
  });

  it("supports Instagram's two-slide minimum where the narrative remains complete", () => {
    expect(compileCarouselProject(project("comparison", ["comparison", "cta"])).slides).toHaveLength(2);
  });

  it("rejects fewer than 2 or more than 10 Instagram slides", () => {
    const tooFew = project("comparison", ["comparison", "cta"]); tooFew.slides.pop();
    const tooMany = project("listicle", ["hook", ...Array(9).fill("list-item"), "cta"]);
    expect(() => validateCarouselProject(tooFew)).toThrow(/between 2 and 10/i);
    expect(() => validateCarouselProject(tooMany)).toThrow(/between 2 and 10/i);
  });

  it("rejects duplicate stable IDs, invalid Claim lineage and misplaced CTA", () => {
    const duplicate = project("listicle", ["hook", "list-item", "cta"]); duplicate.slides[1]!.id = duplicate.slides[0]!.id;
    const lineage = project("listicle", ["hook", "list-item", "cta"]); lineage.slides[1]!.supportingClaimIds = ["claim-2"];
    const cta = project("listicle", ["hook", "cta", "list-item"]);
    expect(() => validateCarouselProject(duplicate)).toThrow(/IDs must be unique/i);
    expect(() => validateCarouselProject(lineage)).toThrow(/outside the project lineage/i);
    expect(() => validateCarouselProject(cta)).toThrow(/CTA must be the final slide/i);
  });

  it("enforces the shared stable slide ID pattern and 200-character maximum", () => {
    const valid = project("comparison", ["comparison", "cta"]);
    valid.slides[0]!.id = `a${"b".repeat(197)}:z`;
    expect(validateCarouselProject(valid).slides[0]?.id).toHaveLength(200);
    const invalidCharacter = project("comparison", ["comparison", "cta"]); invalidCharacter.slides[0]!.id = "slide/bad";
    const tooLong = project("comparison", ["comparison", "cta"]); tooLong.slides[0]!.id = `a${"b".repeat(200)}`;
    expect(() => validateCarouselProject(invalidCharacter)).toThrow(/id is invalid/i);
    expect(() => validateCarouselProject(tooLong)).toThrow(/id is too long/i);
  });

  it("rejects incomplete semantic structures", () => {
    expect(() => validateCarouselProject(project("pas", ["problem", "solution", "cta"]))).toThrow(/agitation/i);
    expect(() => validateCarouselProject(project("case-study", ["context", "challenge", "result", "cta"]))).toThrow(/approach/i);
  });
});
