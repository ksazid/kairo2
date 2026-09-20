import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareAgentInvocation, type AgentRuntimePort, type JsonValue } from "@kairo/agent-contracts";
import {
  createMarketingSkillRegistry,
  type MarketingSkillManifest,
} from "@kairo/domain/skill-registry";
import {
  validateCarouselPlan,
  validateReelPlan,
  type MarketingCreativePlan,
} from "@kairo/domain/creative-formats";
import { DirectModelRuntime } from "./agent-runtime";
import { openAICompatibleGatewayFromEnv } from "./model-gateway";
import {
  MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION,
  MarketingShadowExecutionService,
  gitBlobSha,
  type MarketingShadowBenchmarkCase,
  type MarketingSkillSnapshot,
} from "./marketing-shadow";
import { evaluateMarketingShadowPair, validateMarketingShadowPairQualityEvaluation } from "./marketing-shadow-quality-evaluator";
import benchmarkData from "../../../evaluation/marketing-lab/benchmark-cases.json";
import shadowConfig from "../../../evaluation/marketing-lab/charlie-social-skills-shadow.json";

const live = process.env.KAIRO_CHARLIE_SHADOW_LIVE?.trim() === "1";

type Fixture = {
  id: string;
  sector: string;
  format: string;
  audience: string;
  objective: string;
  opportunity: string;
  claims: Array<{ id: string; text: string }>;
};

type PairResult = {
  caseId: string;
  format: "carousel" | "reel";
  native: {
    output: MarketingCreativePlan;
    latencyMs: number;
    costUsd: number;
  };
  charlie: {
    output: MarketingCreativePlan;
    latencyMs: number;
    costUsd: number;
    skillId: string;
  };
  evaluation: Awaited<ReturnType<typeof evaluateMarketingShadowPair>>;
};

const cases = (benchmarkData.cases as Fixture[]).filter((item) =>
  [
    "ai-carousel-01",
    "umrah-carousel-01",
    "motorcycle-carousel-01",
    "ias-carousel-01",
    "ai-reel-01",
    "umrah-reel-01",
    "motorcycle-reel-01",
    "ias-reel-01",
  ].includes(item.id),
);

const NATIVE_INSTRUCTION = [
  "Kairo Marketing Lab native baseline evaluation.",
  "Use only the supplied benchmark Claims and evidence context; never invent facts, experience, evidence, approvals or results.",
  MARKETING_CLOSED_WORLD_TRUTH_INSTRUCTION,
  "Do not use external marketing-skill reference material.",
  "Do not request tools, network access, credentials, publishing, policy changes or information outside the benchmark case.",
  "Return exactly one typed Claim-linked creative plan in the requested format.",
].join(" ");

