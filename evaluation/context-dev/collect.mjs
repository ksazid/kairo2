import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base = new URL('./', import.meta.url);
export const plan = JSON.parse(await readFile(new URL('plan.json', base), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
export function requests(brand) {
  const timeoutOpts = { milliseconds: 80000, behavior: 'return-partial' };
  return [
    { operation: 'brand', path: '/brand/retrieve', method: 'POST', reserve: 10, body: { type: 'by_domain', domain: brand.domain, force_language: 'english', maxAgeMs: 0, timeoutOpts } },
    { operation: 'styleguide', path: `/web/styleguide?domain=${encodeURIComponent(brand.domain)}&maxAgeMs=0`, method: 'GET', reserve: 10 },
    { operation: 'crawl', path: '/web/crawl', method: 'POST', reserve: 5, body: { url: brand.url, maxPages: 5, maxDepth: 2, followSubdomains: false, useMainContentOnly: true, includeImages: false, pdf: { shouldParse: false }, timeoutOpts } },
    { operation: 'search', path: '/web/search', method: 'POST', reserve: 1, body: { query: brand.query, numResults: 10, freshness: 'last_month', timeoutOpts } },
  ];
}

export function normalize(brand, operation, body, retrievedAt) {
  const items = operation === 'crawl'
    ? (body.results ?? []).filter(p => p.metadata?.success === true && typeof p.markdown === 'string' && p.markdown.trim()).map(p => ({ url: p.metadata.url, title: p.metadata.title, text: p.markdown }))
    : operation === 'brand' && body.status === 'ok' && body.brand?.domain?.replace(/^www\./, '') === brand.domain
      ? [{ url: brand.url, title: body.brand.title, text: JSON.stringify(body.brand) }]
      : operation === 'styleguide' && body.status === 'ok' && body.domain?.replace(/^www\./, '') === brand.domain && body.styleguide
        ? [{ url: brand.url, title: `${brand.name} website style observations`, text: JSON.stringify(body.styleguide) }]
        : [];
  return items.flatMap((item, i) => {
    let url;
    try { url = new URL(item.url); } catch { return []; }
    if (url.protocol !== 'https:' || url.hostname.replace(/^www\./, '') !== brand.domain || url.username || url.password) return [];
    const contentHash = hash(item.text);
    return [{ sourceId: `context-dev:${brand.id}:${operation}:${i}:${contentHash.slice(0,12)}`, url: url.href, title: item.title || brand.name,
      excerpt: item.text.slice(0,12000), retrievedAt, provider: 'context-dev', operation, requestId: body.request_id ?? null,
      contentHash, partial: body.partial === true, cacheMetadata: body.cache_metadata ?? null, trust: 'untrusted-provider-observation', truncated: item.text.length > 12000 }];
  });
}

export class ContextCollector {
  constructor({ apiKey, fetchImpl = fetch } = {}) { this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.reserved = 0; this.count = 0; this.records = []; }
  async call(brand, request) {
    if (!this.apiKey) return { status: 'blocked-missing-key', operation: request.operation };
    if (this.count >= plan.budget.maxContextRequests || this.reserved + request.reserve > plan.budget.maxContextCredits) throw new Error('POC budget exhausted');
    this.count++; this.reserved += request.reserve;
    const started = Date.now();
    let record;
    try {
      const response = await this.fetchImpl(`https://api.context.dev/v1${request.path}`, {
        method: request.method, redirect: 'error', signal: AbortSignal.timeout(plan.budget.requestTimeoutMs),
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const text = await response.text();
      if (Buffer.byteLength(text) > 5000000) throw new Error('Response too large');
      if (text.includes(this.apiKey)) throw new Error('Sensitive response rejected');
      const body = JSON.parse(text);
      const creditValue = body.key_metadata?.credits_consumed ?? response.headers.get('X-Credits-Used');
      const credits = creditValue === null || creditValue === undefined ? null : Number(creditValue);
      const retrievedAt = new Date().toISOString();
      const noMatch = response.status === 400 && ['NOT_FOUND','WEBSITE_NOT_FOUND'].includes(body.error_code);
      record = { operation: request.operation, status: response.ok ? 'received' : noMatch ? 'no-match' : 'upstream-error', httpStatus: response.status,
        requestId: body.request_id ?? null, credits: Number.isFinite(credits) ? credits : null,
        elapsedMs: Date.now()-started, retrievedAt, partial: body.partial === true,
        references: response.ok ? normalize(brand, request.operation, body, retrievedAt) : [],
        ...(response.ok ? { raw: body } : {}) };
      // Never persist arbitrary error messages; providers may echo sensitive request data.
    } catch { record = { operation: request.operation, status: 'transport-or-invalid-response', elapsedMs: Date.now()-started, credits: null, references: [] }; }
    this.records.push(record);
    return record;
  }
}

export async function collect({ live = false, reader, collector = new ContextCollector({ apiKey: process.env.CONTEXT_DEV_API_KEY }) } = {}) {
  const output = { authoringRun: plan.authoringRun, version: 1, baselineCommit: plan.baselineCommit, startedAt: new Date().toISOString(), mode: live ? 'live' : 'preflight',
    credentialsAvailable: Boolean(collector.apiKey), budget: plan.budget, brands: [], downstream: { brandBrain: 'not-run', hunter: 'not-run', qualityImprovement: 'unmeasured' } };
  for (const brand of plan.brands) {
    const result = { id: brand.id, name: brand.name, query: brand.query, baselineReader: { status: 'not-run' }, context: [] };
    if (live && reader) {
      try { result.baselineReader = { status: 'received', reference: await reader.read(brand.url) }; }
      catch(error) { result.baselineReader = { status: 'failed', kind: error.kind ?? 'unknown' }; }
    }
    for (const request of requests(brand)) result.context.push(live ? await collector.call(brand, request) : { operation: request.operation, status: collector.apiKey ? 'ready-not-called' : 'blocked-missing-key' });
    result.enhancedReferences = result.context.flatMap(r => r.references ?? []);
    output.brands.push(result);
  }
  output.finishedAt = new Date().toISOString();
  output.contextRequests = collector.count;
  output.creditsReserved = collector.reserved;
  output.creditsReported = collector.records.reduce((s,r) => s+(r.credits ?? 0),0);
  output.creditsAccountingComplete = collector.records.every(r => r.credits !== null);
  return output;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const live = process.argv.includes('--live');
  let reader;
  if (live) {
    const { PublicBrandReferenceHttpReader } = await import('../../apps/api/src/public-brand-reference.ts');
    reader = new PublicBrandReferenceHttpReader();
  }
  const output = await collect({ live, reader });
  const directory = fileURLToPath(new URL('../../artifacts/context-dev/', base));
  await mkdir(directory, { recursive: true });
  const path = `${directory}/${live ? 'live' : 'preflight'}-evidence.json`;
  await writeFile(path, JSON.stringify(output,null,2)+'\n', { mode: 0o600 });
  console.log(JSON.stringify({ path, mode: output.mode, contextRequests: output.contextRequests, downstream: output.downstream, brands: output.brands.map(b => ({ id:b.id, baseline:b.baselineReader.status, context:b.context.map(c=>c.status) })) },null,2));
}
