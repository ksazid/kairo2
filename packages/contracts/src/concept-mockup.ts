import type { BrandOpportunityDto } from "./index.js";

export type ConceptMockupFormatDto = "text" | "image" | "carousel" | "reel";

/** A durable, private visual derived from a selected opportunity's concept brief. */
export interface ConceptMockupAssetDto {
  id: string;
  kind: "post" | "carousel-slide" | "reel-poster" | "reel-video";
  position: number;
  status: "ready" | "failed";
  mimeType: string;
  width: number;
  height: number;
  storageProvider: string;
  storageKey: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
  /** Present only in authenticated API responses; never persisted as a public URL. */
  url?: string;
}

export interface TextConceptMockupDto {
  hook: string;
  opening?: string;
  keyPoints: string[];
  captionDirection?: string;
  cta?: string;
  tone?: string;
}

export interface ImageConceptMockupDto {
  headline: string;
  subheadline?: string;
  visualSubject: string;
  composition?: string;
  overlayText?: string;
  visualStyle?: string;
  cta?: string;
}

export interface CarouselConceptSlideDto {
  headline: string;
  body?: string;
  visualDirection?: string;
}

export interface CarouselConceptMockupDto {
  cover: CarouselConceptSlideDto;
  slides: CarouselConceptSlideDto[];
  closingSlide?: CarouselConceptSlideDto;
  cardCount: number;
  visualStyle?: string;
}

export interface ReelConceptSceneDto {
  startSeconds: number;
  endSeconds: number;
  beat: string;
  visualDirection?: string;
  onScreenText?: string;
}

export interface ReelConceptMockupDto {
  hook: string;
  durationSeconds: number;
  openingFrame: string;
  scenes: ReelConceptSceneDto[];
  voiceoverDirection?: string;
  endingCta?: string;
}

export interface ConceptMockupDto {
  version: 1;
  format: ConceptMockupFormatDto;
  hook: string;
  copyPreview?: string;
  visualDirection?: string;
  cta?: string;
  text?: TextConceptMockupDto;
  image?: ImageConceptMockupDto;
  carousel?: CarouselConceptMockupDto;
  reel?: ReelConceptMockupDto;
}

export type BrandOpportunityWithConceptDto = BrandOpportunityDto & {
  conceptMockup?: ConceptMockupDto;
  conceptMockupGeneratedAt?: string;
  conceptAssets?: ConceptMockupAssetDto[];
};
