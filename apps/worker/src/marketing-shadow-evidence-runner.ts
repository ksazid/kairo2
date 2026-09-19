import type { AgentInvocationMetadata, AgentRuntimePort } from "@kairo/agent-contracts";
import { createMarketingSkillRegistry, type MarketingSkillManifest } from "@kairo/domain/skill-registry";
import benchmarkData from "../../../evaluation/marketing-lab/benchmark-cases.json";
import challengerData from "../../../evaluation/marketing-lab/corey-social-shadow.json";
import {
  executeKairoNativeCarouselBaseline,
  toMotorcycleCarouselQualificationCase,
  type MotorcycleCarouselFixture,
} from "./marketing-shadow-qualification";
import {
  MarketingShadowExecutionService,
  verifyPinnedSkillSnapshot,
  type MarketingSkillSnapshot,
} from "./marketing-shadow";

const CASE_IDS = new Set([
  "motorcycle-carousel-01",
  "motorcycle-carousel-02",
  "motorcycle-carousel-03",
  "motorcycle-carousel-04",
]);

const COREY_SOURCE_URL =
  "https://raw.githubusercontent.com/coreyhaines31/marketingskills/7868cb9251fad80a73d26e488a5ad5f6c4a9f335/skills/social/SKILL.md";
const SAFE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

export const MARKETING_EVIDENCE_INTER_LANE_DELAY_MS = 65_000;
export const MARKETING_EVIDENCE_HERMES_READY_DEADLINE_MS = 180_000;
export const MARKETING_EVIDENCE_HERMES_READY_REQUEST_TIMEOUT_MS = 20_000;
export const MARKETING_EVIDENCE_HERMES_READY_POLL_DELAY_MS = 5_000;
export type MarketingEvidencePause = (ms: number) => Promise<void>;

export interface MarketingShadowLaneEvidence {
  output: unknown;
  metadata: Pick<
    AgentInvocationMetadata,
    | "runtime"
    | "runtimeVersion"
    | "provider"
    | "model"
    | "modelVersion"
    | "inputTokens"
    | "outputTokens"
    | "costUsd"
    | "pricingVersion"
    | "latencyMs"
  >;
}

export interface MarketingShadowRuntimeRoute {
  runtime: "direct-model";
  provider: string;
  model: string;
  modelVersion?: string;
  pricingVersion: string;
}

export interface MarketingShadowPairEvidence {
  caseId: string;
  inputFingerprint: string;
  native: MarketingShadowLaneEvidence;
  corey: MarketingShadowLaneEvidence;
}

export interface MarketingShadowEvidenceRun {
  schemaVersion: 1;
  evidenceKind: "vs23-shadow-qualification-paired-execution";
  datasetId: "marketing-lab-cross-sector-synthetic-fixtures";
  challengerSource: {
    repository: string;
    commitSha: string;
    path: string;
    blobSha: string;
  };
  runtimeRoute: MarketingShadowRuntimeRoute;
  pairs: MarketingShadowPairEvidence[];
}

class MarketingEvidenceStageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("Marketing qualification evidence stage failed");
    this.name = "MarketingEvidenceStageError";
    this.code = code;
  }
}

