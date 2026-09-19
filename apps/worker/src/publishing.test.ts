import { describe, expect, it } from "vitest";
import {
  DeterministicPublishingWorker,
  ApprovedMediaPublishingWorker,
  PublishingJobRunner,
  type PublishingExecutionStore,
  type PublishingJob,
  type ProviderPublishResult,
} from "./publishing";
import { FacebookPageAdapter, InstagramProfessionalAdapter, LinkedInOrganizationAdapter } from "./publishing-adapters";

const base: PublishingJob = {
  commandId: "cmd",
  versionId: "v",
  attemptId: "attempt-1",
  attemptNumber: 1,
  leaseOwner: "worker-1",
  idempotencyKey: "cmd:v:page",
  channel: "linkedin",
  accountRef: "urn:li:organization:123",
  credentialRef: "vault://li",
  contentType: "text",
  content: "Evidence-led post",
  mediaUrls: [],
};

const secrets = {
  async resolve(ref: string) {
    expect(ref).toMatch(/^vault:/);
    return "secret-token";
  },
};

describe("deterministic publishing adapters", () => {
  it("publishes LinkedIn organization text through the official Posts endpoint", async () => {
    let request: RequestInit | undefined;
    const adapter = new LinkedInOrganizationAdapter(secrets, "202607", async (input, init) => {
      expect(String(input)).toBe("https://api.linkedin.com/rest/posts");
      request = init;
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
    });

    const result = await new DeterministicPublishingWorker([adapter]).execute(base);
    expect(result).toEqual({ status: "published", externalPostId: "urn:li:share:1" });
    expect(request?.headers).toMatchObject({
      "linkedin-version": "202607",
      "x-restli-protocol-version": "2.0.0",
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("uses Instagram's container then publish flow for one public image", async () => {
    const calls: string[] = [];
    const adapter = new InstagramProfessionalAdapter(secrets, "v24.0", async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(calls.length===3?{permalink:"https://www.instagram.com/p/example/"}:{ id: calls.length === 1 ? "container-1" : "media-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await adapter.publish({
      ...base,
      channel: "instagram",
      accountRef: "123",
      credentialRef: "vault://ig",
      contentType: "image",
      mediaUrls: ["https://cdn.example.com/image.jpg"],
    });

    expect(calls).toEqual([
      "https://graph.facebook.com/v24.0/123/media",
      "https://graph.facebook.com/v24.0/123/media_publish",
      "https://graph.facebook.com/v24.0/media-1?fields=permalink",
    ]);
    expect(result).toMatchObject({
      status: "published",
      externalPostId: "media-1",
      providerCorrelationId: "container-1",
      publishedUrl:"https://www.instagram.com/p/example/",
    });
  });

  it("uses the shared channel content limits before provider execution", () => {
    const linkedin = new LinkedInOrganizationAdapter(secrets, "202607");
    const instagram = new InstagramProfessionalAdapter(secrets, "v24.0");

    expect(linkedin.supports({ ...base, content: "x".repeat(3000) })).toBe(true);
    expect(linkedin.supports({ ...base, content: "x".repeat(3001) })).toBe(false);

    const instagramImage: PublishingJob = {
      ...base,
      channel: "instagram",
      accountRef: "123",
      credentialRef: "vault://ig",
      contentType: "image",
      mediaItems: [{ kind: "image", url: "https://cdn.example.com/image.jpg" }],
    };
    expect(instagram.supports({ ...instagramImage, content: "x".repeat(2200) })).toBe(true);
    expect(instagram.supports({ ...instagramImage, content: "x".repeat(2201) })).toBe(false);
  });

  it("routes direct Instagram Login to graph.instagram.com without changing the legacy path", async () => {
    const calls: string[] = [];
    const direct = new InstagramProfessionalAdapter(secrets, "v24.0", async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ id: calls.length === 1 ? "container-direct" : "media-direct" }), { status: 200, headers: { "content-type": "application/json" } });
    }, undefined, "instagram-login");
    const legacy = new InstagramProfessionalAdapter(secrets, "v24.0");
    const job: PublishingJob = { ...base, channel: "instagram", authMethod: "instagram-login", accountRef: "123", credentialRef: "vault://ig-direct", contentType: "image", mediaItems: [{ kind: "image", url: "https://cdn.example.com/image.jpg" }], mediaUrls: [] };
    expect(legacy.supports(job)).toBe(false);
    expect((await new DeterministicPublishingWorker([legacy, direct]).execute(job)).status).toBe("published");
    expect(calls.every((url) => url.startsWith("https://graph.instagram.com/v24.0/"))).toBe(true);
  });

  it("publishes bounded Facebook Page text and image while leaving other formats manual", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const adapter = new FacebookPageAdapter(secrets, "v24.0", async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "page-post-1" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const textJob: PublishingJob = { ...base, channel: "facebook", authMethod: "facebook-login", accountRef: "456", credentialRef: "vault://fb", contentType: "text" };
    expect(await adapter.publish(textJob)).toEqual({ status: "published", externalPostId: "page-post-1" });
    const imageJob: PublishingJob = { ...textJob, contentType: "image", mediaItems: [{ kind: "image", url: "https://cdn.example.com/page.jpg" }] };
    expect(await adapter.publish(imageJob)).toEqual({ status: "published", externalPostId: "page-post-1" });
    expect(requests.map((item) => item.url)).toEqual(["https://graph.facebook.com/v24.0/456/feed", "https://graph.facebook.com/v24.0/456/photos"]);
    expect(await new DeterministicPublishingWorker([adapter]).execute({ ...textJob, contentType: "carousel" })).toMatchObject({ status: "manual-required" });
  });

  it("fails closed to manual and preserves unknown network outcomes", async () => {
    const adapter = new LinkedInOrganizationAdapter(secrets, "202607", async () => {
      throw new Error("timeout");
    });

    expect(await new DeterministicPublishingWorker([]).execute(base)).toMatchObject({ status: "manual-required" });
    expect(await adapter.publish(base)).toEqual({ status: "unknown" });
    expect(
      new InstagramProfessionalAdapter(secrets, "v24.0").supports({
        ...base,
        channel: "instagram",
        accountRef: "123",
        contentType: "image",
        mediaUrls: ["http://127.0.0.1/private"],
      }),
    ).toBe(false);
  });
});

describe("VS-77 approved media delivery",()=>{
  it("delivers only the exact approved asset version through temporary public URLs",async()=>{
    const adapter={channel:"instagram" as const,supports:()=>true,publish:async(job:PublishingJob)=>({status:"published" as const,externalPostId:job.mediaItems?.[0]?.url??"missing"})};
    const fingerprint="a".repeat(64);
    const delivery={deliver:async(input:{approvedAssetVersionId:string;approvedMediaFingerprint:string})=>({approvedAssetVersionId:input.approvedAssetVersionId,approvedMediaFingerprint:input.approvedMediaFingerprint,mediaItems:[{kind:"image" as const,url:"https://media.example.test/temporary.png"}],expiresAt:"2026-08-15T12:10:00Z"})};
    const worker=new ApprovedMediaPublishingWorker(new DeterministicPublishingWorker([adapter]),delivery,()=>new Date("2026-08-15T12:00:00Z"));
    const job={...base,versionId:"content-version-2",channel:"instagram" as const,accountRef:"123",contentType:"carousel" as const,approvedAssetVersionId:"rendered-carousel-version-7",approvedMediaFingerprint:fingerprint};
    expect(await worker.execute(job)).toEqual({status:"published",externalPostId:"https://media.example.test/temporary.png"});
    const mismatchDelivery={deliver:async()=>({approvedAssetVersionId:"other",approvedMediaFingerprint:fingerprint,mediaItems:[],expiresAt:"2026-08-15T12:10:00Z"})};
    const mismatch=new ApprovedMediaPublishingWorker(new DeterministicPublishingWorker([adapter]),mismatchDelivery);
    expect(await mismatch.execute(job)).toMatchObject({status:"failed",failureCode:"approved-media-mismatch"});
  });

  it("publishes an approved Reel from its fingerprint-locked media item without Carousel delivery",async()=>{
    const adapter={channel:"instagram" as const,supports:()=>true,publish:async(job:PublishingJob)=>({status:"published" as const,externalPostId:job.mediaItems?.[0]?.url??"missing"})};
    const delivery={deliver:async()=>{throw new Error("Carousel delivery must not run for Reels")}};
    const worker=new ApprovedMediaPublishingWorker(new DeterministicPublishingWorker([adapter]),delivery);
    const job={...base,channel:"instagram" as const,accountRef:"123",contentType:"reel" as const,approvedAssetVersionId:"content-version-2",approvedMediaFingerprint:"b".repeat(64),mediaItems:[{kind:"video" as const,url:"https://media.example.test/reel.mp4"}]};
    expect(await worker.execute(job)).toEqual({status:"published",externalPostId:"https://media.example.test/reel.mp4"});
  });
});

describe("PublishingJobRunner", () => {
  it("claims and settles one job without any model or agent port", async () => {
    let settled: ProviderPublishResult | undefined;
    const store: PublishingExecutionStore = {
      async claimNext() {
        return base;
      },
      async settle(_, result) {
        settled = result;
      },
    };

    const ran = await new PublishingJobRunner(
      store,
      new DeterministicPublishingWorker([
        new LinkedInOrganizationAdapter(
          secrets,
          "202607",
          async () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:2" } }),
        ),
      ]),
      "worker-1",
      60,
      () => new Date("2026-08-14T10:00:00Z"),
    ).runOnce();

    expect(ran).toBe(true);
    expect(settled).toMatchObject({ status: "published" });
  });
});
