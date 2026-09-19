import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { PublicBrandReference, PublicBrandReferenceReader } from "@kairo/domain/brand-brain-bootstrap";

export type PublicBrandReferenceFailureKind =
  | "unsafe-target"
  | "unavailable"
  | "timeout"
  | "too-large"
  | "unsupported-content"
  | "invalid-response";

export class PublicBrandReferenceError extends Error {
  readonly code = "public_brand_reference_error";
  constructor(readonly kind: PublicBrandReferenceFailureKind, message: string) {
    super(message);
    this.name = "PublicBrandReferenceError";
  }
}

export interface ResolvedAddress { address: string; family: 4 | 6 }
export interface PublicBrandReferenceTransportRequest {
  url: URL;
  address: string;
  family: 4 | 6;
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
}
export interface PublicBrandReferenceTransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer | string;
  truncated?: boolean;
}

type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;
type Transport = (request: PublicBrandReferenceTransportRequest) => Promise<PublicBrandReferenceTransportResponse>;

export interface PublicBrandReferenceHttpReaderOptions {
  resolveHost?: ResolveHost;
  transport?: Transport;
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const MAX_EXCERPT = 12_000;
const MAX_PDF_INFLATED_STREAM = 1_000_000;

export class PublicBrandReferenceHttpReader implements PublicBrandReferenceReader {
  private readonly resolveHost: ResolveHost;
  private readonly transport: Transport;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(options: PublicBrandReferenceHttpReaderOptions = {}) {
    this.resolveHost = options.resolveHost ?? resolvePublicHost;
    this.transport = options.transport ?? nodeTransport;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 7_000, 500, 20_000, "timeoutMs");
    this.maxBytes = boundedInteger(options.maxBytes ?? 2_000_000, 8_000, 5_000_000, "maxBytes");
    this.maxRedirects = boundedInteger(options.maxRedirects ?? 2, 0, 5, "maxRedirects");
  }

  async read(input: string): Promise<PublicBrandReference> {
    return this.readUrl(normalizeUrl(input), 0);
  }

  private async readUrl(url: URL, redirects: number): Promise<PublicBrandReference> {
    const target = await resolveSafeTarget(url, this.resolveHost);
    let response: PublicBrandReferenceTransportResponse;
    try {
      response = await this.transport({
        url,
        address: target.address,
        family: target.family,
        timeoutMs: this.timeoutMs,
        maxBytes: this.maxBytes,
        headers: { "accept-language": "en-US,en;q=0.8", "accept-encoding": "identity" },
      });
    } catch (error) {
      if (error instanceof PublicBrandReferenceError) throw error;
      throw new PublicBrandReferenceError("unavailable", "Public Brand reference could not be fetched");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new PublicBrandReferenceError("invalid-response", "Public Brand reference redirect has no location");
      if (redirects >= this.maxRedirects) throw new PublicBrandReferenceError("invalid-response", "Public Brand reference exceeded the redirect limit");
      const next = normalizeUrl(new URL(location, url).toString());
      return this.readUrl(next, redirects + 1);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new PublicBrandReferenceError("unavailable", `Public Brand reference returned ${response.status}`);
    }

    const rawBody = decodeResponseBody(asBuffer(response.body), response.headers["content-encoding"], this.maxBytes, response.truncated);
    const contentType = mediaType(response.headers["content-type"]);
    const pdf = contentType === "application/pdf" || looksLikePdf(rawBody);
    const oversized = rawBody.length > this.maxBytes;
    const mayTruncate = isTruncatableTextContentType(contentType) && !pdf;
    if ((oversized || response.truncated) && !mayTruncate) {
      throw new PublicBrandReferenceError("too-large", "Public Brand reference exceeded the response limit");
    }
    const body = oversized ? rawBody.subarray(0, this.maxBytes) : rawBody;

    if (pdf) {
      if (!looksLikePdf(body)) throw new PublicBrandReferenceError("invalid-response", "Public Brand PDF response did not contain a PDF document");
      const context = extractPdfContext(body);
      return {
        url: url.toString(),
        ...(context.title ? { title: context.title } : {}),
        excerpt: context.excerpt,
        retrievedAt: this.now().toISOString(),
        contentType: "application/pdf",
        sizeBytes: body.length,
      };
    }

    if (contentType && contentType !== "text/html" && contentType !== "application/xhtml+xml" && !contentType.startsWith("text/") && contentType !== "application/json" && !contentType.endsWith("+json")) {
      throw new PublicBrandReferenceError("unsupported-content", "Public Brand reference content type is not supported");
    }

    const text = body.toString("utf8");
    assertUsableDecodedText(text);
    const context = contentType === "application/json" || contentType.endsWith("+json")
      ? extractJsonContext(text)
      : contentType && contentType.startsWith("text/") && contentType !== "text/html"
        ? { excerpt: normalizeWhitespace(text).slice(0, MAX_EXCERPT) }
        : extractHtmlContext(text, url);
    const links = "links" in context && Array.isArray(context.links) ? context.links as string[] : undefined;
    if (!context.excerpt) throw new PublicBrandReferenceError("invalid-response", "Public Brand reference contained no usable text");

    return {
      url: url.toString(),
      ...(context.title ? { title: context.title } : {}),
      ...(context.summary ? { summary: context.summary } : {}),
      excerpt: context.excerpt,
      retrievedAt: this.now().toISOString(),
      ...(links?.length ? { links } : {}),
    };
  }
}

