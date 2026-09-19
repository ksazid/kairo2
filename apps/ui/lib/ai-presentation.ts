export type AiPresentationRole =
  | "title"
  | "summary"
  | "reason"
  | "timing"
  | "action"
  | "audience"
  | "objective"
  | "cta"
  | "label";

export const AI_PRESENTATION_POLICY = Object.freeze({
  title: { maxWords: 12, maxChars: 96 },
  summary: { maxWords: 22, maxChars: 180 },
  reason: { maxWords: 18, maxChars: 150 },
  timing: { maxWords: 18, maxChars: 150 },
  action: { maxWords: 20, maxChars: 165 },
  audience: { maxWords: 14, maxChars: 120 },
  objective: { maxWords: 14, maxChars: 120 },
  cta: { maxWords: 10, maxChars: 80 },
  label: { maxWords: 8, maxChars: 64 },
} satisfies Record<AiPresentationRole, { maxWords: number; maxChars: number }>);

/**
 * Single UI presentation boundary for AI-authored text.
 *
 * Display-only: raw Hunter evidence, generated content, persisted content
 * versions and audit data remain unchanged.
 */
export function presentAiText(
  value: string | null | undefined,
  role: AiPresentationRole,
  fallback = "",
): string {
  const source = cleanAiText(value) || cleanAiText(fallback);
  if (!source) return "";

  const candidate = role === "title" || role === "label" || role === "cta"
    ? source
    : mostUsefulSentence(source);

  return limitText(candidate, AI_PRESENTATION_POLICY[role]);
}

export function presentOpportunityCopy(input: {
  title?: string | null;
  rationale?: string | null;
  whyNow?: string | null;
  developmentDirection?: string | null;
  audience?: string | null;
}) {
  return {
    title: presentAiText(input.title, "title", "Untitled opportunity"),
    fit: presentAiText(input.rationale, "reason", "Strong Brand and audience fit."),
    timing: presentAiText(input.whyNow, "timing", "Public interest is growing around this topic."),
    action: presentAiText(input.developmentDirection, "action", "Turn the strongest insight into useful content."),
    audience: presentAiText(input.audience, "audience", "Your priority audience"),
  };
}

export function presentCampaignCopy(input: {
  name?: string | null;
  objective?: string | null;
  audience?: string | null;
  message?: string | null;
  cta?: string | null;
}) {
  return {
    name: presentAiText(input.name, "title", "Campaign"),
    objective: presentAiText(input.objective, "objective", "Build relevant engagement"),
    audience: presentAiText(input.audience, "audience", "Your priority audience"),
    message: presentAiText(input.message, "summary", "A clear Brand message"),
    cta: presentAiText(input.cta, "cta", "Learn more"),
  };
}

function cleanAiText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[\s>*#•\-–—]+/gm, "")
    .replace(/[*_\x60~]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function mostUsefulSentence(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return value;

  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: sentenceUtility(sentence) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return ranked[0]?.sentence ?? sentences[0] ?? value;
}

function sentenceUtility(sentence: string): number {
  const normalized = sentence.toLowerCase();
  let score = Math.min(sentence.split(/\s+/).length, 24) / 24;

  for (const phrase of GENERIC_AI_PHRASES) {
    if (normalized.includes(phrase)) score -= 0.45;
  }

  if (/\b(brand|audience|customer|reader|user|local|malta|recipe|video|guide|content|topic|trend|source|evidence)\b/i.test(sentence)) score += 0.15;
  if (/\b(create|show|explain|compare|teach|publish|turn|build|feature|demonstrate|highlight|adapt)\b/i.test(sentence)) score += 0.15;

  return score;
}

function limitText(value: string, limits: { maxWords: number; maxChars: number }): string {
  const words = value.split(/\s+/).filter(Boolean);
  let limited = words.length > limits.maxWords
    ? words.slice(0, limits.maxWords).join(" ")
    : value;

  if (limited.length > limits.maxChars) limited = limited.slice(0, limits.maxChars).trimEnd();

  const truncated = limited.length < value.length;
  limited = limited.replace(/[,:;—-]+$/, "").trim();

  if (!limited) return "";
  return truncated ? limited + "…" : limited;
}

const GENERIC_AI_PHRASES = [
  "is exploding",
  "audiences are eager",
  "cutting-edge",
  "game-changing",
  "in today's",
  "now more than ever",
  "this presents an opportunity",
  "among the first",
  "driving traffic",
  "social shares",
  "leveraging",
];
