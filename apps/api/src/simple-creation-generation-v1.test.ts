import { describe, expect, it } from "vitest";
import { appendContentVersion, type Campaign, type ContentAsset, type ContentVersion } from "@kairo/domain/campaign";
import type { CampaignDetail, CampaignRepository, ContentGenerationPort } from "@kairo/domain/campaign-service";
import type { Idea, ResearchDossier, Angle } from "@kairo/domain/research";
import type { ResearchRepository } from "@kairo/domain/research-service";
import type { ContentReview } from "@kairo/domain/review";
import type { BrandPresenterDto } from "@kairo/contracts/presenter";
import type { IdeaDevelopmentPort } from "./app";
import {
  SimpleCreationService,
  type SimpleCreationRequest,
  type SimpleCreationReviewPort,
  type SimpleCreationStore,
} from "./simple-creation";

const now = () => new Date("2026-09-05T12:00:00.000Z");

describe("Create with Kairo generation v1", () => {
  it("uses the persisted Opportunity Concept Mockup premise as the Drafter creative brief", async () => {
    const harness = createHarness({ critic: "passed" });
    harness.research.seedOpportunity({
      accountId: "account-a",
      premise: [
        "Turn the Hunter signal into a practical carousel.",
        "Concept brief:",
        "Format: carousel",
        "Hook: Three costly mistakes most teams still make",
        "Visual direction: clean comparison cards",
        "CTA: Save this before your next planning session",
      ].join("\n"),
    });

    const created = await harness.service.start("account-a", "workspace-a", "brand-a", {
      goal: "Develop this recommendation",
      input: "This UI summary must not replace the persisted concept brief",
      contentPreference: "carousel",
      ideaId: "idea-opportunity",
    });

    expect(await harness.service.runOnce("worker-a")).toBe(true);
    expect(harness.generator.seeds).toHaveLength(1);
    expect(harness.generator.seeds[0]).toContain("Creative brief:\nTurn the Hunter signal into a practical carousel.");
    expect(harness.generator.seeds[0]).toContain("Hook: Three costly mistakes most teams still make");
    expect(harness.generator.seeds[0]).toContain("Visual direction: clean comparison cards");
    expect(harness.generator.seeds[0]).not.toContain("This UI summary must not replace");
    expect(harness.store.row(created.id)?.status).toBe("ready");
  });

  it("preserves custom-idea creation through Researcher -> Strategist -> Drafter", async () => {
    const harness = createHarness({ critic: "passed" });
    const created = await harness.service.start("account-a", "workspace-a", "brand-a", {
      goal: "Explain why reliable AI workflows need evidence",
      input: "Make it useful for software architects",
      source: "https://example.com/reference",
      contentPreference: "image",
    });

    expect(await harness.service.runOnce("worker-a")).toBe(true);
    expect(harness.developedIdeas).toHaveLength(1);
    expect(harness.generator.seeds[0]).toContain("Creative brief:\nExplain why reliable AI workflows need evidence");
    expect(harness.generator.seeds[0]).toContain("Input: Make it useful for software architects");
    expect(harness.generator.seeds[0]).toContain("Source: https://example.com/reference");
    expect(harness.store.row(created.id)?.status).toBe("ready");
  });

  it.each([
    ["passed", "passed", 92],
    ["revision-required", "revision-required", 61],
    ["runtime-failure", "unavailable", undefined],
  ] as const)("keeps generated content usable when Critic outcome is %s", async (criticMode, expectedStatus, expectedScore) => {
    const harness = createHarness({ critic: criticMode });
    harness.research.seedOpportunity({ accountId: "account-a", premise: "Concept brief:\nHook: Evidence before hype" });
    const created = await harness.service.start("account-a", "workspace-a", "brand-a", {
      goal: "Develop",
      contentPreference: "carousel",
      ideaId: "idea-opportunity",
    });

    expect(await harness.service.runOnce("worker-a")).toBe(true);
    const row = harness.store.row(created.id)!;
    const critic = (row.recommendation?.critic ?? {}) as { status?: string; score?: number };
    expect(row.status).toBe("ready");
    expect(row.assetId).toBeTruthy();
    expect(critic.status).toBe(expectedStatus);
    if (expectedScore === undefined) expect(critic).not.toHaveProperty("score");
    else expect(critic.score).toBe(expectedScore);
    expect(harness.reviewer.calls).toHaveLength(1);
  });

  it("rejects an Opportunity Idea owned by another account before creating any request", async () => {
    const harness = createHarness({ critic: "passed" });
    harness.research.seedOpportunity({ accountId: "account-owner", premise: "Private concept brief" });

    await expect(harness.service.start("account-intruder", "workspace-a", "brand-a", {
      goal: "Develop",
      contentPreference: "carousel",
      ideaId: "idea-opportunity",
    })).rejects.toThrow("Idea not found");

    expect(harness.store.rows).toHaveLength(0);
    expect(harness.generator.seeds).toHaveLength(0);
    expect(harness.reviewer.calls).toHaveLength(0);
  });
});

