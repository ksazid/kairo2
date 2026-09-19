import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./index";
import {
  canExecuteMarketingSkill,
  createBrandSkillSelection,
  createMarketingSkillRegistry,
  type MarketingSkillManifest,
  type SkillSourceRef,
} from "./skill-registry";

function nativeSkill(): MarketingSkillManifest {
  return {
    id: "kairo-native-strategy",
    version: "1.0.0",
    name: "Kairo Native Strategy",
    capabilities: ["content-strategy", "hook-strategy", "carousel-strategy", "reel-strategy"],
    source: { kind: "kairo-native" },
    executionMode: "native",
    permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
    status: "approved",
    benchmarkStatus: "baseline",
  };
}

function coreyReference(): MarketingSkillManifest {
  return {
    id: "corey-social-reference",
    version: "7868cb9",
    name: "Corey Haines Social Reference",
    capabilities: ["social-strategy", "hook-strategy", "carousel-strategy", "reel-strategy"],
    source: {
      kind: "github",
      repository: "coreyhaines31/marketingskills",
      commitSha: "7868cb9251fad80a73d26e488a5ad5f6c4a9f335",
      path: "skills/social/SKILL.md",
      contentHash: "ab1dc1c34cb5b09a2bfb70b318a64eaab596af43",
      license: "MIT",
    },
    executionMode: "reference-only",
    permissions: { network: false, secrets: false, brandPrivateContext: false, publishing: false },
    status: "evaluation",
    benchmarkStatus: "pending",
  };
}

function coreyGithubSource(): Extract<SkillSourceRef, { kind: "github" }> {
  const source = coreyReference().source;
  if (source.kind !== "github") throw new Error("fixture must be GitHub-backed");
  return source;
}

describe("VS-14 marketing skill registry", () => {
  it("keeps Kairo Native executable while reference-only challengers remain non-executable", () => {
    expect(canExecuteMarketingSkill(nativeSkill())).toBe(true);
    expect(canExecuteMarketingSkill(coreyReference())).toBe(false);
  });

  it("requires exact immutable GitHub provenance for external challengers", () => {
    const reference = coreyReference();
    const source = coreyGithubSource();
    const badCommit: MarketingSkillManifest = { ...reference, source: { ...source, commitSha: "main" } };
    const badHash: MarketingSkillManifest = { ...reference, source: { ...source, contentHash: "missing" } };
    expect(() => createMarketingSkillRegistry([badCommit])).toThrow(DomainValidationError);
    expect(() => createMarketingSkillRegistry([badHash])).toThrow(DomainValidationError);
  });

  it("indexes candidates by capability without making evaluation status executable", () => {
    const registry = createMarketingSkillRegistry([nativeSkill(), coreyReference()]);
    expect(registry.listByCapability("carousel-strategy").map((item) => item.id)).toEqual(["kairo-native-strategy", "corey-social-reference"]);
    expect(registry.executableByCapability("carousel-strategy").map((item) => item.id)).toEqual(["kairo-native-strategy"]);
  });

  it("rejects duplicate skill id/version registrations", () => {
    expect(() => createMarketingSkillRegistry([nativeSkill(), nativeSkill()])).toThrow(DomainValidationError);
  });

  it("does not allow an external challenger to become a Brand selection before Brand qualification", () => {
    expect(() => createBrandSkillSelection({
      workspaceId: "ws-1",
      brandId: "brand-1",
      capability: "carousel-strategy",
      format: "carousel",
      skill: coreyReference(),
      qualification: {
        verdict: "advance-to-shadow",
        workspaceId: "ws-1",
        brandId: "brand-1",
        capability: "carousel-strategy",
        format: "carousel",
        challengerSkillId: "corey-social-reference",
        challengerSkillVersion: "7868cb9",
      },
      selectedAt: "2026-08-15T03:40:00+02:00",
    })).toThrow(DomainValidationError);
  });

  it("permits a pinned challenger selection only when qualification matches Brand, capability, format and version", () => {
    const qualified = { ...coreyReference(), executionMode: "sandboxed" as const, status: "approved" as const, benchmarkStatus: "qualified" as const };
    expect(createBrandSkillSelection({
      workspaceId: "ws-1",
      brandId: "brand-1",
      capability: "carousel-strategy",
      format: "carousel",
      skill: qualified,
      qualification: {
        verdict: "qualified-for-brand",
        workspaceId: "ws-1",
        brandId: "brand-1",
        capability: "carousel-strategy",
        format: "carousel",
        challengerSkillId: "corey-social-reference",
        challengerSkillVersion: "7868cb9",
      },
      selectedAt: "2026-08-15T03:40:00+02:00",
    })).toMatchObject({ brandId: "brand-1", skillId: "corey-social-reference", skillVersion: "7868cb9" });

    expect(() => createBrandSkillSelection({
      workspaceId: "ws-1",
      brandId: "brand-1",
      capability: "carousel-strategy",
      format: "carousel",
      skill: qualified,
      qualification: {
        verdict: "qualified-for-brand",
        workspaceId: "ws-1",
        brandId: "brand-1",
        capability: "carousel-strategy",
        format: "carousel",
        challengerSkillId: "corey-social-reference",
        challengerSkillVersion: "different-version",
      },
      selectedAt: "2026-08-15T03:40:00+02:00",
    })).toThrow(DomainValidationError);
  });
});
