import { describe, expect, it, vi } from "vitest";
import type { ToolGatewayPort } from "@kairo/agent-contracts";
import { GatewayShadowSearchPort, sourceKeysForIntent } from "./hunter-shadow-search-gateway";

const intent = {
  id:"rising:t1",generator:"rising-breaking",mode:"lexical-search",topicId:"t1",topicName:"AI agents",
  query:"AI agents latest",semanticQuery:"AI agents rising",audience:"engineers",sourceClasses:["Industry news"],
  priority:"high",maxResults:3,reason:"rising",
} satisfies import("@kairo/domain/hunter-retrieval").HunterRetrievalIntent;

describe("GatewayShadowSearchPort", () => {
  it("bounds source fan-out and tolerates one unavailable provider", async () => {
    const invoke = vi.fn(async (request: any) => {
      if (request.input.source === "hacker-news") throw new Error("not configured");
      return {
        output:[{title:"AI agent update",sourceUrl:"https://example.com/a",platform:"rss",retrievedAt:"2026-09-20T01:00:00Z",provider:String(request.input.source)}],
        provenance:[],
      };
    });
    const port = new GatewayShadowSearchPort({ invoke } as ToolGatewayPort, { maxSourcesPerIntent:2 });
    const result = await port.search(intent);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
  });

  it("blocks Agent Reach for intents outside the explicit paid set", async () => {
    const paidIntent = { ...intent, id: "paid:t1", generator: "brand-core" as const, sourceClasses: ["Official sources"] };
    const unpaidIntent = { ...paidIntent, id: "unpaid:t1" };
    const invoke = vi.fn(async (request: any) => ({
      output: [{
        title: "Result",
        sourceUrl: "https://example.com/" + request.input.source,
        platform: String(request.input.source),
        retrievedAt: "2026-09-20T01:00:00Z",
        provider: String(request.input.source),
      }],
      provenance: [],
    }));
    const port = new GatewayShadowSearchPort(
      { invoke } as ToolGatewayPort,
      { maxSourcesPerIntent: 2, paidIntentIds: [paidIntent.id] },
    );

    await port.search(paidIntent);
    await port.search(unpaidIntent);

    const paidSources = invoke.mock.calls
      .slice(0, 2)
      .map(([request]) => request.input.source);
    const unpaidSources = invoke.mock.calls
      .slice(2)
      .map(([request]) => request.input.source);
    expect(paidSources).toContain("agent-reach");
    expect(unpaidSources).not.toContain("agent-reach");
  });

  it("executes independent provider calls for one intent concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const invoke = vi.fn(async (request: any) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        output: [{
          title: "Result " + request.input.source,
          sourceUrl: "https://example.com/" + request.input.source,
          platform: String(request.input.source),
          retrievedAt: "2026-09-20T01:00:00Z",
          provider: String(request.input.source),
        }],
        provenance: [],
      };
    });
    const paidIntent = { ...intent, id: "paid:t1", generator: "brand-core" as const, sourceClasses: ["Official sources"] };
    const port = new GatewayShadowSearchPort(
      { invoke } as ToolGatewayPort,
      { maxSourcesPerIntent: 2, paidIntentIds: [paidIntent.id] },
    );

    await port.search(paidIntent);
    expect(maxActive).toBe(2);
  });

  it("prefers source-class hints before generator defaults", () => {
    expect(sourceKeysForIntent({ ...intent, sourceClasses:["YouTube"] })).toEqual(expect.arrayContaining(["youtube"]));
  });
});