function createHarness(options: { critic: "passed" | "revision-required" | "runtime-failure" }) {
  const store = new MemoryCreationStore();
  const research = new MemoryResearchRepository();
  const campaigns = new MemoryCampaignRepository();
  const generator = new CapturingGenerator();
  const reviewer = new StubReviewer(options.critic);
  const developedIdeas: string[] = [];
  const developer: IdeaDevelopmentPort = {
    develop: async (input) => {
      developedIdeas.push(input.idea.id);
      research.develop(input.accountId, input.idea.id);
    },
  };
  const service = new SimpleCreationService(
    store,
    research,
    campaigns,
    developer,
    now,
    undefined,
    generator,
    undefined,
    reviewer,
  );
  return { store, research, campaigns, generator, reviewer, developedIdeas, service };
}

class MemoryCreationStore implements SimpleCreationStore {
  rows: SimpleCreationRequest[] = [];
  async create(value: SimpleCreationRequest) { this.rows.push(structuredClone(value)); return value; }
  async get(accountId: string, brandId: string, id: string) { return this.rows.find((row) => row.accountId === accountId && row.brandId === brandId && row.id === id) ?? null; }
  async claim() { return this.rows.find((row) => row.status !== "ready" && row.status !== "needs-attention") ?? null; }
  async advance(id: string, _workerId: string, status: SimpleCreationRequest["status"], patch: Partial<SimpleCreationRequest> = {}) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error("Creation not found");
    this.rows[index] = { ...this.rows[index]!, ...structuredClone(patch), status, updatedAt: now().toISOString() };
  }
  async getPresenter() { return null; }
  async putPresenter(value: BrandPresenterDto) { return value; }
  row(id: string) { return this.rows.find((row) => row.id === id); }
}

type StoredBundle = {
  accountId: string;
  idea: Idea;
  research: ResearchDossier | null;
  angles: Angle[];
};

class MemoryResearchRepository implements ResearchRepository {
  private bundles = new Map<string, StoredBundle>();

  seedOpportunity(input: { accountId: string; premise: string }) {
    const idea: Idea = {
      id: "idea-opportunity",
      workspaceId: "workspace-a",
      brandId: "brand-a",
      title: "Hunter opportunity",
      premise: input.premise,
      source: { type: "opportunity", opportunityId: "opportunity-a" },
      status: "angles-ready",
      createdAt: now().toISOString(),
    };
    this.bundles.set(idea.id, { accountId: input.accountId, idea, research: dossier(idea), angles: angles(idea) });
  }

  develop(accountId: string, ideaId: string) {
    const bundle = this.bundles.get(ideaId);
    if (!bundle || bundle.accountId !== accountId) throw new Error("Idea not found");
    bundle.research = dossier(bundle.idea);
    bundle.angles = angles(bundle.idea);
    bundle.idea.status = "angles-ready";
  }

