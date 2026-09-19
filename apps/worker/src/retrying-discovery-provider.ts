import type { DiscoveryEvidence, DiscoveryRequest, DiscoverySourceProvider } from "@kairo/agent-contracts";

type SleepLike = (ms: number) => Promise<void>;

export interface RetryingDiscoverySourceProviderOptions {
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  sleep?: SleepLike;
  now?: () => number;
}

export class RetryingDiscoverySourceProvider implements DiscoverySourceProvider {
  private readonly maxAttempts: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: SleepLike;
  private readonly now: () => number;

  constructor(
    private readonly inner: DiscoverySourceProvider,
    options: RetryingDiscoverySourceProviderOptions = {},
  ) {
    this.maxAttempts = boundedInteger(options.maxAttempts ?? 3, "maxAttempts", 1, 5);
    this.maxRetryDelayMs = boundedInteger(options.maxRetryDelayMs ?? 2_000, "maxRetryDelayMs", 0, 30_000);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => performance.now());
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    const deadline = this.now() + request.timeoutMs;
    let attemptRequest = request;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.inner.discover(attemptRequest);
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.maxAttempts) throw error;
        const delay = Math.min(this.maxRetryDelayMs, 250 * (2 ** (attempt - 1)));
        // Public providers require at least 100ms. Retries share the original deadline,
        // including backoff, instead of multiplying the caller's timeout budget.
        if (deadline - this.now() < delay + 100) throw error;
        await this.sleep(delay);
        const remaining = Math.floor(deadline - this.now());
        if (remaining < 100) throw error;
        attemptRequest = { ...request, timeoutMs: Math.min(request.timeoutMs, remaining) };
      }
    }
    return [];
  }
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const kind = (error as { kind?: unknown }).kind;
  return kind === "rate-limited" || kind === "upstream";
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}
