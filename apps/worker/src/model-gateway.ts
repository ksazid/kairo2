import type {
  ModelGatewayPort,
  ModelGatewayRequest,
  ModelGatewayResult,
} from "@kairo/agent-contracts";
import { responseFormatForOutputSchema } from "./model-output-schemas";

export class ModelGatewayError extends Error {
  readonly code = "model_gateway_error";
  constructor(
    message: string,
    readonly kind: "unknown" | "rate-limited" | "upstream" | "invalid-response" | "timeout" = "unknown",
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

export interface ModelTokenPricing {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  version: string;
}

export interface OpenAICompatibleGatewayOptions {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  pricing: ModelTokenPricing;
  fetchImpl?: FetchLike;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  sleep?: SleepLike;
}

export class OpenAICompatibleModelGateway implements ModelGatewayPort {
  private readonly fetchImpl: FetchLike;
  private readonly provider: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly pricing: ModelTokenPricing;
  private readonly maxAttempts: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: SleepLike;

  constructor(options: OpenAICompatibleGatewayOptions) {
    this.provider = required(options.provider, "provider").toLowerCase();
    this.baseUrl = required(options.baseUrl, "baseUrl").replace(/\/$/, "");
    this.model = required(options.model, "model");
    this.apiKey = required(options.apiKey, "apiKey");
    this.pricing = validatePricing(options.pricing);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = boundedInteger(options.maxAttempts ?? 3, "maxAttempts", 1, 5);
    this.maxRetryDelayMs = boundedInteger(options.maxRetryDelayMs ?? 5_000, "maxRetryDelayMs", 0, 30_000);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (!/^https:\/\//.test(this.baseUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(this.baseUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(this.baseUrl)) {
      throw new ModelGatewayError("Model gateway baseUrl must use HTTPS outside local development");
    }
  }

  async generate<TOutput>(request: ModelGatewayRequest): Promise<ModelGatewayResult<TOutput>> {
    if (request.policy.allowedProviders.length && !request.policy.allowedProviders.includes(this.provider)) {
      throw new ModelGatewayError(`Provider ${this.provider} is not allowed by this invocation policy`);
    }
    const started = performance.now();
    const response = await fetchWithRetry(
      this.fetchImpl,
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: `Return only valid JSON matching Kairo schema ${request.outputSchema.name}@${request.outputSchema.version}.` },
            { role: "user", content: request.input },
          ],
          max_tokens: request.policy.maxOutputTokens,
          response_format: responseFormatForOutputSchema(this.provider, this.model, request.outputSchema, request.input),
        }),
      },
      this.maxAttempts,
      this.maxRetryDelayMs,
      this.sleep,
    );
    if (!response.ok) throw new ModelGatewayError(`Model provider returned ${response.status}`, statusFailureKind(response.status), response.status);
    const payload = await response.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new ModelGatewayError("Model provider returned no content", "invalid-response");
    const inputTokens = usageInt(payload.usage?.prompt_tokens, "prompt_tokens");
    const outputTokens = usageInt(payload.usage?.completion_tokens, "completion_tokens");
    const costUsd = calculateCostUsd(inputTokens, outputTokens, this.pricing);
    let output: TOutput;
    try { output = JSON.parse(content) as TOutput; }
    catch { throw new ModelGatewayError("Model provider returned invalid JSON", "invalid-response"); }
    return {
      output,
      metadata: {
        provider: this.provider,
        model: payload.model ?? this.model,
        inputTokens,
        outputTokens,
        costUsd,
        pricingVersion: this.pricing.version,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
      },
    };
  }
}