async function resolveSafeTarget(url: URL, resolver: ResolveHost): Promise<ResolvedAddress> {
  const hostname = stripBrackets(url.hostname).toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new PublicBrandReferenceError("unsafe-target", "Public Brand reference must use a public host");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicAddress(hostname, literalFamily as 4 | 6)) throw new PublicBrandReferenceError("unsafe-target", "Public Brand reference resolved to a non-public address");
    return { address: hostname, family: literalFamily as 4 | 6 };
  }

  let addresses: ResolvedAddress[];
  try { addresses = await resolver(hostname); }
  catch { throw new PublicBrandReferenceError("unavailable", "Public Brand reference hostname could not be resolved"); }
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) {
    throw new PublicBrandReferenceError("unsafe-target", "Public Brand reference resolved to a non-public address");
  }
  return addresses[0]!;
}

async function resolvePublicHost(hostname: string): Promise<ResolvedAddress[]> {
  const entries = await lookup(hostname, { all: true, verbatim: true });
  return entries
    .filter((entry): entry is typeof entry & { family: 4 | 6 } => entry.family === 4 || entry.family === 6)
    .map((entry) => ({ address: entry.address, family: entry.family }));
}

function nodeTransport(request: PublicBrandReferenceTransportRequest): Promise<PublicBrandReferenceTransportResponse> {
  return new Promise((resolve, reject) => {
    const client = request.url.protocol === "https:" ? https : http;
    const headers = {
      accept: "text/html, application/xhtml+xml, application/pdf, application/json, text/plain;q=0.9, text/*;q=0.8",
      "user-agent": "KairoBrandReference/2.0",
      host: request.url.host,
      ...request.headers,
    };
    const options: https.RequestOptions = {
      protocol: request.url.protocol,
      hostname: request.address,
      family: request.family,
      port: request.url.port || undefined,
      path: `${request.url.pathname}${request.url.search}`,
      method: "GET",
      headers,
      ...(request.url.protocol === "https:" ? { servername: request.url.hostname } : {}),
    };
    const outgoing = client.request(options, (incoming) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const responseHeaders = Object.fromEntries(Object.entries(incoming.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value]));
      const contentEncoding = responseHeaders["content-encoding"]?.trim().toLowerCase();
      const truncatableText = isTruncatableTextContentType(mediaType(responseHeaders["content-type"]))
        && (!contentEncoding || contentEncoding === "identity");
      const resolveResponse = (truncated = false) => {
        if (settled) return;
        settled = true;
        resolve({
          status: incoming.statusCode ?? 0,
          headers: responseHeaders,
          body: Buffer.concat(chunks),
          ...(truncated ? { truncated: true } : {}),
        });
      };
      incoming.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = request.maxBytes - size;
        if (buffer.length > remaining) {
          if (!truncatableText) {
            settled = true;
            const error = new PublicBrandReferenceError("too-large", "Public Brand reference exceeded the response limit");
            incoming.destroy(error);
            reject(error);
            return;
          }
          if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
          size = request.maxBytes;
          resolveResponse(true);
          incoming.destroy();
          return;
        }
        size += buffer.length;
        chunks.push(buffer);
      });
      incoming.on("end", () => resolveResponse(false));
      incoming.on("error", (error) => { if (!settled) reject(error); });
    });
    outgoing.setTimeout(request.timeoutMs, () => outgoing.destroy(new PublicBrandReferenceError("timeout", "Public Brand reference timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function decodeResponseBody(body: Buffer, header: string | undefined, maxBytes: number, truncated = false): Buffer {
  const encodings = (header ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && value !== "identity");
  if (!encodings.length) return body;
  if (truncated) throw new PublicBrandReferenceError("too-large", "Compressed public Brand reference was truncated");
  if (encodings.length > 2) throw new PublicBrandReferenceError("unsupported-content", "Public Brand reference used too many content encodings");

  let decoded = body;
  try {
    for (const encoding of [...encodings].reverse()) {
      if (encoding === "gzip" || encoding === "x-gzip") decoded = gunzipSync(decoded, { maxOutputLength: maxBytes + 1 });
      else if (encoding === "deflate") decoded = inflateSync(decoded, { maxOutputLength: maxBytes + 1 });
      else if (encoding === "br") decoded = brotliDecompressSync(decoded, { maxOutputLength: maxBytes + 1 });
      else throw new PublicBrandReferenceError("unsupported-content", `Public Brand reference used unsupported content encoding: ${encoding}`);
      if (decoded.length > maxBytes) throw new PublicBrandReferenceError("too-large", "Decoded public Brand reference exceeded the response limit");
    }
  } catch (error) {
    if (error instanceof PublicBrandReferenceError) throw error;
    throw new PublicBrandReferenceError("invalid-response", "Public Brand reference compression could not be decoded safely");
  }
  return decoded;
}

function assertUsableDecodedText(value: string): void {
  const replacementCount = (value.match(/\uFFFD/g) ?? []).length;
  const binaryControlCount = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) ?? []).length;
  const limit = Math.max(2, Math.floor(value.length * 0.005));
  if (replacementCount > limit || binaryControlCount > limit) {
    throw new PublicBrandReferenceError("invalid-response", "Public Brand reference did not decode to usable text");
  }
}

function normalizeUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new PublicBrandReferenceError("unsafe-target", "Public Brand reference must be a valid HTTP(S) URL"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new PublicBrandReferenceError("unsafe-target", "Public Brand reference must be a credential-free HTTP(S) URL");
  }
  return url;
}

function isPublicAddress(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a = 0, b = 0] = parts;
    return !(
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const normalized = stripBrackets(address).toLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (normalized.startsWith("ff")) return false;
  if (normalized.startsWith("::ffff:")) {
    const embedded = normalized.slice("::ffff:".length);
    return isIP(embedded) === 4 && isPublicAddress(embedded, 4);
  }
  return isIP(normalized) === 6;
}

function extractHtmlContext(html: string, pageUrl: URL): { title?: string; summary?: string; excerpt: string; links?: string[] } {
  const title = firstNonEmpty([
    metaValue(html, "property", "og:title"),
    metaValue(html, "name", "twitter:title"),
    decodeEntities(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)),
  ])?.slice(0, 300);
  const summary = firstNonEmpty([
    metaValue(html, "name", "description"),
    metaValue(html, "property", "og:description"),
    metaValue(html, "name", "twitter:description"),
  ])?.slice(0, 1_000);
  const structured = extractStructuredDataContext(html);
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<(?:script|style|noscript|svg|template|nav|header|footer|aside)\b[^>]*>[\s\S]*$/gi, " ");
  const body = firstMatch(withoutNoise, /<main\b[^>]*>([\s\S]*?)<\/main>/i)
    || firstMatch(withoutNoise, /<body\b[^>]*>([\s\S]*?)<\/body>/i)
    || withoutNoise;
  const visible = normalizeWhitespace(removeKnownFallbackBoilerplate(decodeEntities(body.replace(/<[^>]+>/g, " "))));
  const excerpt = joinUnique([title, summary, structured, visible]).slice(0, MAX_EXCERPT);
  const links = extractSameDomainLinks(html, pageUrl);
  return { ...(title ? { title } : {}), ...(summary ? { summary } : {}), excerpt, ...(links.length ? { links } : {}) };
}

function removeKnownFallbackBoilerplate(value: string): string {
  return value.replace(
    /Notice:\s*This page displays a fallback because interactive scripts did not run\.\s*Possible causes include disabled JavaScript or failure to load scripts or stylesheets\.?/gi,
    " ",
  );
}