  async createIdea(accountId: string, idea: Idea) {
    this.bundles.set(idea.id, { accountId, idea: structuredClone(idea), research: null, angles: [] });
    return idea;
  }
  async listIdeas(accountId: string, brandId: string) {
    return [...this.bundles.values()].filter((bundle) => bundle.accountId === accountId && bundle.idea.brandId === brandId).map((bundle) => bundle.idea);
  }
  async getIdeaBundle(accountId: string, brandId: string, ideaId: string) {
    const bundle = this.bundles.get(ideaId);
    if (!bundle || bundle.accountId !== accountId || bundle.idea.brandId !== brandId) return null;
    return { idea: bundle.idea, research: bundle.research, angles: bundle.angles };
  }
  async selectAngle(accountId: string, brandId: string, ideaId: string, angleId: string) {
    const bundle = this.bundles.get(ideaId);
    if (!bundle || bundle.accountId !== accountId || bundle.idea.brandId !== brandId) throw new Error("Idea not found");
    bundle.angles = bundle.angles.map((angle) => ({ ...angle, status: angle.id === angleId ? "selected" : "candidate" }));
    return bundle.angles;
  }
  async editAngleFraming(
    accountId: string,
    brandId: string,
    ideaId: string,
    angleId: string,
    framing: string,
    expectedVersion: number,
  ) {
    const bundle = this.bundles.get(ideaId);
    if (!bundle || bundle.accountId !== accountId || bundle.idea.brandId !== brandId) throw new Error("Idea not found");
    const index = bundle.angles.findIndex((angle) => angle.id === angleId);
    if (index < 0) throw new Error("Angle not found");
    const current = bundle.angles[index]!;
    if (current.version !== expectedVersion) throw new Error("stale");
    const updated: Angle = { ...current, framing, version: current.version + 1 };
    bundle.angles[index] = updated;
    return updated;
  }
}

class MemoryCampaignRepository implements CampaignRepository {
  private entries = new Map<string, { accountId: string; detail: CampaignDetail }>();

  async saveCampaign(accountId: string, campaign: Campaign) {
    this.entries.set(campaign.id, { accountId, detail: { campaign, assets: [] } });
    return campaign;
  }
  async listCampaigns(accountId: string, brandId: string) {
    return [...this.entries.values()].filter((entry) => entry.accountId === accountId && entry.detail.campaign.brandId === brandId).map((entry) => entry.detail.campaign);
  }
  async getCampaign(accountId: string, brandId: string, campaignId: string) {
    const entry = this.entries.get(campaignId);
    return entry && entry.accountId === accountId && entry.detail.campaign.brandId === brandId ? entry.detail : null;
  }
  async saveAssetWithVersion(accountId: string, asset: ContentAsset, version: ContentVersion) {
    const entry = this.entries.get(asset.campaignId);
    if (!entry || entry.accountId !== accountId) throw new Error("Campaign not found");
    entry.detail.assets.push({ asset: { ...asset, currentVersion: version.version }, versions: [version] });
    return entry.detail;
  }
  async appendVersion(
    accountId: string,
    brandId: string,
    campaignId: string,
    assetId: string,
    expectedVersion: number,
    build: (asset: ContentAsset, parent: ContentVersion) => ContentVersion,
  ) {
    const entry = this.entries.get(campaignId);
    if (!entry || entry.accountId !== accountId || entry.detail.campaign.brandId !== brandId) throw new Error("Campaign not found");
    const assetEntry = entry.detail.assets.find((candidate) => candidate.asset.id === assetId);
    if (!assetEntry) throw new Error("Asset not found");
    const parent = assetEntry.versions.at(-1)!;
    if (parent.version !== expectedVersion) throw new Error("stale");
    const next = build(assetEntry.asset, parent);
    assetEntry.versions.push(next);
    assetEntry.asset = { ...assetEntry.asset, currentVersion: next.version };
    return entry.detail;
  }
}

