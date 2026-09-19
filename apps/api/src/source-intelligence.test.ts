import { describe, expect, it, vi } from "vitest";
import { InMemoryNormalizedSourceCache, type NormalizedSourceDocument } from "@kairo/agent-contracts";
import type { PublicBrandReferenceReader } from "@kairo/domain/brand-brain-bootstrap";
import {
  PublicBrandReferenceHttpReader,
  type PublicBrandReferenceTransportResponse,
} from "./public-brand-reference";
import {
  SecureHttpSourceAdapter,
  SourceIntelligenceBrandReferenceReader,
  createSourceIntelligenceRouter,
} from "./source-intelligence";

describe("VS-99 secure HTTP source adapter", () => {
  it("ignores malformed external links during onboarding sampling", async () => {
    const makeDocument = (url: string, externalLinks: string[] = []): NormalizedSourceDocument => ({
      canonicalUrl: url,
      platform: "website",
      sourceType: "website",
      title: "Acme software",
      body: "Acme builds software applications for small businesses and technical teams.",
      retrievedAt: "2026-08-26T07:00:00.000Z",
      contentHash: "sha256:acme",
      provider: "fixture",
      providerVersion: "1",
      parserVersion: "1",
      provenance: [],
      confidence: 1,
      extractionWarnings: [],
      trust: "untrusted-evidence",
      ...(externalLinks.length ? { externalLinks } : {}),
    });
    const fetch = vi.fn(async ({ url }: { url: string }) => ({
      document: makeDocument(url, url === "https://example.com/" ? ["not a URL", "javascript:alert(1)", "https://example.com/about"] : []),
    }));
    const reader = new SourceIntelligenceBrandReferenceReader({ fetch } as never);

    await expect(reader.read("https://example.com/")).resolves.toMatchObject({
      url: "https://example.com/",
      links: ["https://example.com/about"],
    });
  });

  it("bridges the existing reader into normalized untrusted evidence", async () => {
    let calls = 0;
    const reader = new PublicBrandReferenceHttpReader({
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async (): Promise<PublicBrandReferenceTransportResponse> => {
        calls++;
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: '<html><head><title>Example</title><meta name="description" content="Summary"></head><body><main>Useful body</main></body></html>',
        };
      },
      now: () => new Date("2026-08-26T07:00:00.000Z"),
    });
    const router = createSourceIntelligenceRouter({
      reader,
      cache: new InMemoryNormalizedSourceCache(),
    });
    const first = await router.fetch({
      url: "https://example.com",
      scope: { visibility: "global-public" },
      timeoutMs: 1000,
    });
    const second = await router.fetch({
      url: "https://example.com",
      scope: { visibility: "global-public" },
      timeoutMs: 1000,
    });
    expect(first.document).toMatchObject({
      platform: "website",
      title: "Example",
      trust: "untrusted-evidence",
      provider: "website",
    });
    expect(first.document.contentHash).toMatch(/^sha256:/);
    expect(second.cacheHit).toBe(true);
    expect(calls).toBe(1);
    const refreshed = await router.fetch({
      url: "https://example.com",
      scope: { visibility: "global-public" },
      timeoutMs: 1000,
      forceRefresh: true,
    });
    expect(refreshed.cacheHit).toBe(true);
    expect(calls).toBe(2);
    const compatibility = await new SourceIntelligenceBrandReferenceReader(
      router,
    ).read("https://example.com");
    expect(compatibility).toMatchObject({
      url: "https://example.com/",
      title: "Example",
      excerpt: expect.stringContaining("Useful body"),
    });
  });
  it("truthfully reports adapter health without credentials", async () => {
    const adapter = new SecureHttpSourceAdapter(
      new PublicBrandReferenceHttpReader(),
    );
    await expect(adapter.health()).resolves.toEqual({ status: "available" });
  });
});

describe("VS-101 social Source Intelligence routing", () => {
  it("routes professional-network URLs through the dedicated adapter and reuses it for onboarding compatibility", async () => {
    const read = vi.fn<PublicBrandReferenceReader["read"]>(async (url) => ({
      url,
      title: "Sazid Khan | LinkedIn",
      summary: "Software engineering and architecture",
      excerpt:
        "Senior software engineer working on software architecture, cloud systems and AI-enabled applications.",
      retrievedAt: "2026-08-26T09:00:00.000Z",
    }));
    const router = createSourceIntelligenceRouter({
      reader: { read },
      youtubeApiKey: "",
      linkedinPublicEnabled: true,
    });
    const result = await router.fetch({
      url: "https://www.linkedin.com/in/ksazid",
      scope: { visibility: "global-public" },
      timeoutMs: 1000,
    });
    expect(result.adapterId).toBe("linkedin-public");
    expect(result.document).toMatchObject({
      platform: "linkedin",
      sourceType: "profile",
      profile: "ksazid",
      provider: "linkedin-public",
    });
    const onboardingReference =
      await new SourceIntelligenceBrandReferenceReader(router).read(
        "https://www.linkedin.com/in/ksazid",
      );
    expect(onboardingReference.excerpt).toContain("software architecture");
  });
  it("strips social tracking parameters while preserving YouTube semantic video ids", async () => {
    const read = vi.fn<PublicBrandReferenceReader["read"]>(async (url) => ({
      url,
      title: "Acme",
      excerpt:
        "Useful public Brand evidence with enough context for onboarding.",
      retrievedAt: "2026-08-26T09:00:00.000Z",
    }));
    const router = createSourceIntelligenceRouter({
      reader: { read },
      youtubeApiKey: "",
    });
    const instagram = await router.fetch({
      url: "https://www.instagram.com/acme/?utm_source=test&igsh=abc",
      scope: { visibility: "global-public" },
      timeoutMs: 1000,
    });
    expect(read.mock.calls[0]?.[0]).toBe("https://www.instagram.com/acme");
    expect(instagram.document.canonicalUrl).toBe(
      "https://www.instagram.com/acme",
    );
    const youtube = await router.fetch({
      url: "https://www.youtube.com/watch?v=abc123&si=share-token&feature=shared",
      scope: { visibility: "global-public" },
      timeoutMs: 1000,
    });
    expect(read.mock.calls[1]?.[0]).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
    expect(youtube.document.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
  });
});
