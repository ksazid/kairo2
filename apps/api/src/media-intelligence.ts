import type { NormalizedSourceDocument, RepresentativeFrame } from "@kairo/agent-contracts";

export interface MediaAnalysisPorts {
  transcribeAudio?: (document: NormalizedSourceDocument, signal?: AbortSignal) => Promise<string | undefined>;
  extractFrames?: (document: NormalizedSourceDocument, maxFrames: number, signal?: AbortSignal) => Promise<RepresentativeFrame[]>;
  readFrameText?: (frame: RepresentativeFrame, signal?: AbortSignal) => Promise<string | undefined>;
}

export interface MediaObjectStore {
  putTemporary(input: { bytes: Uint8Array; contentType: string; expiresAt: string }): Promise<{ key: string }>;
  removeTemporary(key: string): Promise<void>;
  health(): Promise<{ status: "available" | "unavailable"; reason?: string }>;
}

/** Truthful default: text/caption analysis continues without persistent temporary media storage. */
export class UnavailableMediaObjectStore implements MediaObjectStore {
  async putTemporary(): Promise<{ key: string }> { throw new Error("temporary media object storage is not configured"); }
  async removeTemporary(): Promise<void> { /* nothing was retained */ }
  async health() { return { status: "unavailable" as const, reason: "temporary media object storage is not configured" }; }
}

export interface MediaAnalysisLimits {
  maxTranscriptChars: number;
  maxFrames: number;
  maxOcrCharsPerFrame: number;
}

export interface MediaAnalysisResult {
  canonicalUrl: string;
  contentHash: string;
  thesis?: string;
  hooks: string[];
  claims: string[];
  facts: string[];
  entities: string[];
  visualStyle: string[];
  format?: string;
  presenter?: string;
  cta?: string;
  audience: string[];
  transcript?: string;
  representativeFrames: RepresentativeFrame[];
  evidence: Array<{ kind: "caption" | "transcript" | "body" | "ocr"; value: string }>;
  confidence: number;
  warnings: string[];
  provenance: NormalizedSourceDocument["provenance"];
}

const DEFAULT_LIMITS: MediaAnalysisLimits = {
  maxTranscriptChars: 120_000,
  maxFrames: 5,
  maxOcrCharsPerFrame: 4_000,
};

export class MediaAnalyzer {
  constructor(private readonly ports: MediaAnalysisPorts = {}, private readonly limits: MediaAnalysisLimits = DEFAULT_LIMITS) {}

