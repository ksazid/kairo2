import { describe, expect, it } from "vitest";
import { DeterministicPublishingWorker, PublishingJobRunner, type PublishingExecutionStore, type PublishingJob, type ProviderPublishResult } from "@kairo/worker/publishing";
import { InstagramProfessionalAdapter } from "@kairo/worker/publishing-adapters";

const NOW = "2026-08-17T03:00:00.000Z";

function carouselJob(overrides: Partial<PublishingJob> = {}): PublishingJob {
  return {
    commandId: "cmd-1",
    versionId: "ver-1",
    attemptId: "attempt-1",
    attemptNumber: 1,
    leaseOwner: "instagram-publisher-test",
    idempotencyKey: "cmd-1:ver-1:17841400000000000",
    channel: "instagram",
    accountRef: "17841400000000000",
    credentialRef: "meta-instagram:publish:test",
    contentType: "carousel",
    content: "Three-slide motorcycle carousel caption",
    mediaUrls: [],
    mediaItems: [
      { kind: "image", url: "https://media.kairo.test/carousel/slide-1.png" },
      { kind: "image", url: "https://media.kairo.test/carousel/slide-2.png" },
      { kind: "image", url: "https://media.kairo.test/carousel/slide-3.png" },
    ],
    options: {},
    ...overrides,
  };
}

class OneJobStore implements PublishingExecutionStore {
  readonly claims: Array<{ now: string; leaseOwner: string; leaseSeconds: number }> = [];
  readonly settlements: Array<{ job: PublishingJob; result: ProviderPublishResult; at: string }> = [];
  private claimed = false;

  constructor(private readonly job: PublishingJob) {}

  async claimNext(now: string, leaseOwner: string, leaseSeconds: number): Promise<PublishingJob | null> {
    this.claims.push({ now, leaseOwner, leaseSeconds });
    if (this.claimed) return null;
    this.claimed = true;
    return { ...this.job, leaseOwner };
  }

  async settle(job: PublishingJob, result: ProviderPublishResult, at: string): Promise<void> {
    this.settlements.push({ job, result, at });
  }
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Instagram publishing end-to-end contract", () => {
  it("claims a carousel, creates Meta children and parent, publishes it, then settles as published", async () => {
    const calls: Array<{ url: string; method: string; authorization: string | null; body: Record<string, unknown> }> = [];
    let child = 0;

    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, method, authorization: headers.get("authorization"), body });

      if (url.endsWith("/media") && body.is_carousel_item === true) {
        child += 1;
        return jsonResponse(200, { id: `child-${child}` });
      }
      if (url.endsWith("/media") && body.media_type === "CAROUSEL") {
        return jsonResponse(200, { id: "parent-1" });
      }
      if (url.endsWith("/media_publish")) {
        return jsonResponse(200, { id: "instagram-post-1" });
      }
      if(url.endsWith("/instagram-post-1?fields=permalink"))return jsonResponse(200,{permalink:"https://www.instagram.com/p/e2e/"});
      throw new Error(`Unexpected Meta request: ${method} ${url}`);
    };

    const store = new OneJobStore(carouselJob());
    const adapter = new InstagramProfessionalAdapter(
      { resolve: async (ref) => ref === "meta-instagram:publish:test" ? "test-page-token" : "" },
      "v24.0",
      fetchImpl,
    );
    const worker = new DeterministicPublishingWorker([adapter]);
    const runner = new PublishingJobRunner(store, worker, "instagram-publisher-test", 120, () => new Date(NOW));

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(store.claims).toEqual([{ now: NOW, leaseOwner: "instagram-publisher-test", leaseSeconds: 120 }]);
    expect(store.settlements).toHaveLength(1);
    expect(store.settlements[0]?.result).toEqual({
      status: "published",
      externalPostId: "instagram-post-1",
      providerCorrelationId: "parent-1",
      publishedUrl:"https://www.instagram.com/p/e2e/",
    });
    expect(store.settlements[0]?.at).toBe(NOW);

    expect(calls).toHaveLength(6);
    expect(calls.slice(0,5).every((call) => call.method === "POST")).toBe(true);
    expect(calls[5]?.method).toBe("GET");
    expect(calls.every((call) => call.authorization === "Bearer test-page-token")).toBe(true);
    expect(calls.slice(0, 3).map((call) => call.body)).toEqual([
      { image_url: "https://media.kairo.test/carousel/slide-1.png", is_carousel_item: true },
      { image_url: "https://media.kairo.test/carousel/slide-2.png", is_carousel_item: true },
      { image_url: "https://media.kairo.test/carousel/slide-3.png", is_carousel_item: true },
    ]);
    expect(calls[3]?.body).toEqual({
      media_type: "CAROUSEL",
      children: "child-1,child-2,child-3",
      caption: "Three-slide motorcycle carousel caption",
    });
    expect(calls[4]?.body).toEqual({ creation_id: "parent-1" });
  });

  it("fails closed before Meta when the encrypted credential cannot be resolved", async () => {
    let fetchCalls = 0;
    const store = new OneJobStore(carouselJob());
    const adapter = new InstagramProfessionalAdapter(
      { resolve: async () => { throw new Error("vault unavailable"); } },
      "v24.0",
      async () => { fetchCalls += 1; return jsonResponse(500, {}); },
    );
    const runner = new PublishingJobRunner(
      store,
      new DeterministicPublishingWorker([adapter]),
      "instagram-publisher-test",
      120,
      () => new Date(NOW),
    );

    await expect(runner.runOnce()).resolves.toBe(true);
    expect(fetchCalls).toBe(0);
    expect(store.settlements[0]?.result).toEqual({
      status: "failed",
      failureCode: "credential-unavailable",
      retryable: false,
    });
  });

  it("refuses unsafe media URLs without contacting Meta", async () => {
    let fetchCalls = 0;
    const store = new OneJobStore(carouselJob({
      mediaItems: [
        { kind: "image", url: "http://127.0.0.1/slide-1.png" },
        { kind: "image", url: "https://media.kairo.test/carousel/slide-2.png" },
      ],
    }));
    const adapter = new InstagramProfessionalAdapter(
      { resolve: async () => "test-page-token" },
      "v24.0",
      async () => { fetchCalls += 1; return jsonResponse(500, {}); },
    );
    const runner = new PublishingJobRunner(
      store,
      new DeterministicPublishingWorker([adapter]),
      "instagram-publisher-test",
      120,
      () => new Date(NOW),
    );

    await expect(runner.runOnce()).resolves.toBe(true);
    expect(fetchCalls).toBe(0);
    expect(store.settlements[0]?.result).toEqual({
      status: "manual-required",
      reason: "instagram carousel publishing is unavailable",
    });
  });
});
