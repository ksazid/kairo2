export type ConceptMockupView = {
  version: 1;
  format: "text" | "image" | "carousel" | "reel";
  hook: string;
  copyPreview?: string;
  visualDirection?: string;
  cta?: string;
  text?: {
    hook: string;
    opening?: string;
    keyPoints: string[];
    captionDirection?: string;
    cta?: string;
    tone?: string;
  };
  image?: {
    headline: string;
    subheadline?: string;
    visualSubject: string;
    composition?: string;
    overlayText?: string;
    visualStyle?: string;
    cta?: string;
  };
  carousel?: {
    cover: { headline: string; body?: string; visualDirection?: string };
    slides: Array<{ headline: string; body?: string; visualDirection?: string }>;
    closingSlide?: { headline: string; body?: string; visualDirection?: string };
    cardCount: number;
    visualStyle?: string;
  };
  reel?: {
    hook: string;
    durationSeconds: number;
    openingFrame: string;
    scenes: Array<{
      startSeconds: number;
      endSeconds: number;
      beat: string;
      visualDirection?: string;
      onScreenText?: string;
    }>;
    voiceoverDirection?: string;
    endingCta?: string;
  };
  assets?: Array<{ id: string; kind: "post" | "carousel-slide" | "reel-poster" | "reel-video"; position: number; status: "ready" | "failed"; mimeType: string; width: number; height: number; url?: string }>;
};