export async function runMarketingShadowPairedEvidence(
  runtime: AgentRuntimePort,
  fetchImpl: typeof fetch = fetch,
  pause: MarketingEvidencePause = defaultMarketingEvidencePause,
): Promise<MarketingShadowEvidenceRun> {
  const manifest = challengerData.manifest as unknown as MarketingSkillManifest;
  const source = manifest.source;
  if (source.kind !== "github") throw evidenceFailure("run", "corey", "manifest", "invalid_source");

  let response: Response;
  try {
    response = await fetchImpl(COREY_SOURCE_URL, {
      method: "GET",
      headers: { accept: "text/plain" },
    });
  } catch (error) {
    throw evidenceFailure("run", "corey", "snapshot", error);
  }
  if (!response.ok) throw evidenceFailure("run", "corey", "snapshot", `http_${response.status}`);

  const candidateSnapshot: MarketingSkillSnapshot = {
    repository: source.repository,
    commitSha: source.commitSha,
    path: source.path,
    blobSha: source.contentHash,
    content: await response.text(),
  };
  let snapshot: MarketingSkillSnapshot;
  try {
    snapshot = verifyPinnedSkillSnapshot(manifest, candidateSnapshot);
  } catch (error) {
    throw evidenceFailure("run", "corey", "snapshot", error);
  }

  const registry = createMarketingSkillRegistry([manifest]);
  const shadow = new MarketingShadowExecutionService(runtime, registry, {
    allowedDatasetIds: ["marketing-lab-cross-sector-synthetic-fixtures"],
    maxCostUsd: 0.03,
    timeoutMs: 30_000,
    maxOutputTokens: 2_200,
  });

  const fixtures = benchmarkData.cases
    .filter((candidate) => CASE_IDS.has(candidate.id))
    .map((candidate) => candidate as MotorcycleCarouselFixture)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (fixtures.length !== 4) throw evidenceFailure("run", "pair", "fixtures", "invalid_count");

  const pacedInvoke = createMarketingEvidenceLanePacer(pause);
  const pairs: MarketingShadowPairEvidence[] = [];
  let expectedRoute: MarketingShadowRuntimeRoute | undefined;
  for (const fixture of fixtures) {
    const benchmarkCase = toMotorcycleCarouselQualificationCase(fixture);
    const native = await invokeEvidenceLane(fixture.id, "native", "execute", () =>
      pacedInvoke(() => executeKairoNativeCarouselBaseline(runtime, benchmarkCase))
    );
    const corey = await invokeEvidenceLane(fixture.id, "corey", "execute", () =>
      pacedInvoke(() => shadow.execute({
        challenger: { id: manifest.id, version: manifest.version },
        snapshot,
        benchmarkCase,
      }))
    );
    if (native.inputFingerprint !== corey.inputFingerprint) {
      throw evidenceFailure(fixture.id, "pair", "fingerprint", "mismatch");
    }
    try {
      requireMeasuredMetadata(native.metadata, `${fixture.id}:native`);
    } catch (error) {
      throw evidenceFailure(fixture.id, "native", "metadata", error);
    }
    try {
      requireMeasuredMetadata(corey.metadata, `${fixture.id}:corey`);
    } catch (error) {
      throw evidenceFailure(fixture.id, "corey", "metadata", error);
    }

    let nativeRoute: MarketingShadowRuntimeRoute;
    let coreyRoute: MarketingShadowRuntimeRoute;
    try {
      nativeRoute = marketingEvidenceRuntimeRoute(native.metadata, `${fixture.id}:native`);
    } catch (error) {
      throw evidenceFailure(fixture.id, "native", "route", error);
    }
    try {
      coreyRoute = marketingEvidenceRuntimeRoute(corey.metadata, `${fixture.id}:corey`);
    } catch (error) {
      throw evidenceFailure(fixture.id, "corey", "route", error);
    }
    if (runtimeRouteKey(nativeRoute) !== runtimeRouteKey(coreyRoute)) {
      throw evidenceFailure(fixture.id, "pair", "route", "lane_mismatch");
    }
    if (!expectedRoute) expectedRoute = nativeRoute;
    else if (runtimeRouteKey(expectedRoute) !== runtimeRouteKey(nativeRoute)) {
      throw evidenceFailure(fixture.id, "pair", "route", "run_changed");
    }

    pairs.push({
      caseId: fixture.id,
      inputFingerprint: native.inputFingerprint,
      native: { output: native.output, metadata: safeMetadata(native.metadata) },
      corey: { output: corey.output, metadata: safeMetadata(corey.metadata) },
    });
  }

  if (!expectedRoute) throw evidenceFailure("run", "pair", "route", "missing");
  return {
    schemaVersion: 1,
    evidenceKind: "vs23-shadow-qualification-paired-execution",
    datasetId: "marketing-lab-cross-sector-synthetic-fixtures",
    challengerSource: {
      repository: source.repository,
      commitSha: source.commitSha,
      path: source.path,
      blobSha: source.contentHash,
    },
    runtimeRoute: expectedRoute,
    pairs,
  };
}

export async function waitForMarketingEvidenceHermesReady(
  endpoint: string | null | undefined = process.env.KAIRO_HERMES_ENDPOINT,
  fetchImpl: typeof fetch = fetch,
  pause: MarketingEvidencePause = defaultMarketingEvidencePause,
  now: () => number = Date.now,
): Promise<void> {
  const normalizedEndpoint = endpoint?.trim();
  if (!normalizedEndpoint) return;
  if (!/^https?:\/\//.test(normalizedEndpoint)) {
    throw new Error("Hermes readiness endpoint must be HTTP(S)");
  }

  const deadlineAt = now() + MARKETING_EVIDENCE_HERMES_READY_DEADLINE_MS;
  let lastStatus: number | undefined;
  while (now() < deadlineAt) {
    const remainingBeforeRequest = deadlineAt - now();
    if (remainingBeforeRequest <= 0) break;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(MARKETING_EVIDENCE_HERMES_READY_REQUEST_TIMEOUT_MS, remainingBeforeRequest),
    );
    try {
      const response = await fetchImpl(`${normalizedEndpoint.replace(/\/$/, "")}/health/ready`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      lastStatus = response.status;
      if (response.ok) return;
    } catch {
      lastStatus = undefined;
    } finally {
      clearTimeout(timeout);
    }

    const remainingAfterRequest = deadlineAt - now();
    if (remainingAfterRequest <= 0) break;
    await pause(Math.min(MARKETING_EVIDENCE_HERMES_READY_POLL_DELAY_MS, remainingAfterRequest));
  }

  throw new Error(
    lastStatus === undefined
      ? "Hermes readiness preflight failed before qualification lanes"
      : `Hermes readiness preflight failed with ${lastStatus} before qualification lanes`,
  );
}

