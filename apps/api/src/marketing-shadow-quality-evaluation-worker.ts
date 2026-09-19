import { Pool } from "pg";
import { DirectModelRuntime } from "@kairo/worker/agent-runtime";
import { openAICompatibleGatewayFromEnv } from "@kairo/worker/model-gateway";
import { validateMarketingShadowPairQualityEvaluation } from "@kairo/worker/marketing-shadow-quality-evaluator";
import {
  executeMarketingShadowQualityEvaluationAttempt,
  marketingShadowQualityEvaluationRequestFromEnv,
  PgMarketingShadowQualityEvaluationRunStore,
} from "./marketing-shadow-quality-evaluation-run";
import { safeFailureKind } from "./marketing-shadow-evidence-run";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const request = marketingShadowQualityEvaluationRequestFromEnv();
if (!request) throw new Error("Marketing Lab quality evaluation worker requires the one-shot evaluation flag");
const gateway = openAICompatibleGatewayFromEnv();
if (!gateway) throw new Error("DirectModelRuntime is not configured for Marketing Lab quality evaluation");

const runtime = new DirectModelRuntime({
  gateway,
  policy: (invocation) => ({
    qualityTier: "balanced",
    privacyClass: "global-public",
    maxCostUsd: invocation.budget.maxCostUsd,
    maxOutputTokens: invocation.budget.maxOutputTokens,
    allowedProviders: [],
  }),
  validators: {
    "marketing-pair-quality-evaluation@1": (value: unknown) => {
      try {
        validateMarketingShadowPairQualityEvaluation(value);
        return true;
      } catch {
        return false;
      }
    },
  },
});

const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });
const store = new PgMarketingShadowQualityEvaluationRunStore(pool);

try {
  const result = await executeMarketingShadowQualityEvaluationAttempt(store, pool, runtime, request);
  if (result.kind === "skipped") {
    console.log(JSON.stringify({
      marker: "KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_SKIPPED",
      runId: request.runId,
      releaseSha: request.releaseSha,
      priorStatus: result.priorStatus,
    }));
  } else {
    console.log(JSON.stringify({
      marker: "KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_COMPLETE",
      runId: request.runId,
      releaseSha: request.releaseSha,
      sourceRunId: result.evidence.sourceRunId,
      sourceReleaseSha: result.evidence.sourceReleaseSha,
      persisted: true,
      pairCount: result.evidence.pairs.length,
      candidateMapping: result.evidence.candidateMapping,
    }));
    for (let index = 0; index < result.evidence.pairs.length; index += 1) {
      console.log(JSON.stringify({
        marker: "KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_PAIR",
        runId: request.runId,
        index,
        pair: result.evidence.pairs[index],
      }));
    }
  }
} catch (error) {
  console.error(JSON.stringify({
    marker: "KAIRO_MARKETING_SHADOW_QUALITY_EVALUATION_FAILED",
    runId: request.runId,
    releaseSha: request.releaseSha,
    failureKind: safeFailureKind(error),
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
