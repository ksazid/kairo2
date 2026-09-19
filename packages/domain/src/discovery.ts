import type { OpportunityAction, OpportunityStatus } from "@kairo/contracts";
import { DomainValidationError } from "./index";

export interface PublicSignalInput {
  title: string;
  summary?: string;
  sourceUrl: string;
  platform: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: string;
  provider: string;
  providerVersion?: string;
  contentHash?: string;
}

export interface PreparedPublicSignal extends PublicSignalInput {
  duplicateKey: string;
}

export interface OpportunityEvaluationInput {
  relevance: number;
  evidence: number;
  novelty: number;
  timeliness: number;
  brandAuthority: number;
  audienceFit: number;
}

export interface OpportunityEvaluation extends OpportunityEvaluationInput {
  overall: number;
  qualifies: boolean;
  scoringVersion: "vs03-deterministic-v1";
}

export interface OpportunitySimilarityInput {
  topic: string;
  developmentDirection: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "dclid", "msclkid"]);
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "what", "with",
]);

export function preparePublicSignal(input: PublicSignalInput): PreparedPublicSignal {
  const title = requiredText(input.title, "title", 300);
  const summary = optionalText(input.summary, "summary", 2_000);
  const sourceUrl = normalizePublicHttpUrl(input.sourceUrl, "sourceUrl");
  const platform = requiredText(input.platform, "platform", 80).toLowerCase();
  const publisher = optionalText(input.publisher, "publisher", 200);
  const author = optionalText(input.author, "author", 200);
  const publishedAt = optionalTimestamp(input.publishedAt, "publishedAt");
  const retrievedAt = requiredTimestamp(input.retrievedAt, "retrievedAt");
  const provider = requiredText(input.provider, "provider", 120).toLowerCase();
  const providerVersion = optionalText(input.providerVersion, "providerVersion", 160);
  const contentHash = optionalText(input.contentHash, "contentHash", 64)?.toLowerCase();
  if (contentHash && !SHA256.test(contentHash)) throw new DomainValidationError("contentHash must be a SHA-256 hex digest");

  return {
    title,
    ...(summary ? { summary } : {}),
    sourceUrl,
    duplicateKey: canonicalDuplicateKey(sourceUrl),
    platform,
    ...(publisher ? { publisher } : {}),
    ...(author ? { author } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    retrievedAt,
    provider,
    ...(providerVersion ? { providerVersion } : {}),
    ...(contentHash ? { contentHash } : {}),
  };
}

export function evaluateOpportunity(input: OpportunityEvaluationInput): OpportunityEvaluation {
  const relevance = score(input.relevance, "relevance");
  const evidence = score(input.evidence, "evidence");
  const novelty = score(input.novelty, "novelty");
  const timeliness = score(input.timeliness, "timeliness");
  const brandAuthority = score(input.brandAuthority, "brandAuthority");
  const audienceFit = score(input.audienceFit, "audienceFit");

  const overall = round4(
    relevance * 0.30 +
    audienceFit * 0.20 +
    novelty * 0.15 +
    evidence * 0.15 +
    timeliness * 0.10 +
    brandAuthority * 0.10,
  );

  return {
    relevance,
    evidence,
    novelty,
    timeliness,
    brandAuthority,
    audienceFit,
    overall,
    qualifies: overall >= 0.65 && relevance >= 0.50 && evidence >= 0.40 && audienceFit >= 0.50,
    scoringVersion: "vs03-deterministic-v1",
  };
}

export function materiallySimilarOpportunity(
  candidate: OpportunitySimilarityInput,
  existing: OpportunitySimilarityInput,
): boolean {
  const topicSimilarity = tokenSimilarity(candidate.topic, existing.topic);
  if (topicSimilarity < 0.70) return false;
  return tokenSimilarity(candidate.developmentDirection, existing.developmentDirection) >= 0.55;
}

export function transitionOpportunityStatus(status: OpportunityStatus, action: OpportunityAction): OpportunityStatus {
  if (status === "ignored" || status === "developing") {
    throw new DomainValidationError(`Opportunity in ${status} state cannot be changed in VS-03`);
  }
  if (action === "save") return "saved";
  if (action === "ignore") return "ignored";
  if (action === "develop") return "developing";
  throw new DomainValidationError("Opportunity action is not supported");
}

function canonicalDuplicateKey(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString().replace(/\?$/, "");
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new DomainValidationError(`${field} is required`);
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new DomainValidationError(`${field} must be text`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function normalizePublicHttpUrl(value: unknown, field: string): string {
  const text = requiredText(value, field, 2_048);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new DomainValidationError(`${field} must be a valid HTTP(S) URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new DomainValidationError(`${field} must be a valid HTTP(S) URL`);
  if (url.username || url.password) throw new DomainValidationError(`${field} must not contain credentials`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isUnsafeIpLiteral(host)) {
    throw new DomainValidationError(`${field} must use a public host`);
  }
  return url.toString();
}

function isUnsafeIpLiteral(host: string): boolean {
  if (host.includes(":")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224
  );
}

function requiredTimestamp(value: unknown, field: string): string {
  const timestamp = requiredText(value, field, 80);
  if (Number.isNaN(Date.parse(timestamp))) throw new DomainValidationError(`${field} must be a valid timestamp`);
  return timestamp;
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = optionalText(value, field, 80);
  if (!timestamp) return undefined;
  if (Number.isNaN(Date.parse(timestamp))) throw new DomainValidationError(`${field} must be a valid timestamp`);
  return timestamp;
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${field} must be a number from 0 to 1`);
  }
  return value;
}

function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function tokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [],
  );
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
