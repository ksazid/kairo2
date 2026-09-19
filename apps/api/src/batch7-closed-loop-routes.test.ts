import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { HunterRunInput } from "@kairo/worker/hunter";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import { MemoryKairoRepository } from "./store";
import {
  registerHunterRecommendationRoutes,
  type HunterRecommendationRunner,
} from "./hunter-recommendation-routes";
import type {
  HunterClosedLoopStore,
  OpportunityDevelopmentResult,
  RecommendationFeedbackAction,
  RecommendationFeedbackResult,
} from "./batch7-closed-loop-store";

class Verifier implements IdentityVerifier {
  async verify(value: string | undefined): Promise<ExternalIdentity | null> {
    return value?.startsWith("Bearer test:")
      ? { provider: "test", subject: value.slice("Bearer test:".length) }
      : null;
  }
}

class ClosedLoopFixture implements HunterClosedLoopStore {
  feedback: Array<{ accountId: string; brandId: string; opportunityId: string; action: RecommendationFeedbackAction }> = [];
  developments: Array<{ accountId: string; brandId: string; opportunityId: string }> = [];

  async learningContext() {
    return "Accepted performance learning: carousel explainers earn more saves | Recommendation feedback: dismissed: generic AI news";
  }

  async recordFeedback(accountId: string, brandId: string, opportunityId: string, action: RecommendationFeedbackAction): Promise<RecommendationFeedbackResult> {
    this.feedback.push({ accountId, brandId, opportunityId, action });
    return { opportunityId, action, status: action === "dismissed" ? "ignored" : "new" };
  }

  async developOpportunity(accountId: string, brandId: string, opportunityId: string): Promise<OpportunityDevelopmentResult> {
    this.developments.push({ accountId, brandId, opportunityId });
    return { ideaId: "idea-linked", opportunityId, status: "developing", reused: false };
  }
}

async function setup() {
  const store = new MemoryKairoRepository();
  const verifier = new Verifier();
  const account = await store.resolveAccount({ provider: "test", subject: "alice" });
  const created = await store.createWorkspaceWithBrand(account.id, { workspaceName: "Studio", brandName: "Kairo" });
  await store.putConfirmedBrandBrainField(account.id, created.brand.id, "identity.description", { section: "identity", value: "AI-assisted content intelligence for modern brands" });
  await store.putConfirmedBrandBrainField(account.id, created.brand.id, "identity.products-services", { section: "identity", value: "Brand intelligence and content discovery" });
  await store.putConfirmedBrandBrainField(account.id, created.brand.id, "audience.primary", { section: "audience", value: "Technical founders and marketing teams" });
  await store.putConfirmedBrandBrainField(account.id, created.brand.id, "positioning.value-proposition", { section: "positioning", value: "Turn trusted Brand context into relevant content opportunities" });
  await store.putConfirmedBrandBrainField(account.id, created.brand.id, "content.pillars", { section: "content-strategy", value: "AI agents, software architecture, content intelligence" });
  await store.putConfirmedBrandBrainField(account.id, created.brand.id, "boundaries.excluded-topics", { section: "boundaries", value: "Unverified claims" });
  await store.putConfirmedBrandBrainField(account.id, created.brand.id, "goal", { section: "goals", value: "Build authority" });
  const captured: HunterRunInput[] = [];
  const runner: HunterRecommendationRunner = {
    async runForAuthorizedBrand(input) {
      captured.push(input);
      return { evidenceCount: 2, candidateCount: 1, opportunityCount: 1 };
    },
  };
  const closedLoop = new ClosedLoopFixture();
  const app = buildApp({ store, identityVerifier: verifier });
  registerHunterRecommendationRoutes(app, { store, identityVerifier: verifier, runner, closedLoopStore: closedLoop });
  return { app, store, account, brand: created.brand, captured, closedLoop };
}

const auth = { authorization: "Bearer test:alice" };

describe("VS-104 closed-loop routes", () => {
  it("feeds accepted learning and prior feedback into the Brand-private Hunter context", async () => {
    const context = await setup();
    const response = await context.app.inject({ method: "POST", url: `/api/v1/brands/${context.brand.id}/recommendations`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(context.captured).toHaveLength(1);
    expect(context.captured[0]?.brand.goals).toContain("Build authority");
    expect(context.captured[0]?.brand.goals).toContain("Closed-loop learning");
    expect(context.captured[0]?.brand.goals).toContain("carousel explainers earn more saves");
    expect(context.captured[0]?.brand.goals).toContain("dismissed: generic AI news");
    await context.app.close();
  });

  it("persists seen and dismissed feedback through the Brand-scoped API", async () => {
    const context = await setup();
    for (const action of ["seen", "dismissed"] as const) {
      const response = await context.app.inject({
        method: "POST",
        url: `/api/v1/brands/${context.brand.id}/opportunities/opportunity-1/feedback/${action}`,
        headers: auth,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ opportunityId: "opportunity-1", action });
    }
    expect(context.closedLoop.feedback.map((item) => item.action)).toEqual(["seen", "dismissed"]);
    await context.app.close();
  });

  it("creates the opportunity-linked development entry through the same tenant boundary", async () => {
    const context = await setup();
    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/brands/${context.brand.id}/opportunities/opportunity-1/development`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ideaId: "idea-linked", opportunityId: "opportunity-1", status: "developing", reused: false });

    const forbidden = await context.app.inject({
      method: "POST",
      url: `/api/v1/brands/${context.brand.id}/opportunities/opportunity-1/development`,
      headers: { authorization: "Bearer test:bob" },
    });
    expect(forbidden.statusCode).toBe(404);
    expect(context.closedLoop.developments).toHaveLength(1);
    await context.app.close();
  });
});