export function createMarketingEvidenceLanePacer(
  pause: MarketingEvidencePause = defaultMarketingEvidencePause,
): <T>(invoke: () => Promise<T>) => Promise<T> {
  let invocationCount = 0;
  return async <T>(invoke: () => Promise<T>): Promise<T> => {
    if (invocationCount > 0) await pause(MARKETING_EVIDENCE_INTER_LANE_DELAY_MS);
    invocationCount += 1;
    return invoke();
  };
}

export function marketingEvidenceFailureCode(
  caseId: string,
  lane: "native" | "corey" | "pair",
  stage: "execute" | "fingerprint" | "metadata" | "route" | "fixtures" | "manifest" | "snapshot",
  error: unknown,
): string {
  const caseCode = qualificationCaseCode(caseId);
  const sourceCode = stableFailureCode(error);
  const code = `${caseCode}.${lane}.${stage}.${sourceCode}`;
  if (!SAFE_CODE_PATTERN.test(code)) return `${caseCode}.${lane}.${stage}.unknown`;
  return code;
}

async function invokeEvidenceLane<T>(
  caseId: string,
  lane: "native" | "corey",
  stage: "execute",
  invoke: () => Promise<T>,
): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    throw evidenceFailure(caseId, lane, stage, error);
  }
}

function evidenceFailure(
  caseId: string,
  lane: "native" | "corey" | "pair",
  stage: "execute" | "fingerprint" | "metadata" | "route" | "fixtures" | "manifest" | "snapshot",
  error: unknown,
): MarketingEvidenceStageError {
  return new MarketingEvidenceStageError(marketingEvidenceFailureCode(caseId, lane, stage, error));
}

function qualificationCaseCode(caseId: string): string {
  if (caseId === "run") return "run";
  const match = /^motorcycle-carousel-0([1-4])$/.exec(caseId);
  return match ? `mc0${match[1]}` : "run";
}

function stableFailureCode(error: unknown): string {
  let value = "unknown";
  if (typeof error === "string") value = error;
  else if (error && typeof error === "object" && "code" in error) {
    value = String((error as { code?: unknown }).code ?? "unknown");
  } else if (error instanceof Error) value = error.name;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized || !/^[a-z]/.test(normalized)) return "unknown";
  return normalized.slice(0, 32);
}

function defaultMarketingEvidencePause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireMeasuredMetadata(metadata: AgentInvocationMetadata, lane: string): void {
  if (!Number.isFinite(metadata.latencyMs) || metadata.latencyMs < 0) {
    throw new Error(`Measured latency metadata is required for ${lane}`);
  }
  if (metadata.costUsd === undefined || !Number.isFinite(metadata.costUsd) || metadata.costUsd < 0) {
    throw new Error(`Measured cost metadata is required for ${lane}`);
  }
}

export function marketingEvidenceRuntimeRoute(
  metadata: AgentInvocationMetadata,
  lane: string,
): MarketingShadowRuntimeRoute {
  if (metadata.runtime !== "direct-model") throw new Error(`DirectModel runtime evidence is required for ${lane}`);
  const provider = requiredMetadataText(metadata.provider, "provider", lane);
  const model = requiredMetadataText(metadata.model, "model", lane);
  const pricingVersion = requiredMetadataText(metadata.pricingVersion, "pricingVersion", lane);
  return {
    runtime: "direct-model",
    provider,
    model,
    ...(metadata.modelVersion ? { modelVersion: metadata.modelVersion } : {}),
    pricingVersion,
  };
}

function runtimeRouteKey(route: MarketingShadowRuntimeRoute): string {
  return JSON.stringify(route);
}

function requiredMetadataText(value: unknown, field: string, lane: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} metadata is required for ${lane}`);
  return value.trim();
}

function safeMetadata(metadata: AgentInvocationMetadata): MarketingShadowLaneEvidence["metadata"] {
  return {
    runtime: metadata.runtime,
    ...(metadata.runtimeVersion ? { runtimeVersion: metadata.runtimeVersion } : {}),
    ...(metadata.provider ? { provider: metadata.provider } : {}),
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.modelVersion ? { modelVersion: metadata.modelVersion } : {}),
    ...(metadata.inputTokens !== undefined ? { inputTokens: metadata.inputTokens } : {}),
    ...(metadata.outputTokens !== undefined ? { outputTokens: metadata.outputTokens } : {}),
    ...(metadata.costUsd !== undefined ? { costUsd: metadata.costUsd } : {}),
    ...(metadata.pricingVersion ? { pricingVersion: metadata.pricingVersion } : {}),
    latencyMs: metadata.latencyMs,
  };
}
