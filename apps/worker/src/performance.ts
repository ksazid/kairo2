import type {
  MetricProvider,
  MetricUnavailableReason,
} from "@kairo/domain/analytics";
export interface MetricCollectionJob {
  id: string;
  workspaceId: string;
  brandId: string;
  publishedPostId: string;
  provider: MetricProvider;
  accountRef: string;
  externalPostId: string;
  credentialRef: string;
  attempt: number;
  scheduledFor?: string;
  collectionWindow?: "1h" | "24h" | "7d";
  leaseOwner?: string;
  authMethod?: "facebook-login" | "instagram-login";
}
export type MetricCollectionResult =
  | {
      status: "collected";
      raw: Record<string, unknown>;
      providerRequestId?: string;
    }
  | { status: "unavailable"; reason: MetricUnavailableReason }
  | { status: "retry"; failureCode: string; retryAfterSeconds: number }
  | { status: "failed"; failureCode: string };
export interface MetricCollector {
  provider: MetricProvider;
  supports(job: MetricCollectionJob): boolean;
  collect(job: MetricCollectionJob): Promise<MetricCollectionResult>;
}
export class PerformanceCollectionWorker {
  constructor(
    private collectors: MetricCollector[],
    private maxAttempts = 3,
  ) {}
  async execute(job: MetricCollectionJob): Promise<MetricCollectionResult> {
    if (
      !Number.isInteger(job.attempt) ||
      job.attempt < 1 ||
      job.attempt > this.maxAttempts
    )
      return { status: "failed", failureCode: "attempt-limit" };
    const collector = this.collectors.find(
      (x) => x.provider === job.provider && x.supports(job),
    );
    if (!collector) return { status: "unavailable", reason: "unsupported" };
    const result = await collector.collect(job);
    if (result.status === "retry" && job.attempt >= this.maxAttempts)
      return { status: "failed", failureCode: "attempt-limit" };
    return result;
  }
}
export class CapabilityMetricCollector implements MetricCollector {
  constructor(
    public provider: MetricProvider,
    private fetchMetrics: (job: MetricCollectionJob) => Promise<{
      status: number;
      raw?: Record<string, unknown>;
      requestId?: string;
      retryAfterSeconds?: number;
    }>,
  ) {}
  supports(job: MetricCollectionJob) {
    return (
      job.provider === this.provider &&
      !!job.accountRef &&
      !!job.externalPostId &&
      !!job.credentialRef
    );
  }
  async collect(job: MetricCollectionJob): Promise<MetricCollectionResult> {
    const response = await this.fetchMetrics(job);
    if (response.status === 401 || response.status === 403)
      return { status: "unavailable", reason: "permission-required" };
    if (response.status === 404)
      return { status: "unavailable", reason: "post-not-eligible" };
    if (response.status === 429 || response.status >= 500)
      return {
        status: "retry",
        failureCode: `provider-${response.status}`,
        retryAfterSeconds: Math.max(1, response.retryAfterSeconds ?? 60),
      };
    if (response.status < 200 || response.status >= 300 || !response.raw)
      return { status: "failed", failureCode: `provider-${response.status}` };
    return {
      status: "collected",
      raw: response.raw,
      ...(response.requestId ? { providerRequestId: response.requestId } : {}),
    };
  }
}
