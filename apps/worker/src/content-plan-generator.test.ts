import { describe, expect, it } from "vitest";
import type { AgentInvocationRequest, AgentRuntimePort } from "@kairo/agent-contracts";
import type { ProductionCarouselProjectDto, ProductionReelProjectDto } from "@kairo/contracts";
import { validateCarouselProject as validateDomainCarouselProject } from "@kairo/domain/carousel-project";
import { ContentPlanGenerator, validateCarouselProject, validateReelProject } from "./content-plan-generator";

const carousel: ProductionCarouselProjectDto = {
  schemaVersion: 1,
  format: "carousel",
  structure: "pas",
  coverHook: "A useful sequence",
  caption: "Evidence-backed context for the sequence.",
  cta: "Save this.",
  slides: [
    { id: "slide-problem", role: "problem", headline: "The overlooked problem", body: "A concise opening.", supportingClaimIds: ["claim-1"] },
    { id: "slide-agitation", role: "agitation", headline: "Why it matters", body: "The supported consequence.", supportingClaimIds: ["claim-1"] },
    { id: "slide-solution", role: "solution", headline: "What the evidence shows", body: "The supported explanation.", supportingClaimIds: ["claim-2"] },
    { id: "slide-cta", role: "cta", headline: "What to do next", body: "A practical close.", supportingClaimIds: ["claim-1", "claim-2"] },
  ],
  supportingClaimIds: ["claim-1", "claim-2"],
};

const reel: ProductionReelProjectDto = {
  schemaVersion: 1,
  contentType: "reel",
  title: "A short explanation",
  hook: "Start with the verified change",
  targetDurationSeconds: 12,
  caption: "The supporting context.",
  cta: "Follow for more.",
  scenes: [
    { id: "scene-hook", role: "hook", startSecond: 0, endSecond: 4, visual: "Direct opening", onScreenText: "What changed", voiceover: "Open with the verified change.", supportingClaimIds: ["claim-1"] },
    { id: "scene-solution", role: "solution", startSecond: 4, endSecond: 12, visual: "Simple explanation", onScreenText: "What it means", voiceover: "Explain its supported meaning.", supportingClaimIds: ["claim-2"] },
  ],
  supportingClaimIds: ["claim-1", "claim-2"],
};

function input(contentType: "carousel" | "reel") {
  return {
    workspaceId: "workspace-1", brandId: "brand-1", brandContextVersion: "brain-7",
    idea: { id: "idea-1", title: "Verified shift", premise: "Explain the evidence." },
    angle: { id: "angle-1", title: "Practical angle", framing: "Lead with evidence.", audience: "Founders", objective: "Educate", hookDirection: "Lead with the change", recommendedFormat: contentType },
    contentType, recommendationRationale: `${contentType} fits the selected Angle.`,
    claims: [
      { id: "claim-1", text: "First supported fact", classification: "factual", verificationState: "verified" },
      { id: "claim-2", text: "Second supported fact", classification: "factual", verificationState: "verified" },
    ],
  };
}

