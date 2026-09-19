import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  AgentRuntimeResult,
} from "@kairo/agent-contracts";
import type { MarketingShadowEvidenceRun } from "@kairo/worker/marketing-shadow-evidence-runner";
import {
  toMotorcycleCarouselQualificationCase,
  type MotorcycleCarouselFixture,
} from "@kairo/worker/marketing-shadow-qualification";
import { marketingShadowInputFingerprint } from "@kairo/worker/marketing-shadow";
import benchmarkData from "../../../evaluation/marketing-lab/benchmark-cases.json";
import {
  executeMarketingShadowQualityEvaluationAttempt,
  MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID,
  MARKETING_SHADOW_QUALITY_INTER_PAIR_DELAY_MS,
  MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA,
  MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID,
  marketingShadowQualityEvaluationRequestFromEnv,
  runMarketingShadowQualityEvaluation,
  type MarketingShadowQualityEvaluationEvidence,
  type MarketingShadowQualityEvaluationRunStore,
} from "./marketing-shadow-quality-evaluation-run";

const releaseSha = "a".repeat(40);
const request = { runId: MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID, releaseSha };
const qualityCaseIds = new Set([
  "motorcycle-carousel-01",
  "motorcycle-carousel-02",
  "motorcycle-carousel-03",
  "motorcycle-carousel-04",
]);

const evaluationEvidence: MarketingShadowQualityEvaluationEvidence = {
  schemaVersion: 1,
  evidenceKind: "vs65-marketing-quality-evaluation",
  sourceRunId: MARKETING_SHADOW_QUALITY_SOURCE_RUN_ID,
  sourceReleaseSha: MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA,
  evaluatorReleaseSha: releaseSha,
  datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
  candidateMapping: {
    candidateA: { id: "kairo-native-carousel", version: "1" },
    candidateB: { id: "corey-social-shadow", version: "2.2.0+7868cb9" },
  },
  pairs: [],
};

function storeMock(overrides: Partial<MarketingShadowQualityEvaluationRunStore> = {}): MarketingShadowQualityEvaluationRunStore {
  return {
    status: vi.fn().mockResolvedValue("authorized"),
    claim: vi.fn().mockResolvedValue({ claimed: true, status: "started" }),
    complete: vi.fn(),
    fail: vi.fn(),
    ...overrides,
  };
}

describe("VS-69 Run-D quality evaluation execution", () => {
  it("is dormant unless the exact one-shot quality run is enabled", () => {
    expect(marketingShadowQualityEvaluationRequestFromEnv({})).toBeNull();
    expect(marketingShadowQualityEvaluationRequestFromEnv({
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN: "0",
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID: "stale",
      KAIRO_RELEASE_SHA: "stale",
    })).toBeNull();
    expect(() => marketingShadowQualityEvaluationRequestFromEnv({
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN: "1",
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID: "other-run",
      KAIRO_RELEASE_SHA: releaseSha,
    })).toThrow(/approved one-shot/);
    expect(marketingShadowQualityEvaluationRequestFromEnv({
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN: "1",
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID: MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID,
      KAIRO_RELEASE_SHA: releaseSha,
    })).toEqual(request);
  });

  it("requires the configured release to match Render's deployed SHA", () => {
    expect(() => marketingShadowQualityEvaluationRequestFromEnv({
      RENDER: "true",
      RENDER_GIT_COMMIT: "b".repeat(40),
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN: "1",
      KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID: MARKETING_SHADOW_QUALITY_EVALUATION_RUN_ID,
      KAIRO_RELEASE_SHA: releaseSha,
    })).toThrow(/actual Render deployed commit/);
  });

  it.each(["not-authorized", "started", "completed", "failed"] as const)(
    "performs zero evaluator model work when durable status is %s",
    async (status) => {
      const run = vi.fn();
      const store = storeMock({ status: vi.fn().mockResolvedValue(status) });
      const result = await executeMarketingShadowQualityEvaluationAttempt(
        store,
        {} as Pool,
        {} as AgentRuntimePort,
        request,
        run as never,
      );
      expect(result).toEqual({ kind: "skipped", priorStatus: status });
      expect(store.claim).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("consumes authorization before evaluator model work and persists once", async () => {
    const order: string[] = [];
    const store = storeMock({
      status: vi.fn(async () => { order.push("status"); return "authorized" as const; }),
      claim: vi.fn(async () => { order.push("claim"); return { claimed: true, status: "started" as const }; }),
      complete: vi.fn(async () => { order.push("complete"); }),
    });
    const run = vi.fn(async () => { order.push("run"); return evaluationEvidence; });
    const result = await executeMarketingShadowQualityEvaluationAttempt(
      store,
      {} as Pool,
      {} as AgentRuntimePort,
      request,
      run,
    );
    expect(result).toEqual({ kind: "completed", evidence: evaluationEvidence });
    expect(order).toEqual(["status", "claim", "run", "complete"]);
  });

  it("records only a bounded failure kind when evaluator execution fails", async () => {
    const store = storeMock();
    const failure = Object.assign(new Error("provider detail"), { code: "agent_runtime_error" });
    const run = vi.fn().mockRejectedValue(failure);
    await expect(executeMarketingShadowQualityEvaluationAttempt(
      store,
      {} as Pool,
      {} as AgentRuntimePort,
      request,
      run,
    )).rejects.toBe(failure);
    expect(store.fail).toHaveBeenCalledWith(request.runId, "agent_runtime_error");
  });

  it("evaluates exactly the four persisted Run-D pairs with fixed pacing and blind A/B labels", async () => {
    const source = sourceEvidence();
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          release_sha: MARKETING_SHADOW_QUALITY_SOURCE_RELEASE_SHA,
          status: "completed",
          evidence: source,
          failure_kind: null,
        }],
      }),
    } as unknown as Pool;
    const runtime = new FixedEvaluatorRuntime();
    const pause = vi.fn().mockResolvedValue(undefined);

    const evidence = await runMarketingShadowQualityEvaluation(pool, runtime, releaseSha, pause);
    expect(evidence.sourceRunId).toBe("vs23-qualification-20260820-d");
    expect(evidence.sourceReleaseSha).toBe("5492f8ffc9273317ddd4e6b3e8f4a30f4a8df5e2");
    expect(evidence.pairs).toHaveLength(4);
    expect(evidence.pairs.map((pair) => pair.caseId)).toEqual([
      "motorcycle-carousel-01",
      "motorcycle-carousel-02",
      "motorcycle-carousel-03",
      "motorcycle-carousel-04",
    ]);
    expect(runtime.requests).toHaveLength(4);
    expect(pause).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenNthCalledWith(1, MARKETING_SHADOW_QUALITY_INTER_PAIR_DELAY_MS);
    for (const invocation of runtime.requests) {
      const serialized = JSON.stringify(invocation.task.context);
      expect(serialized).toContain("candidateA");
      expect(serialized).toContain("candidateB");
      expect(serialized).not.toContain("kairo-native-carousel");
      expect(serialized).not.toContain("corey-social-shadow");
    }
  });
});