class CapturingGenerator implements ContentGenerationPort {
  seeds: string[] = [];
  private sequence = 0;
  async generate(input: Parameters<ContentGenerationPort["generate"]>[0]) {
    this.seeds.push(input.parent.content);
    this.sequence += 1;
    return appendContentVersion({
      id: `generated-${this.sequence}`,
      asset: input.asset,
      parent: input.parent,
      expectedVersion: input.parent.version,
      content: "Generated Kairo draft",
      supportingClaimIds: input.parent.supportingClaimIds,
      actor: "ai",
      action: input.action,
      createdAt: now().toISOString(),
    });
  }
}

class StubReviewer implements SimpleCreationReviewPort {
  calls: Array<{ accountId: string; brandId: string; campaignId: string; assetId: string; expectedVersion: number }> = [];
  constructor(private mode: "passed" | "revision-required" | "runtime-failure") {}
  async review(
    accountId: string,
    brandId: string,
    campaignId: string,
    assetId: string,
    input: { expectedVersion: number; brandContextVersion: string; revisionCycle: number },
  ): Promise<ContentReview> {
    this.calls.push({ accountId, brandId, campaignId, assetId, expectedVersion: input.expectedVersion });
    if (this.mode === "runtime-failure") throw new Error("critic runtime unavailable");
    const passed = this.mode === "passed";
    return {
      id: `review-${this.mode}`,
      workspaceId: "workspace-a",
      brandId,
      campaignId,
      assetId,
      versionId: "generated-1",
      version: input.expectedVersion,
      status: passed ? "passed" : "revision-required",
      truth: {
        workspaceId: "workspace-a",
        brandId,
        campaignId,
        assetId,
        versionId: "generated-1",
        version: input.expectedVersion,
        passed: true,
        findings: [],
      },
      revisionCycle: input.revisionCycle,
      requestedAt: now().toISOString(),
      completedAt: now().toISOString(),
      critic: {
        passed,
        score: passed ? 92 : 61,
        findings: passed ? [] : [{ code: "hook-quality", severity: "revision", message: "Strengthen the opening." }],
      },
    };
  }
}

function dossier(idea: Idea): ResearchDossier {
  return {
    id: `research-${idea.id}`,
    workspaceId: idea.workspaceId,
    brandId: idea.brandId,
    ideaId: idea.id,
    summary: "Research-backed direction",
    evidence: [],
    claims: [],
    unresolvedUncertainties: [],
    status: "ready",
    createdAt: now().toISOString(),
  };
}

function angles(idea: Idea): Angle[] {
  return [
    {
      id: `angle-primary-${idea.id}`,
      workspaceId: idea.workspaceId,
      brandId: idea.brandId,
      ideaId: idea.id,
      title: "Primary direction",
      framing: "Evidence-first framing",
      audience: "Software leaders",
      objective: "Teach one practical lesson",
      hookDirection: "Lead with the costly mistake",
      expectedValue: "Useful and actionable",
      effort: "medium",
      recommendedFormat: "carousel",
      recommendedChannel: "instagram",
      supportingClaimIds: [],
      status: "candidate",
      version: 1,
    },
    {
      id: `angle-secondary-${idea.id}`,
      workspaceId: idea.workspaceId,
      brandId: idea.brandId,
      ideaId: idea.id,
      title: "Secondary direction",
      framing: "Checklist framing",
      audience: "Software leaders",
      objective: "Offer a reusable checklist",
      hookDirection: "Open with a checklist",
      expectedValue: "Easy to save",
      effort: "low",
      recommendedFormat: "image",
      recommendedChannel: "instagram",
      supportingClaimIds: [],
      status: "candidate",
      version: 1,
    },
  ];
}
