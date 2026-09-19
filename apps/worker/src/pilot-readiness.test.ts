import { describe, expect, it } from "vitest";
import { runDeterministicPilotMatrix, type PilotSector } from "./pilot-readiness";

const sectors: PilotSector[] = [
  "ai-saas",
  "umrah-travel",
  "motorcycles",
  "ias-upsc",
];

describe("VS-21 deterministic pilot readiness matrix", () => {
  it("proves the approved V1 lineage across all four proof sectors and both rich Instagram formats", async () => {
    const report = await runDeterministicPilotMatrix();

    expect(report.status).toBe("pass");
    expect(report.scenarios).toHaveLength(4);
    expect(report.scenarios.map((scenario) => scenario.sector)).toEqual(sectors);
    expect(new Set(report.scenarios.map((scenario) => scenario.format))).toEqual(new Set(["carousel", "reel"]));

    for (const scenario of report.scenarios) {
      expect(scenario.status).toBe("pass");
      expect(scenario.mandatory.every((checkpoint) => checkpoint.status === "pass")).toBe(true);
      expect(scenario.external).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "auth0-live-callback", status: "external" }),
        expect.objectContaining({ id: "meta-live-publish-insights", status: "external" }),
      ]));
      expect(scenario.lineage.workspaceId).toBeTruthy();
      expect(scenario.lineage.brandId).toBeTruthy();
      expect(scenario.lineage.ideaId).toBeTruthy();
      expect(scenario.lineage.researchId).toBeTruthy();
      expect(scenario.lineage.angleId).toBeTruthy();
      expect(scenario.lineage.campaignId).toBeTruthy();
      expect(scenario.lineage.contentVersionId).toBeTruthy();
      expect(scenario.lineage.publishedPostId).toBeTruthy();
      expect(scenario.lineage.metricObservationIds.length).toBeGreaterThan(0);
      expect(scenario.lineage.learningId).toBeTruthy();
      expect(scenario.cost.maxModeledUsd).toBeLessThanOrEqual(0.5);
    }
  });

  it("fails closed when a second Brand attempts to reuse another Brand's generated private media", async () => {
    const report = await runDeterministicPilotMatrix({ injectCrossBrandReuse: true });
    expect(report.status).toBe("fail");
    const isolation = report.scenarios[0]?.mandatory.find((checkpoint) => checkpoint.id === "cross-brand-isolation");
    expect(isolation).toEqual(expect.objectContaining({ status: "fail", code: "cross-brand-media-reuse-rejected" }));
  });

  it("does not turn unavailable provider metrics into invented zeroes", async () => {
    const report = await runDeterministicPilotMatrix({ omitOptionalMetric: true });
    expect(report.status).toBe("pass");
    for (const scenario of report.scenarios) {
      const metric = scenario.metricSummary.find((item) => item.name === "saves");
      expect(metric).toEqual(expect.objectContaining({ status: "unavailable" }));
      expect(metric).not.toHaveProperty("value");
    }
  });

  it("keeps human approval as a mandatory checkpoint and never marks external provider smoke as deterministic PASS", async () => {
    const report = await runDeterministicPilotMatrix();
    for (const scenario of report.scenarios) {
      expect(scenario.mandatory).toContainEqual(expect.objectContaining({ id: "exact-version-human-approval", status: "pass" }));
      expect(scenario.external.every((checkpoint) => checkpoint.status === "external")).toBe(true);
    }
  });
});