export function openAICompatibleGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleModelGateway | null {
  const apiKey = env.KAIRO_LLM_API_KEY?.trim();
  const baseUrl = env.KAIRO_LLM_BASE_URL?.trim();
  const model = env.KAIRO_LLM_MODEL?.trim();
  const provider = env.KAIRO_LLM_PROVIDER?.trim();
  const inputRate = env.KAIRO_LLM_INPUT_USD_PER_1M_TOKENS?.trim();
  const outputRate = env.KAIRO_LLM_OUTPUT_USD_PER_1M_TOKENS?.trim();
  const pricingVersion = env.KAIRO_LLM_PRICING_VERSION?.trim();
  const coreValues = [apiKey, baseUrl, model, provider];
  const pricingValues = [inputRate, outputRate, pricingVersion];
  if ([...coreValues, ...pricingValues].every((value) => !value)) return null;
  if (coreValues.some((value) => !value)) {
    throw new ModelGatewayError("KAIRO_LLM_PROVIDER, KAIRO_LLM_BASE_URL, KAIRO_LLM_MODEL and KAIRO_LLM_API_KEY must be configured together");
  }
  if (pricingValues.some((value) => !value)) {
    throw new ModelGatewayError("KAIRO_LLM_INPUT_USD_PER_1M_TOKENS, KAIRO_LLM_OUTPUT_USD_PER_1M_TOKENS and KAIRO_LLM_PRICING_VERSION must be configured together");
  }
  return new OpenAICompatibleModelGateway({
    provider: provider!,
    baseUrl: baseUrl!,
    model: model!,
    apiKey: apiKey!,
    pricing: {
      inputUsdPerMillionTokens: pricingRate(inputRate!, "KAIRO_LLM_INPUT_USD_PER_1M_TOKENS"),
      outputUsdPerMillionTokens: pricingRate(outputRate!, "KAIRO_LLM_OUTPUT_USD_PER_1M_TOKENS"),
      version: pricingVersion!,
    },
  });
}

async function fetchWithRetry(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
  maxAttempts: number,
  maxRetryDelayMs: number,
  sleep: SleepLike,
): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch {
      if (attempt >= maxAttempts) throw new ModelGatewayError("Model provider request failed", "upstream");
      await sleep(Math.min(maxRetryDelayMs, 250 * (2 ** (attempt - 1))));
      continue;
    }
    if (!retryableStatus(response.status) || attempt >= maxAttempts) return response;
    try { await response.body?.cancel(); } catch { /* best-effort cleanup */ }
    await sleep(retryDelayMs(response.headers.get("retry-after"), attempt, maxRetryDelayMs));
  }
  throw new ModelGatewayError("Model provider request failed", "upstream");
}

function statusFailureKind(status: number): ModelGatewayError["kind"] {
  if (status === 408) return "timeout";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "upstream";
  if (status >= 400) return "invalid-response";
  return "unknown";
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(retryAfter: string | null, attempt: number, maxRetryDelayMs: number): number {
  const fallback = Math.min(maxRetryDelayMs, 250 * (2 ** (attempt - 1)));
  if (!retryAfter) return fallback;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maxRetryDelayMs, Math.round(seconds * 1_000));
  const dateMs = Date.parse(retryAfter);
  if (Number.isNaN(dateMs)) return fallback;
  return Math.min(maxRetryDelayMs, Math.max(0, dateMs - Date.now()));
}

function validatePricing(value: ModelTokenPricing): ModelTokenPricing {
  if (!value || typeof value !== "object") throw new ModelGatewayError("Model token pricing is required");
  return {
    inputUsdPerMillionTokens: nonNegativeRate(value.inputUsdPerMillionTokens, "input pricing rate"),
    outputUsdPerMillionTokens: nonNegativeRate(value.outputUsdPerMillionTokens, "output pricing rate"),
    version: required(value.version, "pricing version"),
  };
}

function calculateCostUsd(inputTokens: number, outputTokens: number, pricing: ModelTokenPricing): number {
  return ((inputTokens * pricing.inputUsdPerMillionTokens) + (outputTokens * pricing.outputUsdPerMillionTokens)) / 1_000_000;
}

function pricingRate(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ModelGatewayError(`${field} must be a non-negative number`);
  return parsed;
}

function usageInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ModelGatewayError(`Model provider usage ${field} must be a non-negative integer`);
  }
  return value;
}

function nonNegativeRate(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ModelGatewayError(`${field} must be a non-negative number`);
  return value;
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ModelGatewayError(`${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ModelGatewayError(`${field} is required`);
  return normalized;
}