describe("ContentPlanGenerator", () => {
  it("preserves Idea and selected Angle lineage around a structured carousel project", async () => {
    let request: AgentInvocationRequest | undefined;
    const runtime: AgentRuntimePort = { invoke: async <TOutput>(value: AgentInvocationRequest) => { request = value; return { output: carousel as TOutput, metadata: { runtime: "test", latencyMs: 1 } }; } };
    const output = await new ContentPlanGenerator(runtime).generate(input("carousel"));
    expect(request?.outputSchema).toEqual({ name: "production-carousel-project", version: "1" });
    expect(output).toMatchObject({ schemaVersion: 1, contentType: "carousel", lineage: { ideaId: "idea-1", angleId: "angle-1", supportingClaimIds: ["claim-1", "claim-2"] }, project: { structure: "pas" } });
  });

  it("uses the separate structured Reel schema without changing the generic Drafter", async () => {
    const runtime: AgentRuntimePort = { invoke: async <TOutput>() => ({ output: reel as TOutput, metadata: { runtime: "test", latencyMs: 1 } }) };
    const output = await new ContentPlanGenerator(runtime).generate(input("reel"));
    expect(output.project).toMatchObject({ contentType: "reel", targetDurationSeconds: 12 });
  });

  it("rejects unknown Claim lineage and unstable or duplicate item IDs", () => {
    expect(() => validateCarouselProject({ ...carousel, slides: carousel.slides.map((slide, index) => index === 1 ? { ...slide, supportingClaimIds: ["unknown"] } : slide) }, new Set(["claim-1", "claim-2"]))).toThrow(/outside the approved lineage/);
    expect(() => validateCarouselProject({ ...carousel, slides: carousel.slides.map((slide) => ({ ...slide, id: "same" })) })).toThrow(/IDs must be unique/);
  });

  it("rejects invalid production progression and Reel timing", () => {
    expect(() => validateCarouselProject({ ...carousel, slides: carousel.slides.filter((slide) => slide.role !== "agitation") })).toThrow(/missing required narrative roles/);
    expect(() => validateReelProject({ ...reel, scenes: [reel.scenes[0], { ...reel.scenes[1]!, startSecond: 3 }] })).toThrow(/timing is invalid/);
  });

  it.each(["aida", "pas", "listicle", "case-study", "story", "comparison"] as const)("accepts the %s carousel structure", (structure) => {
    const roleSets = {
      aida: ["attention", "interest", "desire", "cta"], pas: ["problem", "agitation", "solution", "cta"], listicle: ["hook", "list-item", "cta"],
      "case-study": ["context", "challenge", "approach", "result", "cta"], story: ["hook", "story-beat", "cta"], comparison: ["comparison", "cta"],
    } as const;
    const slides = roleSets[structure].map((role, index) => ({ id: `slide-${index}`, role, headline: `Slide ${index}`, body: "Body", supportingClaimIds: ["claim-1"] }));
    expect(validateCarouselProject({ ...carousel, structure, slides }).structure).toBe(structure);
  });

  it("keeps the contract DTO, domain validator and worker validator on the same schema v1 shape", () => {
    const project: ProductionCarouselProjectDto = {
      ...carousel,
      slides: carousel.slides.map((slide, index) => index === 2 ? { ...slide, id: "slide:solution.3", imageAssetId: "asset/provider-image-3" } : slide),
    };
    expect(validateDomainCarouselProject(project)).toEqual(project);
    expect(validateCarouselProject(project)).toEqual(project);
  });

  it("accepts carousel captions above Instagram caption length but rejects schema-v1 captions above 5000", () => {
    const longValid = { ...carousel, caption: "x".repeat(2_201) };
    expect(validateDomainCarouselProject(longValid).caption).toHaveLength(2_201);
    expect(validateCarouselProject(longValid).caption).toHaveLength(2_201);
    expect(() => validateDomainCarouselProject({ ...carousel, caption: "x".repeat(5_001) })).toThrow(/caption is too long/);
    expect(() => validateCarouselProject({ ...carousel, caption: "x".repeat(5_001) })).toThrow(/caption is too long/);
  });

  it.each([
    ["content type", (value: ReturnType<typeof input>) => ({ ...value, contentType: "image" })],
    ["angle audience", (value: ReturnType<typeof input>) => ({ ...value, angle: { ...value.angle, audience: "" } })],
    ["angle objective", (value: ReturnType<typeof input>) => ({ ...value, angle: { ...value.angle, objective: "" } })],
    ["angle hook direction", (value: ReturnType<typeof input>) => ({ ...value, angle: { ...value.angle, hookDirection: "" } })],
    ["angle recommended format", (value: ReturnType<typeof input>) => ({ ...value, angle: { ...value.angle, recommendedFormat: "" } })],
    ["recommendation rationale", (value: ReturnType<typeof input>) => ({ ...value, recommendationRationale: "" })],
    ["Claim text", (value: ReturnType<typeof input>) => ({ ...value, claims: [{ ...value.claims[0]!, text: "" }] })],
    ["Claim classification", (value: ReturnType<typeof input>) => ({ ...value, claims: [{ ...value.claims[0]!, classification: "" }] })],
    ["Claim verification", (value: ReturnType<typeof input>) => ({ ...value, claims: [{ ...value.claims[0]!, verificationState: "" }] })],
    ["Claim count", (value: ReturnType<typeof input>) => ({ ...value, claims: Array.from({ length: 101 }, (_, index) => ({ id: `claim-${index}`, text: "Fact", classification: "factual", verificationState: "verified" })) })],
  ])("rejects invalid %s before invoking the runtime", async (_label, mutate) => {
    let invocations = 0;
    const runtime: AgentRuntimePort = { invoke: async <TOutput>() => { invocations += 1; return { output: carousel as TOutput, metadata: { runtime: "test", latencyMs: 1 } }; } };
    await expect(new ContentPlanGenerator(runtime).generate(mutate(input("carousel")) as never)).rejects.toThrow();
    expect(invocations).toBe(0);
  });

  it("passes only canonical validated fields to the runtime", async () => {
    let request: AgentInvocationRequest | undefined;
    const runtime: AgentRuntimePort = { invoke: async <TOutput>(value: AgentInvocationRequest) => { request = value; return { output: carousel as TOutput, metadata: { runtime: "test", latencyMs: 1 } }; } };
    const base = input("carousel");
    const enriched = {
      ...base,
      idea: { ...base.idea, title: `  ${base.idea.title}  `, hugeExtra: "x".repeat(100_000), nested: { access_token: "must-not-cross" } },
      angle: { ...base.angle, unknownStrategy: { prompt: "must-not-cross" } },
      claims: base.claims.map((claim) => ({ ...claim, rawProviderPayload: "x".repeat(100_000) })),
      unknownTopLevel: { private_key: "must-not-cross" },
    };
    await new ContentPlanGenerator(runtime).generate(enriched);
    expect(request?.task.context).toEqual({
      idea: { id: "idea-1", title: "Verified shift", premise: "Explain the evidence." },
      angle: { id: "angle-1", title: "Practical angle", framing: "Lead with evidence.", audience: "Founders", objective: "Educate", hookDirection: "Lead with the change", recommendedFormat: "carousel" },
      contentType: "carousel",
      claims: base.claims,
    });
    expect(JSON.stringify(request?.task.context)).not.toContain("must-not-cross");
  });
});
