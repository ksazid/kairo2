import Image from "next/image";
import type { ReactNode } from "react";
import { presentAiText } from "../lib/ai-presentation";
import type { ConceptMockupView } from "../lib/concept-mockup";

export function ConceptMockupPreview({ mockup, mode = "card" }: { mockup?: ConceptMockupView | null; mode?: "compact" | "card" | "full" }) {
  if (!mockup) return <MockupFrame mode={mode}><span className="concept-mockup-kicker">Concept preview</span><strong>Preview will appear when the idea is ready.</strong></MockupFrame>;
  if (mockup.format === "text") return <TextPreview mockup={mockup} mode={mode}/>;
  if (mockup.format === "image") return <ImagePreview mockup={mockup} mode={mode}/>;
  if (mockup.format === "carousel") return <CarouselPreview mockup={mockup} mode={mode}/>;
  return <ReelPreview mockup={mockup} mode={mode}/>;
}

function MockupFrame({ children, mode }: { children: ReactNode; mode: "compact" | "card" | "full" }) {
  return <section className={`concept-mockup concept-mockup-${mode}`}>{children}</section>;
}

function TextPreview({ mockup, mode }: { mockup: ConceptMockupView; mode: "compact" | "card" | "full" }) {
  const text = mockup.text;
  return <MockupFrame mode={mode}><span className="concept-mockup-kicker">Text concept</span><strong>{presentAiText(text?.hook ?? mockup.hook, "title")}</strong>{mode !== "compact" && text?.opening ? <p>{presentAiText(text.opening, "summary")}</p> : null}{mode === "full" && text?.keyPoints?.length ? <ul>{text.keyPoints.slice(0, 3).map((point) => <li key={point}>{presentAiText(point, "action")}</li>)}</ul> : null}{mockup.cta || text?.cta ? <small>{presentAiText(mockup.cta ?? text?.cta, "cta")}</small> : null}</MockupFrame>;
}

function ImagePreview({ mockup, mode }: { mockup: ConceptMockupView; mode: "compact" | "card" | "full" }) {
  const image = mockup.image;
  const asset = mockup.assets?.find((item) => item.kind === "post" && item.status === "ready" && item.url);
  return <MockupFrame mode={mode}><span className="concept-mockup-kicker">Image concept</span>{asset?.url ? <Asset src={asset.url} alt={presentAiText(image?.headline ?? mockup.hook, "title")}/> : <div className="concept-artboard"><strong>{presentAiText(image?.overlayText ?? image?.headline ?? mockup.hook, "title")}</strong>{mode !== "compact" && image?.subheadline ? <p>{presentAiText(image.subheadline, "summary")}</p> : null}</div>}{mode === "full" ? <p>{presentAiText([image?.visualSubject, image?.composition].filter(Boolean).join(" · "), "summary")}</p> : null}</MockupFrame>;
}

function CarouselPreview({ mockup, mode }: { mockup: ConceptMockupView; mode: "compact" | "card" | "full" }) {
  const carousel = mockup.carousel;
  const cards = carousel ? [carousel.cover, ...carousel.slides.slice(0, 2)] : [{ headline: mockup.hook }];
  return <MockupFrame mode={mode}><span className="concept-mockup-kicker">Carousel concept · {carousel?.cardCount ?? cards.length} cards</span><div className="concept-carousel">{cards.slice(0, mode === "compact" ? 1 : 3).map((card, index) => { const asset = mockup.assets?.find((item) => item.kind === "carousel-slide" && item.position === index && item.status === "ready" && item.url); const headline = presentAiText(card.headline, "title"); return asset?.url ? <Asset key={`${card.headline}-${index}`} src={asset.url} alt={headline}/> : <div className="concept-artboard" key={`${card.headline}-${index}`}><small>{index + 1}</small><strong>{headline}</strong>{mode === "full" && card.body ? <p>{presentAiText(card.body, "summary")}</p> : null}</div>; })}</div></MockupFrame>;
}

function ReelPreview({ mockup, mode }: { mockup: ConceptMockupView; mode: "compact" | "card" | "full" }) {
  const reel = mockup.reel;
  const poster = mockup.assets?.find((item) => item.kind === "reel-poster" && item.status === "ready" && item.url);
  return <MockupFrame mode={mode}><span className="concept-mockup-kicker">Reel concept · ~{reel?.durationSeconds ?? 20}s</span>{poster?.url ? <Asset src={poster.url} alt={presentAiText(reel?.openingFrame ?? mockup.hook, "title")}/> : <div className="concept-artboard concept-reel-frame"><span aria-hidden="true">▶</span><strong>{presentAiText(reel?.openingFrame ?? mockup.hook, "title")}</strong></div>}{mode === "full" && reel?.scenes?.length ? <ol className="concept-storyboard">{reel.scenes.slice(0, 4).map((scene) => <li key={`${scene.startSeconds}-${scene.endSeconds}-${scene.beat}`}><small>{scene.startSeconds}–{scene.endSeconds}s</small><strong>{presentAiText(scene.beat, "action")}</strong>{scene.onScreenText ? <span>{presentAiText(scene.onScreenText, "summary")}</span> : null}</li>)}</ol> : null}</MockupFrame>;
}

function Asset({ src, alt }: { src: string; alt: string }) { return <div className="concept-rendered-asset"><Image src={src} alt={alt} fill unoptimized sizes="(max-width: 700px) 100vw, 420px"/></div>; }