  async analyze(document: NormalizedSourceDocument, signal?: AbortSignal): Promise<MediaAnalysisResult> {
    const warnings = [...document.extractionWarnings];
    const evidence: MediaAnalysisResult["evidence"] = [];
    let transcript = bounded(document.captions ?? document.transcript, this.limits.maxTranscriptChars);
    if (document.captions) evidence.push({ kind: "caption", value: bounded(document.captions, this.limits.maxTranscriptChars) });
    else if (document.transcript) evidence.push({ kind: "transcript", value: bounded(document.transcript, this.limits.maxTranscriptChars) });

    if (!transcript && document.video && this.ports.transcribeAudio) {
      try {
        transcript = bounded(await this.ports.transcribeAudio(document, signal), this.limits.maxTranscriptChars);
        if (transcript) evidence.push({ kind: "transcript", value: transcript });
      } catch (error) {
        warnings.push(`speech-to-text unavailable: ${message(error)}`);
      }
    }

    if (!transcript && document.body) evidence.push({ kind: "body", value: bounded(document.body, this.limits.maxTranscriptChars) });

    let frames = (document.representativeFrames ?? []).slice(0, this.limits.maxFrames).map((frame) => ({ ...frame }));
    if (!frames.length && document.video && this.ports.extractFrames) {
      try {
        frames = (await this.ports.extractFrames(document, this.limits.maxFrames, signal)).slice(0, this.limits.maxFrames).map((frame) => ({ ...frame }));
      } catch (error) {
        warnings.push(`frame extraction unavailable: ${message(error)}`);
      }
    }

    if (this.ports.readFrameText) {
      for (const frame of frames) {
        if (frame.ocrText) continue;
        try {
          const text = bounded(await this.ports.readFrameText(frame, signal), this.limits.maxOcrCharsPerFrame);
          if (text) frame.ocrText = text;
        } catch (error) {
          warnings.push(`ocr unavailable: ${message(error)}`);
        }
      }
    }
    for (const frame of frames) if (frame.ocrText) evidence.push({ kind: "ocr", value: bounded(frame.ocrText, this.limits.maxOcrCharsPerFrame) });

    const analysisText = [document.title, document.description, ...evidence.map((entry) => entry.value)].filter(Boolean).join("\n").trim();
    const sentences = splitSentences(analysisText);
    const thesis = sentences[0] ? bounded(sentences[0], 500) : undefined;
    const hooks = unique([firstLine(analysisText), document.title].filter(Boolean) as string[]).slice(0, 3);
    const claims = sentences.filter((sentence) => /\b(is|are|will|can|should|must|best|better|more|less)\b/i.test(sentence)).slice(0, 8);
    const facts = sentences.filter((sentence) => /\b\d+(?:[.,]\d+)?%?\b|\b20\d{2}\b/.test(sentence)).slice(0, 8);
    const entities = extractEntities(analysisText).slice(0, 20);
    const cta = sentences.find((sentence) => /\b(follow|subscribe|comment|share|save|shop|buy|learn more|visit|download|sign up|try)\b/i.test(sentence));
    const audience = unique(sentences.flatMap((sentence) => [...sentence.matchAll(/\bfor\s+([a-z][a-z0-9 -]{2,60})/gi)].map((match) => match[1]?.trim()).filter(Boolean) as string[])).slice(0, 8);
    const visualStyle = inferVisualStyle(document, frames);
    const format = inferFormat(document);
    const presenter = /\b(i|i'm|i am|my|we|our)\b/i.test(transcript ?? document.body ?? "") ? "first-person presenter or Brand voice" : undefined;
    const confidence = clamp(document.confidence * (analysisText ? 1 : 0.5) * (evidence.length ? 1 : 0.85));

    if (!analysisText) warnings.push("media analysis found no usable textual evidence");
    return {
      canonicalUrl: document.canonicalUrl,
      contentHash: document.contentHash,
      ...(thesis ? { thesis } : {}),
      hooks,
      claims,
      facts,
      entities,
      visualStyle,
      ...(format ? { format } : {}),
      ...(presenter ? { presenter } : {}),
      ...(cta ? { cta } : {}),
      audience,
      ...(transcript ? { transcript } : {}),
      representativeFrames: frames,
      evidence,
      confidence,
      warnings: unique(warnings).slice(0, 50),
      provenance: structuredClone(document.provenance),
    };
  }
}

export interface OnboardingEvidenceCandidate {
  url: string;
  contentHash?: string;
  kind: "initial" | "profile" | "site" | "recent" | "deep" | "about" | "product";
}

export interface OnboardingSamplingLimits { recent: number; deep: number; total: number }
const DEFAULT_SAMPLING_LIMITS: OnboardingSamplingLimits = { recent: 20, deep: 5, total: 32 };

export function selectOnboardingEvidence(candidates: readonly OnboardingEvidenceCandidate[], limits: OnboardingSamplingLimits = DEFAULT_SAMPLING_LIMITS): OnboardingEvidenceCandidate[] {
  const result: OnboardingEvidenceCandidate[] = [];
  const seen = new Set<string>();
  let recent = 0;
  let deep = 0;
  for (const candidate of candidates) {
    if (candidate.kind === "recent" && recent >= limits.recent) continue;
    if (candidate.kind === "deep" && deep >= limits.deep) continue;
    const key = candidate.contentHash ? `hash:${candidate.contentHash}` : `url:${canonical(candidate.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...candidate, url: canonical(candidate.url) });
    if (candidate.kind === "recent") recent++;
    if (candidate.kind === "deep") deep++;
    if (result.length >= limits.total) break;
  }
  return result;
}

function bounded(value: string | undefined, max: number): string {
  if (!value) return "";
  const text = value.trim();
  return text.length <= max ? text : text.slice(0, max);
}
function firstLine(value: string) { return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""; }
function splitSentences(value: string) { return value.split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter((item) => item.length >= 12).slice(0, 100); }
function unique<T>(values: readonly T[]) { return [...new Set(values)]; }
function extractEntities(value: string) { return unique([...value.matchAll(/\b(?:[A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,3})\b/g)].map((match) => match[0]).filter((item) => item.length >= 3)); }
function clamp(value: number) { return Math.max(0, Math.min(1, Number(value.toFixed(3)))); }
function message(error: unknown) { return error instanceof Error ? error.message : "failed"; }
function canonical(value: string) { const url = new URL(value); url.hash = ""; return url.toString(); }
function inferFormat(document: NormalizedSourceDocument) {
  if (document.sourceType === "reel" || document.sourceType === "short") return "short-form vertical video";
  if (document.video) return "video";
  if ((document.images?.length ?? 0) > 1) return "carousel or multi-image post";
  if ((document.images?.length ?? 0) === 1) return "image post";
  return document.sourceType || undefined;
}
function inferVisualStyle(document: NormalizedSourceDocument, frames: RepresentativeFrame[]) {
  const cues: string[] = [];
  if (document.video?.width && document.video.height) {
    const ratio = document.video.width / document.video.height;
    if (ratio < 0.8) cues.push("vertical composition");
    else if (ratio > 1.4) cues.push("landscape composition");
    else cues.push("square or near-square composition");
  }
  if ((document.images?.length ?? 0) > 1) cues.push("multi-image visual sequence");
  if (frames.some((frame) => Boolean(frame.ocrText))) cues.push("on-screen text");
  return cues;
}