class FixedEvaluatorRuntime implements AgentRuntimePort {
  requests: AgentInvocationRequest[] = [];
  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    this.requests.push(request);
    return {
      output: {
        candidateA: {
          truthPassed: true,
          scores: { brandFit: 80, hookQuality: 80, originality: 80, formatQuality: 80, criticScore: 80 },
          reasons: ["Grounded in supplied Claims."],
        },
        candidateB: {
          truthPassed: true,
          scores: { brandFit: 82, hookQuality: 82, originality: 82, formatQuality: 82, criticScore: 82 },
          reasons: ["Grounded in supplied Claims."],
        },
      } as TOutput,
      metadata: {
        runtime: "direct-model",
        provider: "groq",
        model: "openai/gpt-oss-120b",
        inputTokens: 100,
        outputTokens: 100,
        costUsd: 0.0001,
        pricingVersion: "test-pricing",
        latencyMs: 100,
      },
    };
  }
}

function sourceEvidence(): MarketingShadowEvidenceRun {
  const fixtures = benchmarkData.cases
    .filter((candidate) => qualityCaseIds.has(candidate.id))
    .map((candidate) => candidate as MotorcycleCarouselFixture)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    evidenceKind: "vs23-shadow-qualification-paired-execution",
    datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
    challengerSource: {
      repository: "coreyhaines31/marketingskills",
      commitSha: "7868cb9251fad80a73d26e488a5ad5f6c4a9f335",
      path: "skills/social/SKILL.md",
      blobSha: "ab1d083ef4a9dd2a91c1eaedfb5cb745c3055d24",
    },
    runtimeRoute: {
      runtime: "direct-model",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      pricingVersion: "test-pricing",
    },
    pairs: fixtures.map((fixture) => {
      const benchmarkCase = toMotorcycleCarouselQualificationCase(fixture);
      const ids = fixture.claims.map((claim) => claim.id) as [string, string];
      return {
        caseId: fixture.id,
        inputFingerprint: marketingShadowInputFingerprint(benchmarkCase),
        native: { output: carousel(ids), metadata: { runtime: "direct-model", provider: "groq", model: "openai/gpt-oss-120b", costUsd: 0.001, pricingVersion: "test-pricing", latencyMs: 100 } },
        corey: { output: carousel(ids), metadata: { runtime: "direct-model", provider: "groq", model: "openai/gpt-oss-120b", costUsd: 0.001, pricingVersion: "test-pricing", latencyMs: 100 } },
      };
    }),
  };
}

function carousel(ids: [string, string]) {
  return {
    format: "carousel" as const,
    coverHook: "Choose based on your priorities",
    slides: [
      { headline: "Priority one", body: "Use the supplied claim.", supportingClaimIds: [ids[0]] },
      { headline: "Priority two", body: "Use the supplied claim.", supportingClaimIds: [ids[1]] },
      { headline: "Compare", body: "Compare the supplied claims.", supportingClaimIds: [ids[0], ids[1]] },
    ],
    caption: "Compare the supplied considerations.",
    cta: "Save this comparison.",
    supportingClaimIds: [...ids],
  };
}
