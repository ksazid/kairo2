import { describe, expect, it } from "vitest";
import {
  AgentContractError,
  prepareAgentInvocation,
  prepareModelPolicy,
  prepareToolRequest,
  type AgentInvocationInput,
} from "./index";

function invocation(overrides: Partial<AgentInvocationInput> = {}): AgentInvocationInput {
  return {
    role: "hunter",
    scope: { visibility: "global-public" },
    approvedContextVersion: "global-public@1",
    capabilities: ["public-content-search"],
    task: { instruction: "Rank this public evidence.", context: { evidence: [{ title: "AI agents", sourceUrl: "https://example.com" }] } },
    outputSchema: { name: "hunter-candidates", version: "1" },
    budget: { maxOutputTokens: 1500, maxToolCalls: 4, maxCostUsd: 0.05, timeoutMs: 30_000 },
    ...overrides,
  };
}

describe("VS-03 agent and tool boundaries", () => {
  it("allows a bounded global-public Hunter invocation", () => {
    const request = prepareAgentInvocation(invocation({ capabilities: ["public-content-search", "public-content-search"] }));
    expect(request.capabilities).toEqual(["public-content-search"]);
    expect(request.scope).toEqual({ visibility: "global-public" });
    expect(request.task.context).toMatchObject({ evidence: [{ title: "AI agents" }] });
  });

  it.each(["shell.exec", "secrets.read", "database.write", "social.publish"])(
    "rejects prohibited capability %s before a runtime can see it",
    (capability) => expect(() => prepareAgentInvocation(invocation({ capabilities: [capability] }))).toThrow(AgentContractError),
  );

  it("requires complete tenant scope for Brand-private invocation", () => {
    expect(() => prepareAgentInvocation(invocation({
      scope: { visibility: "brand-private", workspaceId: "", brandId: "brand-1" },
      approvedContextVersion: "brand-1@2",
    }))).toThrow(AgentContractError);
  });

  it("rejects secret-like fields from agent and tool context", () => {
    expect(() => prepareAgentInvocation(invocation({
      task: { instruction: "Rank", context: { brand: { apiKey: "should-never-arrive" } } },
    }))).toThrow(AgentContractError);

    expect(() => prepareToolRequest({
      capability: "public-content-search",
      scope: { visibility: "global-public" },
      input: { query: "AI agents", authorization: "Bearer no" },
      timeoutMs: 8_000,
    })).toThrow(AgentContractError);
  });

  it("keeps provider secrets outside ModelGateway policy", () => {
    const policy = prepareModelPolicy({
      qualityTier: "balanced",
      privacyClass: "brand-private",
      maxCostUsd: 0.04,
      maxOutputTokens: 1200,
      allowedProviders: ["openai", "openrouter", "openai"],
    });
    expect(policy.allowedProviders).toEqual(["openai", "openrouter"]);
    expect("apiKey" in policy).toBe(false);
    expect("token" in policy).toBe(false);
  });

  it("binds tool calls to the same explicit scope and blocks unknown capabilities", () => {
    const request = prepareToolRequest({
      capability: "public-content-search",
      scope: { visibility: "brand-private", workspaceId: "workspace-1", brandId: "brand-1" },
      input: { query: "AI agents" },
      timeoutMs: 8_000,
    });
    expect(request.scope).toEqual({ visibility: "brand-private", workspaceId: "workspace-1", brandId: "brand-1" });

    expect(() => prepareToolRequest({
      capability: "arbitrary-network",
      scope: { visibility: "global-public" },
      input: { url: "https://example.com" },
      timeoutMs: 8_000,
    })).toThrow(AgentContractError);
  });
});