function extractSameDomainLinks(html: string, pageUrl: URL): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!href) continue;
    try {
      const candidate = new URL(href, pageUrl);
      candidate.hash = "";
      if (!["http:", "https:"].includes(candidate.protocol) || candidate.hostname.toLowerCase() !== pageUrl.hostname.toLowerCase()) continue;
      if (candidate.username || candidate.password || /\.(?:zip|exe|dmg|jpg|jpeg|png|gif|webp|mp4|mp3)$/i.test(candidate.pathname)) continue;
      const normalized = candidate.toString();
      if (!seen.has(normalized) && normalized !== pageUrl.toString()) { seen.add(normalized); result.push(normalized); }
      if (result.length >= 100) break;
    } catch { /* malformed links are ignored */ }
  }
  return result;
}

function metaValue(html: string, attributeName: "name" | "property", target: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (attribute(tag, attributeName)?.toLowerCase() !== target) continue;
    const content = attribute(tag, "content");
    if (content) return normalizeWhitespace(decodeEntities(content));
  }
  return undefined;
}

function extractStructuredDataContext(html: string): string | undefined {
  const values: string[] = [];
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1] ?? ""));
      collectStructuredStrings(parsed, values, 0);
    } catch {
      // Malformed structured data is ignored; visible page content can still be used.
    }
    if (values.join(" ").length >= 4_000) break;
  }
  const normalized = joinUnique(values).slice(0, 4_000);
  return normalized || undefined;
}

const STRUCTURED_KEYS = new Set(["name", "headline", "description", "slogan", "keywords", "articleBody", "text", "about"]);
function collectStructuredStrings(value: unknown, result: string[], depth: number): void {
  if (depth > 6 || result.join(" ").length >= 4_000 || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) collectStructuredStrings(item, result, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (STRUCTURED_KEYS.has(key) && typeof nested === "string") {
      const text = normalizeWhitespace(nested);
      if (text) result.push(text);
    } else if (typeof nested === "object") {
      collectStructuredStrings(nested, result, depth + 1);
    }
  }
}

function extractJsonContext(text: string): { title?: string; summary?: string; excerpt: string } {
  try {
    const parsed = JSON.parse(text);
    const strings: string[] = [];
    collectJsonStrings(parsed, strings, 0);
    const excerpt = joinUnique(strings).slice(0, MAX_EXCERPT);
    if (!excerpt) throw new Error("empty");
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    const title = record && typeof record.name === "string" ? normalizeWhitespace(record.name).slice(0, 300) : undefined;
    const summary = record && typeof record.description === "string" ? normalizeWhitespace(record.description).slice(0, 1_000) : undefined;
    return { ...(title ? { title } : {}), ...(summary ? { summary } : {}), excerpt };
  } catch {
    throw new PublicBrandReferenceError("invalid-response", "Public Brand JSON contained no usable text");
  }
}

function collectJsonStrings(value: unknown, result: string[], depth: number): void {
  if (depth > 7 || result.join(" ").length >= MAX_EXCERPT || value === null) return;
  if (typeof value === "string") {
    const text = normalizeWhitespace(value);
    if (text && !/^https?:\/\//i.test(text)) result.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 80)) collectJsonStrings(item, result, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>).slice(0, 100)) collectJsonStrings(nested, result, depth + 1);
  }
}

function extractPdfContext(body: Buffer): { title?: string; excerpt: string } {
  const source = body.toString("latin1");
  if (/\/Encrypt\b/.test(source)) throw new PublicBrandReferenceError("unsupported-content", "Encrypted public Brand PDFs are not supported");

  const titleToken = source.match(/\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)/)?.[1];
  const title = titleToken ? normalizeWhitespace(decodePdfToken(titleToken)).slice(0, 300) || undefined : undefined;
  const fragments: string[] = [];
  collectPdfTextBlocks(source, fragments);

  const streamPattern = /stream(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)endstream/g;
  for (const match of source.matchAll(streamPattern)) {
    if (fragments.join(" ").length >= MAX_EXCERPT) break;
    const index = match.index ?? 0;
    const header = source.slice(Math.max(0, index - 1_200), index);
    const dictionaryStart = header.lastIndexOf("<<");
    const dictionary = dictionaryStart >= 0 ? header.slice(dictionaryStart) : header;
    const raw = Buffer.from(match[1] ?? "", "latin1");
    if (/\/FlateDecode\b/.test(dictionary)) {
      try {
        const inflated = inflateSync(raw, { maxOutputLength: MAX_PDF_INFLATED_STREAM });
        collectPdfTextBlocks(inflated.toString("latin1"), fragments);
      } catch {
        // Unsupported/corrupt compressed streams are skipped; other text streams may still be usable.
      }
    } else if (!/\/Filter\b/.test(dictionary)) {
      collectPdfTextBlocks(raw.toString("latin1"), fragments);
    }
  }

  const excerpt = joinUnique([title, ...fragments]).slice(0, MAX_EXCERPT);
  if (!isUsablePdfText(excerpt)) {
    throw new PublicBrandReferenceError("invalid-response", "Public Brand PDF contained no safely extractable text");
  }
  return { ...(title ? { title } : {}), excerpt };
}

