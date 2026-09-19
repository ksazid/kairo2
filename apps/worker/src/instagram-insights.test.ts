import { describe, expect, it } from "vitest";
import {
  InstagramMetricCollector,
  instagramMetricTransformation,
} from "./instagram-insights";
import type { MetricCollectionJob } from "./performance";

const job: MetricCollectionJob = {
  id: "metrics-1",
  workspaceId: "ws-1",
  brandId: "brand-1",
  publishedPostId: "post-1",
  provider: "instagram",
  accountRef: "111",
  externalPostId: "media-123",
  credentialRef: "cred-1",
  attempt: 1,
};

describe("VS-17 Instagram Insights", () => {
  it("collects supported media insights without exposing the credential", async () => {
    const requested: Array<{ url: string; auth: string | null }> = [];
    const collector = new InstagramMetricCollector(
      {
        async resolve(ref) {
          expect(ref).toBe("cred-1");
          return "super-secret-page-token";
        },
      },
      "v99.0",
      async (input, init) => {
        const url = String(input);
        requested.push({
          url,
          auth: new Headers(init?.headers).get("authorization"),
        });
        const metric = new URL(url).searchParams.get("metric");
        if (!metric)
          return new Response(
            JSON.stringify({ like_count: 80, comments_count: 12 }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        const values: Record<string, number> = {
          impressions: 1500,
          reach: 900,
          likes: 80,
          comments: 12,
          shares: 9,
          saved: 24,
          views: 1300,
        };
        return new Response(
          JSON.stringify({
            data: [
              {
                name: metric,
                values: [{ value: metric === "plays" ? 1200 : values[metric] }],
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-fb-request-id": "req-1",
            },
          },
        );
      },
    );
    const result = await collector.collect(job);
    expect(result.status).toBe("collected");
    if (result.status !== "collected") return;
    expect(result.raw).toMatchObject({
      impressions: 1500,
      reach: 900,
      likes: 80,
      comments: 12,
      shares: 9,
      saved: 24,
      views: 1300,
    });
    expect(result.providerRequestId).toBe("req-1");
    expect(requested).toHaveLength(7);
    expect(
      requested.every((x) => x.auth === "Bearer super-secret-page-token"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("super-secret-page-token");
    expect(JSON.stringify(requested.map((x) => x.url))).not.toContain(
      "super-secret-page-token",
    );
    expect(instagramMetricTransformation.supported.saves).toBe("saved");
    expect(instagramMetricTransformation.supported.videoViews).toBe("views");
  });

  it("maps revoked/insufficient permissions to permission-required", async () => {
    const collector = new InstagramMetricCollector(
      {
        async resolve() {
          return "token";
        },
      },
      "v99.0",
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 190, message: "Invalid OAuth access token" },
          }),
          { status: 401 },
        ),
    );
    await expect(collector.collect(job)).resolves.toEqual({
      status: "unavailable",
      reason: "permission-required",
    });
  });

  it("maps Graph permission errors returned as HTTP 400 to permission-required", async () => {
    const collector = new InstagramMetricCollector(
      {
        async resolve() {
          return "token";
        },
      },
      "v99.0",
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 10,
              message: "Application does not have permission",
            },
          }),
          { status: 400 },
        ),
    );
    await expect(collector.collect(job)).resolves.toEqual({
      status: "unavailable",
      reason: "permission-required",
    });
  });

  it("uses graph.instagram.com for Instagram Login credentials", async () => {
    const urls: string[] = [];
    const collector = new InstagramMetricCollector(
      {
        async resolve() {
          return "token";
        },
      },
      "v99.0",
      async (input) => {
        urls.push(String(input));
        const metric = new URL(String(input)).searchParams.get("metric");
        return new Response(
          JSON.stringify(
            metric
              ? { data: [{ name: metric, values: [{ value: 1 }] }] }
              : { like_count: 1, comments_count: 1 },
          ),
          { status: 200 },
        );
      },
    );
    expect(
      (await collector.collect({ ...job, authMethod: "instagram-login" }))
        .status,
    ).toBe("collected");
    expect(
      urls.every((url) => url.startsWith("https://graph.instagram.com/")),
    ).toBe(true);
  });

  it("retries rate limits and ignores only provider-declared unsupported metric errors", async () => {
    let mode: "unsupported" | "rate" = "unsupported";
    const collector = new InstagramMetricCollector(
      {
        async resolve() {
          return "token";
        },
      },
      "v99.0",
      async (input) => {
        if (mode === "rate")
          return new Response("{}", {
            status: 429,
            headers: { "retry-after": "17" },
          });
        const metric = new URL(String(input)).searchParams.get("metric")!;
        if (metric === "views")
          return new Response(
            JSON.stringify({
              error: { code: 100, message: "metric is not supported" },
            }),
            { status: 400 },
          );
        return new Response(
          JSON.stringify({ data: [{ name: metric, values: [{ value: 1 }] }] }),
          { status: 200 },
        );
      },
    );
    const partial = await collector.collect(job);
    expect(partial.status).toBe("collected");
    if (partial.status === "collected") expect(partial.raw.views).toBe(1);
    mode = "rate";
    await expect(collector.collect(job)).resolves.toEqual({
      status: "retry",
      failureCode: "provider-429",
      retryAfterSeconds: 17,
    });
  });
});
