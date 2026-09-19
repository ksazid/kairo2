import { describe, expect, it } from "vitest";
import type { DiscoveryRequest } from "@kairo/agent-contracts";
import {
  CrossrefResearchEvidenceProvider,
  OpenAlexResearchEvidenceProvider,
  ResearchEvidenceAdapterError,
} from "./research-evidence-adapters";

const publicRequest = (query: string, maxResults = 4): DiscoveryRequest => ({
  query,
  scope: { visibility: "global-public" },
  maxResults,
  timeoutMs: 1_000,
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("VS-22 OpenAlex research evidence adapter", () => {
  it("normalizes bounded scholarly metadata, reconstructs a bounded abstract and never exposes its optional key", async () => {
    let seenUrl = "";
    const provider = new OpenAlexResearchEvidenceProvider({
      apiKey: "openalex-secret-key",
      contactEmail: "ops@example.com",
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return jsonResponse({ results: [{
          id: "https://openalex.org/W123",
          doi: "https://doi.org/10.1234/example.1",
          display_name: "Evidence-aware AI agents",
          publication_date: "2026-07-01",
          abstract_inverted_index: { Evidence: [0], aware: [1], agents: [2], improve: [3], reliability: [4] },
          authorships: [{ author: { display_name: "Ada Researcher" } }, { author: { display_name: "Ben Scientist" } }],
          primary_location: { source: { display_name: "Journal of Agent Systems" } },
        }] });
      },
      now: () => new Date("2026-08-15T16:30:00.000Z"),
    });

    const result = await provider.discover(publicRequest("AI agent reliability", 3));

    expect(seenUrl).toContain("https://api.openalex.org/works");
    expect(seenUrl).toContain("search=AI+agent+reliability");
    expect(seenUrl).toContain("per_page=3");
    expect(seenUrl).toContain("api_key=openalex-secret-key");
    expect(JSON.stringify(result)).not.toContain("openalex-secret-key");
    expect(result[0]).toMatchObject({
      title: "Evidence-aware AI agents",
      summary: "Evidence aware agents improve reliability",
      sourceUrl: "https://doi.org/10.1234/example.1",
      platform: "research",
      publisher: "Journal of Agent Systems",
      author: "Ada Researcher; Ben Scientist",
      publishedAt: "2026-07-01T00:00:00.000Z",
      provider: "openalex",
      providerVersion: "works-v1",
      retrievedAt: "2026-08-15T16:30:00.000Z",
    });
  });

  it("rejects Brand-private scope before network I/O", async () => {
    let calls = 0;
    const provider = new OpenAlexResearchEvidenceProvider({ fetchImpl: async () => { calls += 1; return jsonResponse({ results: [] }); } });
    await expect(provider.discover({ ...publicRequest("private launch"), scope: { visibility: "brand-private", workspaceId: "w1", brandId: "b1" } }))
      .rejects.toThrow(/global-public/i);
    expect(calls).toBe(0);
  });

  it("classifies rate limits without echoing the API key", async () => {
    const provider = new OpenAlexResearchEvidenceProvider({ apiKey: "never-echo", fetchImpl: async () => jsonResponse({ error: "limited" }, 429) });
    let caught: unknown;
    try { await provider.discover(publicRequest("AI")); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ResearchEvidenceAdapterError);
    expect(caught).toMatchObject({ kind: "rate-limited" });
    expect(String(caught)).not.toContain("never-echo");
  });
});

describe("VS-22 Crossref research evidence adapter", () => {
  it("uses bounded bibliographic search with polite identification and normalizes DOI evidence", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const provider = new CrossrefResearchEvidenceProvider({
      contactEmail: "ops@example.com",
      userAgent: "Kairo/0.1",
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenInit = init;
        return jsonResponse({ message: { items: [{
          DOI: "10.5678/crossref.9",
          title: ["Agent evaluation in production"],
          abstract: "<jats:p>Measured evaluation with <jats:bold>human review</jats:bold>.</jats:p>",
          publisher: "Evidence Press",
          author: [{ given: "Cora", family: "Reviewer" }],
          published: { "date-parts": [[2026, 6, 15]] },
          URL: "https://doi.org/10.5678/crossref.9",
        }] } });
      },
      now: () => new Date("2026-08-15T16:31:00.000Z"),
    });

    const result = await provider.discover(publicRequest("agent evaluation", 2));

    expect(seenUrl).toContain("https://api.crossref.org/works");
    expect(seenUrl).toContain("query.bibliographic=agent+evaluation");
    expect(seenUrl).toContain("rows=2");
    expect(seenUrl).toContain("mailto=ops%40example.com");
    expect(JSON.stringify(seenInit?.headers ?? {})).toContain("Kairo/0.1");
    expect(result[0]).toMatchObject({
      title: "Agent evaluation in production",
      summary: "Measured evaluation with human review .",
      sourceUrl: "https://doi.org/10.5678/crossref.9",
      platform: "research",
      publisher: "Evidence Press",
      author: "Cora Reviewer",
      publishedAt: "2026-06-15T00:00:00.000Z",
      provider: "crossref",
      providerVersion: "rest-v1",
      retrievedAt: "2026-08-15T16:31:00.000Z",
    });
  });

  it("rejects Brand-private scope before network I/O", async () => {
    let calls = 0;
    const provider = new CrossrefResearchEvidenceProvider({ fetchImpl: async () => { calls += 1; return jsonResponse({ message: { items: [] } }); } });
    await expect(provider.discover({ ...publicRequest("private strategy"), scope: { visibility: "brand-private", workspaceId: "w1", brandId: "b1" } }))
      .rejects.toThrow(/global-public/i);
    expect(calls).toBe(0);
  });

  it("fails safely on malformed provider payloads", async () => {
    const provider = new CrossrefResearchEvidenceProvider({ fetchImpl: async () => jsonResponse({ message: { items: "not-an-array" } }) });
    await expect(provider.discover(publicRequest("agents"))).rejects.toMatchObject({ kind: "invalid-response" });
  });
});