describe.runIf(live)("Charlie social-media-skills live shadow benchmark", () => {
  it("runs eight paired Carousel/Reel cases and writes inspectable evidence", async () => {
    expect(cases).toHaveLength(8);

    const gateway = openAICompatibleGatewayFromEnv();
    if (!gateway) throw new Error("KAIRO LLM gateway secrets are not configured in this runner");

    const validators = {
      "marketing-carousel-plan@1": (value: unknown) => {
        try { validateCarouselPlan(value as never); return true; } catch { return false; }
      },
      "marketing-reel-plan@1": (value: unknown) => {
        try { validateReelPlan(value as never); return true; } catch { return false; }
      },
      "marketing-pair-quality-evaluation@1": (value: unknown) => {
        try { validateMarketingShadowPairQualityEvaluation(value); return true; } catch { return false; }
      },
    };

    const runtime = new DirectModelRuntime({
      gateway,
      policy: (request) => ({
        qualityTier: "balanced",
        privacyClass: "global-public",
        maxCostUsd: Math.min(request.budget.maxCostUsd, 0.02),
        maxOutputTokens: request.budget.maxOutputTokens,
        allowedProviders: [],
      }),
      validators,
    });

    const manifests = (shadowConfig.manifests as MarketingSkillManifest[]).filter((manifest) =>
      manifest.id === "charlie-gemini-carousel-shadow" ||
      manifest.id === "charlie-reels-scripting-shadow",
    );
    expect(manifests).toHaveLength(2);
    const registry = createMarketingSkillRegistry(manifests);

    const snapshots = new Map<string, MarketingSkillSnapshot>();
    for (const manifest of manifests) {
      if (manifest.source.kind !== "github") throw new Error("Charlie shadow source must be GitHub-pinned");
      const url =
        "https://raw.githubusercontent.com/" +
        manifest.source.repository +
        "/" +
        manifest.source.commitSha +
        "/" +
        manifest.source.path;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch pinned Charlie skill snapshot: " + response.status);
      const content = await response.text();
      if (gitBlobSha(content) !== manifest.source.contentHash) {
        throw new Error("Pinned Charlie skill snapshot Git blob hash mismatch");
      }
      snapshots.set(manifest.id, {
        repository: manifest.source.repository,
        commitSha: manifest.source.commitSha,
        path: manifest.source.path,
        blobSha: manifest.source.contentHash,
        content,
      });
    }

    const results: PairResult[] = [];
    for (const fixture of cases) {
      const benchmarkCase = toCase(fixture);
      const native = await executeNative(runtime, benchmarkCase);
      const skillId = fixture.format === "carousel"
        ? "charlie-gemini-carousel-shadow"
        : "charlie-reels-scripting-shadow";
      const snapshot = snapshots.get(skillId);
      if (!snapshot) throw new Error("Missing Charlie skill snapshot for " + skillId);

      const challenger = await new MarketingShadowExecutionService(runtime, registry, {
        maxCostUsd: 0.02,
        timeoutMs: 30_000,
        maxOutputTokens: 2_200,
      }).execute({
        challenger: {
          id: skillId,
          version: manifests.find((item) => item.id === skillId)!.version,
        },
        snapshot,
        benchmarkCase,
      });

      const evaluation = await evaluateMarketingShadowPair(runtime, {
        benchmarkCase,
        candidateA: native.output,
        candidateB: challenger.output,
      });

      results.push({
        caseId: fixture.id,
        format: fixture.format as "carousel" | "reel",
        native: {
          output: native.output,
          latencyMs: native.metadata.latencyMs,
          costUsd: native.metadata.costUsd ?? 0,
        },
        charlie: {
          output: challenger.output,
          latencyMs: challenger.metadata.latencyMs,
          costUsd: challenger.metadata.costUsd ?? 0,
          skillId,
        },
        evaluation,
      });
    }

    const evidence = {
      schemaVersion: 1,
      evidenceKind: "charlie-social-skills-live-shadow-poc",
      upstream: shadowConfig.upstream,
      dataPolicy: shadowConfig.dataPolicy,
      pairCount: results.length,
      summary: summarize(results),
      pairs: results,
    };

    mkdirSync("artifacts", { recursive: true });
    writeFileSync(
      "artifacts/charlie-social-shadow-live.json",
      JSON.stringify(evidence, null, 2) + "\n",
      "utf8",
    );
    console.log(JSON.stringify({
      marker: "KAIRO_CHARLIE_SOCIAL_SHADOW_COMPLETE",
      pairCount: results.length,
      summary: evidence.summary,
    }));

    expect(results).toHaveLength(8);
    expect(results.every((item) => item.evaluation.candidateA.truthPassed)).toBe(true);
  }, 300_000);
});

function toCase(fixture: Fixture): MarketingShadowBenchmarkCase {
  if (fixture.format !== "carousel" && fixture.format !== "reel") throw new Error("Unsupported benchmark format");
  const claims = fixture.claims.map((claim) => ({
    id: claim.id,
    statement: claim.text,
    evidenceRefs: ["fixture://" + fixture.id + "/" + claim.id],
  }));
  return {
    datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
    dataClassification: "synthetic",
    caseId: fixture.id,
    workspaceId: "workspace-marketing-lab",
    brandId: "brand-" + fixture.sector.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-synth",
    capability: fixture.format === "carousel" ? "carousel-strategy" : "reel-strategy",
    format: fixture.format,
    objective: fixture.opportunity,
    audience: fixture.audience,
    claims,
    requiredClaimIds: claims.map((claim) => claim.id),
    prohibitedPatterns: [
      "guaranteed result",
      "we personally tested",
      "i personally tested",
      "official endorsement",
    ],
  };
}