function collectPdfTextBlocks(content: string, output: string[]): void {
  for (const match of content.matchAll(/BT\b([\s\S]*?)\bET/g)) {
    const block = match[1] ?? "";
    for (const token of pdfStringTokens(block)) {
      const text = normalizeWhitespace(decodePdfToken(token));
      if (text && /[\p{L}\p{N}]/u.test(text)) output.push(text);
      if (output.join(" ").length >= MAX_EXCERPT) return;
    }
  }
}

function pdfStringTokens(block: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < block.length; index += 1) {
    const char = block[index];
    if (char === "(") {
      let depth = 1;
      let cursor = index + 1;
      let escaped = false;
      while (cursor < block.length && depth > 0) {
        const next = block[cursor]!;
        if (escaped) escaped = false;
        else if (next === "\\") escaped = true;
        else if (next === "(") depth += 1;
        else if (next === ")") depth -= 1;
        cursor += 1;
      }
      if (depth === 0) {
        tokens.push(block.slice(index, cursor));
        index = cursor - 1;
      }
    } else if (char === "<" && block[index + 1] !== "<") {
      const end = block.indexOf(">", index + 1);
      if (end > index) {
        const token = block.slice(index, end + 1);
        if (/^<[0-9a-fA-F\s]+>$/.test(token)) tokens.push(token);
        index = end;
      }
    }
  }
  return tokens;
}

function decodePdfToken(token: string): string {
  if (token.startsWith("<")) {
    let hex = token.slice(1, -1).replace(/\s+/g, "");
    if (hex.length % 2) hex += "0";
    return decodePdfBytes(Buffer.from(hex, "hex"));
  }
  const value = token.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }
    const next = value[++index];
    if (next === undefined) break;
    if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && index + 1 < value.length && /[0-7]/.test(value[index + 1]!); count += 1) octal += value[++index]!;
      bytes.push(Number.parseInt(octal, 8) & 0xff);
      continue;
    }
    if (next === "n") bytes.push(10);
    else if (next === "r") bytes.push(13);
    else if (next === "t") bytes.push(9);
    else if (next === "b") bytes.push(8);
    else if (next === "f") bytes.push(12);
    else if (next === "\r" || next === "\n") {
      if (next === "\r" && value[index + 1] === "\n") index += 1;
    } else bytes.push(next.charCodeAt(0) & 0xff);
  }
  return decodePdfBytes(Buffer.from(bytes));
}

function decodePdfBytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) result += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
    return result;
  }
  return bytes.toString("latin1").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ");
}

function isUsablePdfText(value: string): boolean {
  const lettersAndNumbers = value.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return lettersAndNumbers >= 8;
}

function looksLikePdf(body: Buffer): boolean {
  return body.subarray(0, Math.min(body.length, 1_024)).includes(Buffer.from("%PDF-"));
}

function mediaType(value: string | undefined): string {
  return (value ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

function isTruncatableTextContentType(contentType: string): boolean {
  return contentType === "text/html" || contentType === "application/xhtml+xml" || contentType.startsWith("text/");
}

function asBuffer(value: Buffer | string): Buffer { return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"); }

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value ? normalizeWhitespace(value) : "";
    if (normalized) return normalized;
  }
  return undefined;
}

function joinUnique(values: Array<string | undefined>): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value ? normalizeWhitespace(value) : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return normalizeWhitespace(result.join(" "));
}

function firstMatch(value: string, pattern: RegExp): string { return value.match(pattern)?.[1] ?? ""; }
function normalizeWhitespace(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function stripBrackets(value: string): string { return value.replace(/^\[|\]$/g, ""); }
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&(?:lsquo|rsquo);/gi, "'")
    .replace(/&(?:ldquo|rdquo);/gi, '"')
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}
function boundedInteger(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} is out of bounds`);
  return value;
}
