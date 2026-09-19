import { describe, expect, it } from "vitest";
import { buildConceptMockup, isConceptMockup, normalizeConceptMockupFormat, type ConceptMockup } from "./concept-mockup";

const base = { version: 1 as const, hook: "A useful idea" };
const input = {
  title: "A useful idea",
  rationale: "It fits the Brand audience.",
  whyNow: "The topic is timely.",
  developmentDirection: "Explain the practical implications.",
  hook: "This changes how teams build",
  targetAudience: "Technical founders",
  objective: "Educate",
};

describe("ConceptMockup", () => {
  it("accepts text concepts", () => {
    const value: ConceptMockup = {
      ...base,
      format: "text",
      text: { hook: "A useful idea", keyPoints: ["Point one"] },
    };
    expect(isConceptMockup(value)).toBe(true);
  });

  it("accepts image concepts", () => {
    const value: ConceptMockup = {
      ...base,
      format: "image",
      image: { headline: "A useful idea", visualSubject: "A clear product scene" },
    };
    expect(isConceptMockup(value)).toBe(true);
  });

  it("accepts carousel concepts", () => {
    const value: ConceptMockup = {
      ...base,
      format: "carousel",
      carousel: {
        cover: { headline: "A useful idea" },
        slides: [{ headline: "Supporting point" }],
        cardCount: 4,
      },
    };
    expect(isConceptMockup(value)).toBe(true);
  });

  it("accepts reel concepts", () => {
    const value: ConceptMockup = {
      ...base,
      format: "reel",
      reel: {
        hook: "A useful idea",
        durationSeconds: 20,
        openingFrame: "Opening frame",
        scenes: [{ startSeconds: 0, endSeconds: 3, beat: "Hook" }],
      },
    };
    expect(isConceptMockup(value)).toBe(true);
  });

  it("projects all supported rough formats without media generation", () => {
    const text = buildConceptMockup({ ...input, recommendedFormat: "text post" });
    const image = buildConceptMockup({ ...input, recommendedFormat: "image" });
    const carousel = buildConceptMockup({ ...input, recommendedFormat: "carousel" });
    const reel = buildConceptMockup({ ...input, recommendedFormat: "short video" });

    expect(text.format).toBe("text");
    expect(text.text?.keyPoints).toHaveLength(2);
    expect(image.format).toBe("image");
    expect(image.image?.visualSubject).toBeTruthy();
    expect(carousel.format).toBe("carousel");
    expect(carousel.carousel?.slides).toHaveLength(2);
    expect(reel.format).toBe("reel");
    expect(reel.reel?.scenes).toHaveLength(4);
  });

  it("normalizes common Hunter format names", () => {
    expect(normalizeConceptMockupFormat("Instagram carousel")).toBe("carousel");
    expect(normalizeConceptMockupFormat("Reel / short video")).toBe("reel");
    expect(normalizeConceptMockupFormat("single image post")).toBe("image");
    expect(normalizeConceptMockupFormat("LinkedIn thought leadership")).toBe("text");
  });

  it("rejects a malformed format-specific payload", () => {
    expect(isConceptMockup({ ...base, format: "reel", reel: { hook: "x" } })).toBe(false);
  });
});
