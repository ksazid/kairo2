"use client";

import { useEffect, useState } from "react";

type Slide = { id: string; headline: string; body: string; renderedUrl?: string; qualityFindings?: Array<{ message: string; severity: string }> };
type Review = { id: string; assetVersion: number; renderVersionId: string; status: string; slides: Slide[]; qualitySummary: { errors: number; warnings: number; advisories: number } };
type Delivery = { slides: Array<{ publicUrl?: string }> };

export function CarouselStudio({ brandId, campaignId, assetId }: { brandId: string; campaignId: string; assetId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { headline: string; body: string }>>({});
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scope = { brandId, campaignId, assetId };

  async function call(action?: string, fields: Record<string, unknown> = {}) {
    const response = await fetch(`/api/content/carousel${action ? "" : `?${new URLSearchParams(scope)}`}`, action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...scope, action, ...fields }) } : { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "Carousel request failed.");
    return result;
  }
  function accept(next: Review) { setReview(next); setDrafts(Object.fromEntries(next.slides.map(slide => [slide.id, { headline: slide.headline, body: slide.body }]))); }
  useEffect(() => { void call().then(accept).catch(() => undefined); }, [brandId, campaignId, assetId]);
  async function run(action: string, fields: Record<string, unknown> = {}) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await call(action, fields);
      if (action === "delivery") setImages((result as Delivery).slides.map(slide => slide.publicUrl ?? ""));
      else if (action === "render") { const fresh = await call(); accept(fresh); const delivery = await call("delivery", { projectId: fresh.id, versionId: fresh.renderVersionId }) as Delivery; setImages(delivery.slides.map(slide => slide.publicUrl ?? "")); }
      else if (action === "approve") { accept(await call()); setNotice("Rendered slides approved and locked. Run the content readiness review below."); }
      else { accept(result); setImages([]); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Carousel request failed."); }
    finally { setBusy(false); }
  }
  return <section className="content-review-findings" aria-label="Carousel Studio">
    <h2>Carousel Studio</h2>
    <p>Build and inspect every production slide before publishing. Slides render at 1080 × 1350.</p>
    {!review ? <button type="button" disabled={busy} onClick={() => void run("bootstrap")}>Start carousel slides</button> : <>
      <p role="status">{review.status} · {review.slides.length} slides · {review.qualitySummary.errors} blocking errors</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
        {review.slides.map((slide, index) => <div key={slide.id} style={{ border: "1px solid #343a52", padding: 16, borderRadius: 12 }}>
          <h3>Slide {index + 1}</h3>
          {images[index] ? <img src={images[index]} alt={`Rendered slide ${index + 1}`} style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "contain" }}/> : null}
          {review.status !== "approved" ? <><label>Headline<input aria-label={`Slide ${index + 1} headline`} value={drafts[slide.id]?.headline ?? slide.headline} onChange={event => setDrafts(current => ({ ...current, [slide.id]: { ...current[slide.id], headline: event.target.value, body: current[slide.id]?.body ?? slide.body } }))}/></label><label>Body<textarea aria-label={`Slide ${index + 1} body`} value={drafts[slide.id]?.body ?? slide.body} onChange={event => setDrafts(current => ({ ...current, [slide.id]: { headline: current[slide.id]?.headline ?? slide.headline, body: event.target.value } }))}/></label><button type="button" disabled={busy || (drafts[slide.id]?.headline === slide.headline && drafts[slide.id]?.body === slide.body)} onClick={() => void run("edit", { slideId: slide.id, expectedAssetVersion: review.assetVersion, ...drafts[slide.id] })}>Save slide {index + 1}</button></> : null}
          {slide.qualityFindings?.map((finding, i) => <p key={i}>{finding.severity}: {finding.message}</p>)}
        </div>)}
      </div>
      {review.status !== "approved" ? <div style={{ display: "flex", gap: 12, marginTop: 16 }}><button type="button" disabled={busy || Object.values(drafts).some((draft, index) => draft.headline !== review.slides[index]?.headline || draft.body !== review.slides[index]?.body)} onClick={() => void run("render", { projectId: review.id, expectedAssetVersion: review.assetVersion })}>Render slides</button><button type="button" disabled={busy || !review.renderVersionId || review.qualitySummary.errors > 0 || images.length !== review.slides.length} onClick={() => void run("approve", { expectedAssetVersion: review.assetVersion, renderVersionId: review.renderVersionId })}>Approve rendered slides</button></div> : null}
      {review.renderVersionId && images.length === 0 ? <button type="button" disabled={busy} onClick={() => void run("delivery", { projectId: review.id, versionId: review.renderVersionId })}>View rendered slides</button> : null}
    </>}
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </section>;
}
