import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canExecuteMarketingSkill,
  canRunMarketingSkillInBenchmark,
  validateMarketingSkillManifest,
  type MarketingSkillManifest,
} from "@kairo/domain/skill-registry";

const config = JSON.parse(
  readFileSync(
    new URL("../../../evaluation/marketing-lab/charlie-social-skills-shadow.json", import.meta.url),
    "utf8",
  ),
) as {
  schemaVersion: number;
  upstream: { repository: string; commitSha: string; license: string };
  manifests: MarketingSkillManifest[];
};

describe("Charlie social-media-skills shadow preflight", () => {
  it("pins the reviewed upstream repository and commit", () => {
    expect(config.schemaVersion).toBe(1);
    expect(config.upstream).toEqual({
      repository: "charlie947/social-media-skills",
      commitSha: "8cefb5b6d03757885faa6918bd8bfaef202a83db",
      license: "MIT",
    });
  });

  it("keeps every imported pattern evaluation-only and non-executable in production", () => {
    expect(config.manifests).toHaveLength(4);
    for (const raw of config.manifests) {
      const manifest = validateMarketingSkillManifest(raw);
      expect(manifest.executionMode).toBe("sandboxed");
      expect(manifest.status).toBe("evaluation");
      expect(manifest.benchmarkStatus).toBe("shadow");
      expect(manifest.permissions).toEqual({
        network: false,
        secrets: false,
        brandPrivateContext: true,
        publishing: false,
      });
      expect(canRunMarketingSkillInBenchmark(manifest, "shadow")).toBe(true);
      expect(canRunMarketingSkillInBenchmark(manifest, "live")).toBe(false);
      expect(canExecuteMarketingSkill(manifest)).toBe(false);
    }
  });

  it("maps only reviewed skills to Kairo capabilities", () => {
    const capabilities = new Map(
      config.manifests.map((manifest) => [manifest.id, manifest.capabilities]),
    );
    expect(capabilities.get("charlie-content-matrix-shadow")).toEqual([
      "content-strategy",
      "social-strategy",
    ]);
    expect(capabilities.get("charlie-hook-generator-shadow")).toEqual([
      "hook-strategy",
    ]);
    expect(capabilities.get("charlie-gemini-carousel-shadow")).toEqual([
      "carousel-strategy",
    ]);
    expect(capabilities.get("charlie-reels-scripting-shadow")).toEqual([
      "reel-strategy",
    ]);
  });

  it("pins the exact reviewed Git blob for each skill", () => {
    const pins = Object.fromEntries(
      config.manifests.map((manifest) => [
        manifest.id,
        manifest.source.kind === "github"
          ? {
              path: manifest.source.path,
              blob: manifest.source.contentHash,
            }
          : null,
      ]),
    );
    expect(pins).toEqual({
      "charlie-content-matrix-shadow": {
        path: "skills/content-matrix/SKILL.md",
        blob: "7e03b865c1754fc54941bf714fd24db754be72dd",
      },
      "charlie-hook-generator-shadow": {
        path: "skills/hook-generator/SKILL.md",
        blob: "ccfecdc8d30b282ce359dfe96750735b2bae2435",
      },
      "charlie-gemini-carousel-shadow": {
        path: "skills/gemini-carousel/SKILL.md",
        blob: "1f6bd521c2fe6813d1c11477a0c6565ca375b9a2",
      },
      "charlie-reels-scripting-shadow": {
        path: "skills/reels-scripting/SKILL.md",
        blob: "75d054e468b12c95a76a8ebef4a1ae78d18bcf18",
      },
    });
  });
});
