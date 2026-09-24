import { describe, expect, it } from "vitest";
import {
  HUNTER_SCORE_CALIBRATION_VERSION,
  buildHunterScoreCalibrationSamples,
  evaluateHunterScoreCalibration,
  type HunterScoreCalibrationSample,
} from "./hunter-quality";

describe("Hunter score calibration", () => {
  it("builds a shadow sample without changing the candidate", () => {
    const candidate = {
      sourceUrl: "https://example.com/story",
      title: "Useful mobility update",
      rationale: "Relevant to the audience",
      whyNow: "Published recently",
      developmentDirection: "Explain the practical impact",
      scores: {
        relevance: 0.82,
        evidence: 0.86,
        novelty: 0.74,
        timeliness: 0.91,
        brandAuthority: 0.78,
        audienceFit: 0.80,
      },
    };
    const original = structuredClone(candidate);

    const samples = buildHunterScoreCalibrationSamples([candidate], {
      evidenceByUrl: new Map([[
        candidate.sourceUrl,
        {
          title: candidate.title,
          summary: "A sufficiently detailed source summary for evidence-quality scoring.",
          sourceUrl: candidate.sourceUrl,
          platform: "news",
          publisher: "Example Publisher",
          publishedAt: "2026-09-23T10:00:00.000Z",
          retrievedAt: "2026-09-24T10:00:00.000Z",
          provider: "test",
          providerVersion: "1",
          contentHash: "abc123",
        },
      ]]),
      documentsByUrl: new Map(),
      referenceTime: "2026-09-24T10:00:00.000Z",
    });

    expect(candidate).toEqual(original);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.schemaVersion).toBe(HUNTER_SCORE_CALIBRATION_VERSION);
    expect(samples[0]?.model).toEqual(candidate.scores);
    expect(samples[0]?.proxy.evidence).toBeTypeOf("number");
    expect(samples[0]?.proxy.timeliness).toBeTypeOf("number");
    expect(samples[0]?.adjusted).not.toBe(candidate.scores);
  });

  it("reports model optimism and qualification flips", () => {
    const samples: HunterScoreCalibrationSample[] = [
      {
        schemaVersion: HUNTER_SCORE_CALIBRATION_VERSION,
        model: {
          relevance: 0.9,
          evidence: 0.9,
          novelty: 0.9,
          timeliness: 0.9,
          brandAuthority: 0.9,
          audienceFit: 0.9,
        },
        proxy: {
          relevance: 0.5,
          evidence: 0.5,
          novelty: 0.5,
          timeliness: 0.5,
          brandAuthority: 0.5,
          audienceFit: 0.5,
        },
        adjusted: {
          relevance: 0.55,
          evidence: 0.45,
          novelty: 0.6,
          timeliness: 0.6,
          brandAuthority: 0.55,
          audienceFit: 0.55,
        },
        modelQualifies: true,
        adjustedQualifies: false,
      },
      {
        schemaVersion: HUNTER_SCORE_CALIBRATION_VERSION,
        model: {
          relevance: 0.6,
          evidence: 0.6,
          novelty: 0.6,
          timeliness: 0.6,
          brandAuthority: 0.6,
          audienceFit: 0.6,
        },
        proxy: {
          relevance: 0.6,
          evidence: 0.6,
          novelty: 0.6,
          timeliness: 0.6,
          brandAuthority: 0.6,
          audienceFit: 0.6,
        },
        adjusted: {
          relevance: 0.7,
          evidence: 0.7,
          novelty: 0.7,
          timeliness: 0.7,
          brandAuthority: 0.7,
          audienceFit: 0.7,
        },
        modelQualifies: false,
        adjustedQualifies: true,
      },
    ];

    const report = evaluateHunterScoreCalibration(samples);

    expect(report.sampleCount).toBe(2);
    expect(report.qualificationFlipRate).toBe(1);
    expect(report.modelOnlyQualificationCount).toBe(1);
    expect(report.adjustedOnlyQualificationCount).toBe(1);
    expect(report.dimensions.relevance.meanSignedError).toBe(0.2);
    expect(report.dimensions.relevance.meanAbsoluteError).toBe(0.2);
    expect(report.dimensions.relevance.largeDisagreementRate).toBe(0.5);
  });

  it("handles an empty benchmark deterministically", () => {
    const report = evaluateHunterScoreCalibration([]);

    expect(report.sampleCount).toBe(0);
    expect(report.qualificationFlipRate).toBe(0);
    expect(report.dimensions.evidence.count).toBe(0);
  });
});
