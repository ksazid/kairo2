import { describe, expect, it } from "vitest";
import { HUNTER_EEI_POLICY, HUNTER_EEI_VERSION, applyHunterEEIRerank } from "./hunter-eei";

const scores = {
  relevance: 0.9,
  evidence: 0.85,
  novelty: 0.8,
  timeliness: 0.8,
  brandAuthority: 0.75,
  audienceFit: 0.9,
};

function item(title: string, topic: string, risks = {}) {
  return {
    candidate: { title, topic, engagementRisks: risks },
    source: { sourceUrl: "https://example.com/" + title.toLowerCase().replace(/\s+/g, "-") },
    scores,
    overall: 0.84,
    topic,
  };
}

describe("Hunter EEI runtime boundary", () => {
  it("uses only user-value optimization objectives", () => {
    expect(HUNTER_EEI_VERSION).toBe("hunter-eei-v1");
    expect(HUNTER_EEI_POLICY.optimizationObjectives).toContain("publish");
    expect(HUNTER_EEI_POLICY.optimizationObjectives).not.toContain("time-in-app");
    expect(HUNTER_EEI_POLICY.optimizationObjectives).not.toContain("notification-opens");
  });

  it("blocks an opportunity that explicitly relies on manipulation", () => {
    const safe = item("Useful architecture guide", "architecture");
    const unsafe = item("Fear-driven urgency", "architecture", { fearOrAnxietyExploitation: true });
    expect(applyHunterEEIRerank([unsafe, safe]).map((value) => value.candidate.title)).toEqual([
      "Useful architecture guide",
    ]);
  });

  it("bounds topic concentration in the final recommendation set", () => {
    const input = [
      item("A1", "agents"), item("A2", "agents"), item("A3", "agents"),
      item("B1", "cloud"), item("C1", "architecture"), item("D1", "testing"),
    ];
    const ranked = applyHunterEEIRerank(input, { maxCandidates: 6 });
    expect(ranked.filter((value) => value.topic === "agents").length).toBeLessThanOrEqual(2);
    expect(ranked.some((value) => value.topic === "cloud")).toBe(true);
  });
});
