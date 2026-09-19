import { describe, expect, it } from "vitest";
import { AI_PRESENTATION_POLICY, presentAiText, presentCampaignCopy, presentOpportunityCopy } from "./ai-presentation";

describe("shared AI presentation policy", () => {
  it("keeps display copy concise while preserving the useful sentence", () => {
    const value = "AI-generated media is exploding in 2026, and audiences are eager for quick, visually engaging cooking content. Produce a series of AI-assisted cooking videos that demonstrate traditional Maltese recipes using Gemini and Google Flow.";
    const result = presentAiText(value, "action");

    expect(result).toContain("Produce a series");
    expect(result.split(/\s+/).length).toBeLessThanOrEqual(AI_PRESENTATION_POLICY.action.maxWords);
    expect(result.length).toBeLessThanOrEqual(AI_PRESENTATION_POLICY.action.maxChars + 1);
  });

  it("removes markdown noise and constrains long titles", () => {
    const result = presentAiText("## **How to Make AI Cooking Videos for Free With Gemini and Google Flow for Lovin Malta Readers Everywhere**", "title");
    expect(result).not.toMatch(/[*#]/);
    expect(result.split(/\s+/).length).toBeLessThanOrEqual(AI_PRESENTATION_POLICY.title.maxWords);
  });

  it("projects opportunity copy through one role-based policy", () => {
    const copy = presentOpportunityCopy({
      title: "How to Make AI Cooking Videos for Free With Gemini and Google Flow",
      rationale: "The article provides a step-by-step guide to creating realistic AI-generated cooking videos using Gemini, Google Flow and free tools. This can support useful local food content.",
      whyNow: "AI-generated media is exploding in 2026. Local publishers can use accessible tools now.",
      developmentDirection: "Produce a series of AI-assisted cooking videos that demonstrate traditional Maltese recipes, then publish them with short written recipe guides.",
      audience: "Readers in Malta who enjoy local food, recipes and practical digital content.",
    });

    expect(copy.title.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(copy.fit.split(/\s+/).length).toBeLessThanOrEqual(18);
    expect(copy.timing.split(/\s+/).length).toBeLessThanOrEqual(18);
    expect(copy.action.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(copy.audience.split(/\s+/).length).toBeLessThanOrEqual(14);
  });

  it("uses the same policy for campaign metadata", () => {
    const copy = presentCampaignCopy({
      name: "A Very Long Campaign Name About Maltese Summer Food Stories and AI Video Experiments for Social Media",
      objective: "Increase engagement and audience interest by publishing a coordinated set of useful local stories across social channels.",
      audience: "People in Malta who follow local food, entertainment, travel and lifestyle stories.",
      message: "A long generated explanation that should become concise for campaign cards while the raw content remains stored elsewhere.",
      cta: "Read the full story and share it with somebody who would enjoy it.",
    });

    expect(copy.name.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(copy.objective.split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(copy.cta.split(/\s+/).length).toBeLessThanOrEqual(10);
  });
});