async function executeNative(runtime: AgentRuntimePort, benchmarkCase: MarketingShadowBenchmarkCase) {
  const request = prepareAgentInvocation({
    role: "strategist",
    scope: {
      visibility: "brand-private",
      workspaceId: benchmarkCase.workspaceId,
      brandId: benchmarkCase.brandId,
    },
    approvedContextVersion: "charlie-shadow-native:" + benchmarkCase.caseId,
    capabilities: [],
    task: {
      instruction: NATIVE_INSTRUCTION,
      context: {
        benchmarkCase: {
          datasetId: benchmarkCase.datasetId,
          dataClassification: benchmarkCase.dataClassification,
          caseId: benchmarkCase.caseId,
          capability: benchmarkCase.capability,
          format: benchmarkCase.format,
          objective: benchmarkCase.objective,
          audience: benchmarkCase.audience,
          claims: benchmarkCase.claims.map((claim) => ({
            id: claim.id,
            statement: claim.statement,
            evidenceRefs: [...claim.evidenceRefs],
          })),
          requiredClaimIds: [...benchmarkCase.requiredClaimIds],
          prohibitedPatterns: [...(benchmarkCase.prohibitedPatterns ?? [])],
        },
      } as Record<string, JsonValue>,
    },
    outputSchema: {
      name: benchmarkCase.format === "carousel" ? "marketing-carousel-plan" : "marketing-reel-plan",
      version: "1",
    },
    budget: {
      maxOutputTokens: 2_200,
      maxToolCalls: 0,
      maxCostUsd: 0.02,
      timeoutMs: 30_000,
    },
  });

  const result = await runtime.invoke<MarketingCreativePlan>(request);
  const output = benchmarkCase.format === "carousel"
    ? validateCarouselPlan(result.output as never)
    : validateReelPlan(result.output as never);
  validateLineage(output, benchmarkCase);
  return { output, metadata: result.metadata };
}

function validateLineage(output: MarketingCreativePlan, benchmarkCase: MarketingShadowBenchmarkCase): void {
  const allowed = new Set(benchmarkCase.claims.map((claim) => claim.id));
  if (output.supportingClaimIds.some((id) => !allowed.has(id))) {
    throw new Error("Output references a Claim outside the benchmark lineage");
  }
  if (benchmarkCase.requiredClaimIds.some((id) => !output.supportingClaimIds.includes(id))) {
    throw new Error("Output omitted a required benchmark Claim");
  }
  const visible = JSON.stringify(output).toLowerCase();
  for (const pattern of benchmarkCase.prohibitedPatterns ?? []) {
    if (visible.includes(pattern.toLowerCase())) {
      throw new Error("Output contains a prohibited benchmark pattern");
    }
  }
}

function summarize(results: PairResult[]) {
  const metrics = ["brandFit", "hookQuality", "originality", "formatQuality", "criticScore"] as const;
  const nativeScores = Object.fromEntries(metrics.map((metric) => [
    metric,
    mean(results.map((item) => item.evaluation.candidateA.scores[metric])),
  ]));
  const charlieScores = Object.fromEntries(metrics.map((metric) => [
    metric,
    mean(results.map((item) => item.evaluation.candidateB.scores[metric])),
  ]));
  const nativeQuality = mean(Object.values(nativeScores));
  const charlieQuality = mean(Object.values(charlieScores));
  return {
    native: {
      truthPasses: results.filter((item) => item.evaluation.candidateA.truthPassed).length,
      scores: nativeScores,
      meanQuality: nativeQuality,
      generationCostUsd: sum(results.map((item) => item.native.costUsd)),
      meanGenerationLatencyMs: mean(results.map((item) => item.native.latencyMs)),
    },
    charlie: {
      truthPasses: results.filter((item) => item.evaluation.candidateB.truthPassed).length,
      scores: charlieScores,
      meanQuality: charlieQuality,
      generationCostUsd: sum(results.map((item) => item.charlie.costUsd)),
      meanGenerationLatencyMs: mean(results.map((item) => item.charlie.latencyMs)),
    },
    delta: {
      meanQuality: round(charlieQuality - nativeQuality),
      generationCostUsd: round(
        sum(results.map((item) => item.charlie.costUsd)) -
        sum(results.map((item) => item.native.costUsd)),
      ),
      meanGenerationLatencyMs: round(
        mean(results.map((item) => item.charlie.latencyMs)) -
        mean(results.map((item) => item.native.latencyMs)),
      ),
    },
    evaluatorCostUsd: sum(results.map((item) => item.evaluation.provenance.costUsd ?? 0)),
  };
}

function mean(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0) / Math.max(1, values.length));
}
function sum(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0));
}
function round(value: number): number {
  return Number(value.toFixed(6));
}
