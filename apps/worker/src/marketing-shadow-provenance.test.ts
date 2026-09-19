import { describe, expect, it } from "vitest";
import type { MarketingSkillManifest } from "@kairo/domain/skill-registry";
import { gitBlobSha, verifyPinnedSkillSnapshot } from "./marketing-shadow";

const byteExactContent = "skill body\n";
const byteExactBlob = "50f34246284ea63a2031767a131b178515d8c70b";
const manifest: MarketingSkillManifest = {
  id: "byte-exact-shadow",
  version: "1",
  name: "Byte Exact Shadow",
  capabilities: ["carousel-strategy"],
  source: {
    kind: "github",
    repository: "example/byte-exact",
    commitSha: "2222222222222222222222222222222222222222",
    path: "SKILL.md",
    contentHash: byteExactBlob,
    license: "MIT",
  },
  executionMode: "sandboxed",
  permissions: { network: false, secrets: false, brandPrivateContext: true, publishing: false },
  status: "evaluation",
  benchmarkStatus: "shadow",
};

describe("byte-exact skill snapshot provenance", () => {
  it("preserves final newlines because Git blob identity is byte exact", () => {
    expect(gitBlobSha(byteExactContent)).toBe(byteExactBlob);
    const verified = verifyPinnedSkillSnapshot(manifest, {
      repository: "example/byte-exact",
      commitSha: "2222222222222222222222222222222222222222",
      path: "SKILL.md",
      blobSha: byteExactBlob,
      content: byteExactContent,
    });
    expect(verified.content).toBe(byteExactContent);
  });
});
