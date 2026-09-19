"use client";

import { BarChart3, FileImage, LayoutGrid, Link2, Megaphone, PlaySquare, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { creationFormatLabel, type CreationFormat, type ViralConcept } from "../lib/home";

const formats = [
  { label: "Post", value: "image", Icon: FileImage },
  { label: "Reel", value: "reel", Icon: PlaySquare },
  { label: "Carousel", value: "carousel", Icon: LayoutGrid },
  { label: "Campaign", value: "campaign", Icon: Megaphone },
] as const;

type GenerationInput = {
  brandId?: string;
  format: CreationFormat;
  opportunityId?: string;
  title?: string;
  direction?: string;
  source?: string;
};

export function HeroControls({ brandId, selectedFormat }: { brandId?: string; selectedFormat: CreationFormat }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [concept, setConcept] = useState<ViralConcept | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  function selectFormat(format: CreationFormat) {
    const next = new URL(window.location.href);
    next.searchParams.set("format", format);
    router.replace(`${next.pathname}${next.search}`);
  }

  async function analyse() {
    if (!url.trim() || analysing) return;
    setAnalysing(true);
    setConcept(null);
    setError("");
    try {
      const response = await fetch("/api/home/analyse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { concept?: ViralConcept; error?: string };
      if (!response.ok || !body.concept) throw new Error(body.error ?? "Kairo could not analyse that link.");
      setConcept(body.concept);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kairo could not analyse that link.");
    } finally {
      setAnalysing(false);
    }
  }

  async function createFromConcept() {
    if (!brandId) {
      window.location.assign("/auth/login");
      return;
    }
    if (!concept || generating) return;
    setGenerating(true);
    setError("");
    try {
      await generateAndOpen({ brandId, format: concept.format, source: url.trim(), title: concept.title }, () => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kairo could not create this content.");
      setGenerating(false);
    }
  }

  return <>
    <div className="format-tabs" aria-label="Content format">
      {formats.map(({ label, value, Icon }) => <button key={value} type="button" aria-pressed={selectedFormat === value} data-active={selectedFormat === value} onClick={() => selectFormat(value)}><Icon aria-hidden="true"/>{label}</button>)}
    </div>
    <section className="viral-strip">
      <div className="viral-copy"><Link2 aria-hidden="true"/><span><strong>Have a viral idea?</strong><small>Paste a link and Kairo will adapt it for your Brand.</small></span></div>
      <div className="viral-input"><input aria-label="Viral content URL" type="url" inputMode="url" value={url} onChange={event => { setUrl(event.target.value); setConcept(null); setError(""); }} placeholder="Paste Instagram, YouTube or TikTok link..."/><button type="button" disabled={!url.trim() || analysing} onClick={() => void analyse()}>{analysing ? "Analysing…" : "Analyse link"}</button></div>
      {error ? <p className="viral-error" role="alert">{error}</p> : null}
      {concept ? <div className="viral-concept" role="status"><span><Sparkles aria-hidden="true"/><small>Concept preview · {concept.sourceLabel}</small><strong>{concept.title}</strong><em>{creationFormatLabel(concept.format)} · {concept.reason}</em></span><button type="button" disabled={generating} onClick={() => void createFromConcept()}><Sparkles aria-hidden="true"/>{generating ? "Creating…" : "Create with Kairo"}</button></div> : null}
    </section>
  </>;
}

export function CreateButton({ brandId, opportunityId, title, direction, format }: GenerationInput) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function create() {
    if (!brandId) {
      window.location.assign("/auth/login");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("Starting your creation…");
    try {
      await generateAndOpen({ brandId, opportunityId, title, direction, format }, setMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kairo could not create this content.");
      setBusy(false);
      setMessage("");
    }
  }

  return <div className="create-action"><button type="button" className="create-button" disabled={busy} onClick={() => void create()}><Sparkles aria-hidden="true"/>{busy ? "Creating…" : "Create with Kairo"}</button>{message ? <span role="status">{message}</span> : null}{error ? <span className="create-error" role="alert">{error}</span> : null}</div>;
}

async function generateAndOpen(input: GenerationInput & { brandId: string }, onProgress: (message: string) => void) {
  const response = await fetch("/api/home/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const started = await response.json().catch(() => ({})) as { creationId?: string; error?: string };
  if (!response.ok || !started.creationId) throw new Error(started.error ?? "Kairo could not start this creation.");
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await delay(1100);
    const progressResponse = await fetch(`/api/home/generate?brandId=${encodeURIComponent(input.brandId)}&creationId=${encodeURIComponent(started.creationId)}`, { cache: "no-store" });
    const progress = await progressResponse.json().catch(() => ({})) as { status?: string; message?: string; destination?: string | null; error?: string };
    if (!progressResponse.ok) throw new Error(progress.error ?? "Kairo could not read this creation.");
    onProgress(progress.message ?? "Creating your content…");
    if (progress.status === "ready" && progress.destination) {
      window.location.assign(progress.destination);
      return;
    }
    if (progress.status === "needs-attention") throw new Error(progress.message ?? "Kairo could not finish this creation.");
  }
  throw new Error("Generation is still running. Open Content to continue.");
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function RecommendationFormatIcon() {
  return <PlaySquare aria-hidden="true"/>;
}

export function TrendIcon() {
  return <BarChart3 aria-hidden="true"/>;
}
