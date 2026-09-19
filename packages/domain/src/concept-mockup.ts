import type {
  CarouselConceptMockupDto,
  CarouselConceptSlideDto,
  ConceptMockupDto,
  ConceptMockupFormatDto,
  ImageConceptMockupDto,
  ReelConceptMockupDto,
  ReelConceptSceneDto,
  TextConceptMockupDto,
} from "@kairo/contracts/concept-mockup";

export type ConceptMockupFormat = ConceptMockupFormatDto;
export type TextConceptMockup = TextConceptMockupDto;
export type ImageConceptMockup = ImageConceptMockupDto;
export type CarouselConceptSlide = CarouselConceptSlideDto;
export type CarouselConceptMockup = CarouselConceptMockupDto;
export type ReelConceptScene = ReelConceptSceneDto;
export type ReelConceptMockup = ReelConceptMockupDto;
export type ConceptMockup = ConceptMockupDto;

export interface ConceptMockupInput {
  title: string;
  rationale: string;
  whyNow: string;
  developmentDirection: string;
  hook?: string;
  proposedAngle?: string;
  targetAudience?: string;
  objective?: string;
  recommendedFormat?: string;
}

export function buildConceptMockup(input: ConceptMockupInput): ConceptMockup {
  const hook = clean(input.hook) ?? required(input.title, "title");
  const title = required(input.title, "title");
  const rationale = required(input.rationale, "rationale");
  const whyNow = required(input.whyNow, "whyNow");
  const direction = required(input.developmentDirection, "developmentDirection");
  const angle = clean(input.proposedAngle) ?? direction;
  const audience = clean(input.targetAudience);
  const objective = clean(input.objective);
  const format = normalizeConceptMockupFormat(input.recommendedFormat);
  const cta = objective
    ? `Invite the audience to ${objective.toLowerCase()}.`
    : "Invite the audience to respond or take the next relevant step.";

  if (format === "image") {
    return {
      version: 1,
      format,
      hook,
      copyPreview: rationale,
      visualDirection: angle,
      cta,
      image: {
        headline: title,
        ...(hook !== title ? { overlayText: hook } : {}),
        ...(audience ? { subheadline: `For ${audience}` } : {}),
        visualSubject: angle,
        composition: "One clear focal subject with generous negative space for the headline.",
        visualStyle: "Brand-led editorial social graphic using existing Brand Brain styling and owned assets when available.",
        cta,
      },
    };
  }

  if (format === "carousel") {
    return {
      version: 1,
      format,
      hook,
      copyPreview: rationale,
      visualDirection: angle,
      cta,
      carousel: {
        cover: { headline: hook, body: title, visualDirection: angle },
        slides: [
          { headline: "Why this matters now", body: whyNow },
          { headline: "The useful angle", body: direction },
        ],
        closingSlide: { headline: "What to do next", body: cta },
        cardCount: 4,
        visualStyle: "Consistent Brand-led editorial cards with one idea per slide.",
      },
    };
  }

  if (format === "reel") {
    return {
      version: 1,
      format,
      hook,
      copyPreview: rationale,
      visualDirection: angle,
      cta,
      reel: {
        hook,
        durationSeconds: 20,
        openingFrame: hook,
        scenes: [
          { startSeconds: 0, endSeconds: 3, beat: "Hook", visualDirection: angle, onScreenText: hook },
          { startSeconds: 3, endSeconds: 8, beat: "Why now", visualDirection: whyNow, onScreenText: shorten(whyNow, 90) },
          { startSeconds: 8, endSeconds: 15, beat: "Useful insight", visualDirection: direction, onScreenText: shorten(direction, 90) },
          { startSeconds: 15, endSeconds: 20, beat: "CTA", visualDirection: "Return to the Brand-led closing frame.", onScreenText: shorten(cta, 90) },
        ],
        voiceoverDirection: `Explain ${title.toLowerCase()} in a direct, evidence-led way${audience ? ` for ${audience}` : ""}.`,
        endingCta: cta,
      },
    };
  }

  return {
    version: 1,
    format: "text",
    hook,
    copyPreview: rationale,
    visualDirection: angle,
    cta,
    text: {
      hook,
      opening: whyNow,
      keyPoints: [rationale, direction],
      captionDirection: "Lead with the hook, explain why it matters now, then develop the angle without overstating the evidence.",
      cta,
      tone: "Use the Brand Brain voice; concise, specific and evidence-led.",
    },
  };
}

export function normalizeConceptMockupFormat(value: string | undefined): ConceptMockupFormat {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (/carousel|slides|swipe/.test(normalized)) return "carousel";
  if (/reel|video|short|tiktok/.test(normalized)) return "reel";
  if (/image|photo|graphic|visual|poster/.test(normalized)) return "image";
  return "text";
}

export function isConceptMockup(value: unknown): value is ConceptMockup {
  if (!value || typeof value !== "object") return false;
  const mockup = value as Partial<ConceptMockup>;
  if (mockup.version !== 1 || !mockup.format || typeof mockup.hook !== "string" || mockup.hook.trim().length === 0) return false;
  if (!["text", "image", "carousel", "reel"].includes(mockup.format)) return false;

  switch (mockup.format) {
    case "text":
      return !!mockup.text && Array.isArray(mockup.text.keyPoints) && typeof mockup.text.hook === "string";
    case "image":
      return !!mockup.image && typeof mockup.image.headline === "string" && typeof mockup.image.visualSubject === "string";
    case "carousel":
      return !!mockup.carousel && typeof mockup.carousel.cover?.headline === "string" && Array.isArray(mockup.carousel.slides) && Number.isFinite(mockup.carousel.cardCount);
    case "reel":
      return !!mockup.reel && typeof mockup.reel.hook === "string" && typeof mockup.reel.openingFrame === "string" && Array.isArray(mockup.reel.scenes) && Number.isFinite(mockup.reel.durationSeconds);
  }
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function required(value: string, field: string): string {
  const normalized = clean(value);
  if (!normalized) throw new Error(`Concept mockup requires ${field}`);
  return normalized;
}

function shorten(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
