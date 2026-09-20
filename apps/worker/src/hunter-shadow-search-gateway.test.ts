import { describe, expect, it, vi } from "vitest";
import type { ToolGatewayPort } from "@kairo/agent-contracts";
import { GatewayShadowSearchPort, sourceKeysForIntent } from "./hunter-shadow-search-gateway";

const intent = {
  id:"rising:t1",generator:"rising-breaking",mode:"lexical-search",topicId:"t1",topicName:"AI agents",
  query:"AI agents latest",semanticQuery:"AI agents rising",audience:"engineers",sourceClasses:["Industry news"],
  priority:"high",maxResults:3,reason:"rising",
} as const;

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

  it("prefers source-class hints before generator defaults", () => {
    expect(sourceKeysForIntent({ ...intent, sourceClasses:["YouTube"] })).toEqual(expect.arrayContaining(["youtube"]));
  });
});