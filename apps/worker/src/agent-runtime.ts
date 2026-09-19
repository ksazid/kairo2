import type {
  AgentInvocationRequest,
  AgentRuntimePort,
  AgentRuntimeResult,
  ModelGatewayPort,
  ModelPolicy,
} from "@kairo/agent-contracts";

const HERMES_POLICY_FINGERPRINT = "kairo-hermes-reasoning-only-vs03:d2c6af3aa258c47d64c41a56fe9ff61815334e17";

export class AgentRuntimeError extends Error {
  readonly code = "agent_runtime_error";
}

type OutputValidator = (value: unknown) => boolean;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type HermesRoutingMode = "resilient" | "primary-only";

export interface HermesBridgeRuntimeOptions {
  endpoint: string;
  serviceToken: string;
  validators: Record<string, OutputValidator>;
  routingMode?: HermesRoutingMode;
  fetchImpl?: FetchLike;
}

interface HermesBridgeResponse {
  policy?: { fingerprint?: string; enabledTools?: string[]; runtimeVersion?: string };
  output?: unknown;
  metadata?: {
    provider?: string; model?: string; modelVersion?: string;
    inputTokens?: number; outputTokens?: number; costUsd?: number; pricingVersion?: string; latencyMs?: number;
  };
}

export class HermesBridgeRuntime implements AgentRuntimePort {
  private readonly fetchImpl: FetchLike;
  private readonly routingMode: HermesRoutingMode;

  constructor(private readonly options: HermesBridgeRuntimeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!/^https?:\/\//.test(options.endpoint)) throw new AgentRuntimeError("Hermes bridge endpoint must be HTTP(S)");
    if (!options.serviceToken.trim()) throw new AgentRuntimeError("Hermes bridge service token is required");
    this.routingMode = routingMode(options.routingMode ?? "resilient");
  }

  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    const validator = this.options.validators[schemaKey(request.outputSchema.name, request.outputSchema.version)];
    if (!validator) throw new AgentRuntimeError("No Kairo output validator is registered for this Hermes invocation");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.budget.timeoutMs);
    const started = performance.now();
    try {
      const response = await this.fetchImpl(`${this.options.endpoint.replace(/\/$/, "")}/kairo/v1/invoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.serviceToken}`,
          "x-kairo-hermes-policy": HERMES_POLICY_FINGERPRINT,
        },
        body: JSON.stringify({
          role: request.role,
          scope: request.scope,
          approvedContextVersion: request.approvedContextVersion,
          task: request.task,
          outputSchema: request.outputSchema,
          budget: {
            maxOutputTokens: request.budget.maxOutputTokens,
            maxCostUsd: request.budget.maxCostUsd,
            timeoutMs: request.budget.timeoutMs,
          },
          enabledTools: [],
          policyFingerprint: HERMES_POLICY_FINGERPRINT,
          routingMode: this.routingMode,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new AgentRuntimeError(`Hermes bridge returned ${response.status}`);

      const payload = await response.json() as HermesBridgeResponse;
      const policy = payload.policy;
      if (!policy || policy.fingerprint !== HERMES_POLICY_FINGERPRINT) throw new AgentRuntimeError("Hermes policy fingerprint mismatch");
      if (!Array.isArray(policy.enabledTools) || policy.enabledTools.length !== 0) {
        throw new AgentRuntimeError("Hermes runtime did not attest to a zero-tool profile");
      }
      if (!validator(payload.output)) throw new AgentRuntimeError("Hermes output failed Kairo schema validation");

      return {
        output: payload.output as TOutput,
        metadata: {
          runtime: "hermes",
          ...(policy.runtimeVersion ? { runtimeVersion: policy.runtimeVersion } : {}),
          ...(payload.metadata?.provider ? { provider: payload.metadata.provider } : {}),
          ...(payload.metadata?.model ? { model: payload.metadata.model } : {}),
          ...(payload.metadata?.modelVersion ? { modelVersion: payload.metadata.modelVersion } : {}),
          ...(numberOrUndefined(payload.metadata?.inputTokens) !== undefined ? { inputTokens: payload.metadata!.inputTokens } : {}),
          ...(numberOrUndefined(payload.metadata?.outputTokens) !== undefined ? { outputTokens: payload.metadata!.outputTokens } : {}),
          ...(numberOrUndefined(payload.metadata?.costUsd) !== undefined ? { costUsd: payload.metadata!.costUsd } : {}),
          ...(payload.metadata?.pricingVersion ? { pricingVersion: payload.metadata.pricingVersion } : {}),
          latencyMs: Math.max(0, payload.metadata?.latencyMs ?? Math.round(performance.now() - started)),
        },
      };
    } catch (error) {
      if (controller.signal.aborted) throw new AgentRuntimeError("Hermes invocation timed out");
      if (error instanceof AgentRuntimeError) throw error;
      throw new AgentRuntimeError(`Hermes invocation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function hermesBridgeRuntimeFromEnv(
  validators: Record<string, OutputValidator>,
  env: Record<string, string | undefined> = process.env,
  routing: HermesRoutingMode = "resilient",
): HermesBridgeRuntime | null {
  if (env.KAIRO_HERMES_RUNTIME_ENABLED?.trim() !== "1") return null;

  const endpoint = env.KAIRO_HERMES_ENDPOINT?.trim();
  const serviceToken = env.KAIRO_HERMES_SERVICE_TOKEN?.trim();
  if (!endpoint || !serviceToken) {
    throw new AgentRuntimeError("KAIRO_HERMES_ENDPOINT and KAIRO_HERMES_SERVICE_TOKEN must be configured together when KAIRO_HERMES_RUNTIME_ENABLED=1");
  }
  return new HermesBridgeRuntime({ endpoint, serviceToken, validators, routingMode: routing });
}

export interface DirectModelRuntimeOptions {
  gateway: ModelGatewayPort;
  policy: (request: AgentInvocationRequest) => ModelPolicy;
  validators: Record<string, OutputValidator>;
}

export class DirectModelRuntime implements AgentRuntimePort {
  constructor(private readonly options: DirectModelRuntimeOptions) {}

  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    const validator = this.options.validators[schemaKey(request.outputSchema.name, request.outputSchema.version)];
    if (!validator) throw new AgentRuntimeError("No Kairo output validator is registered for this direct-model invocation");
    const result = await this.options.gateway.generate<unknown>({
      role: request.role,
      scope: request.scope,
      policy: this.options.policy(request),
      input: JSON.stringify({
        instruction: request.task.instruction,
        context: request.task.context,
        approvedContextVersion: request.approvedContextVersion,
      }),
      outputSchema: request.outputSchema,
    });
    if (!validator(result.output)) throw new AgentRuntimeError("Direct-model output failed Kairo schema validation");
    return {
      output: result.output as TOutput,
      metadata: {
        runtime: "direct-model",
        provider: result.metadata.provider,
        model: result.metadata.model,
        ...(result.metadata.modelVersion ? { modelVersion: result.metadata.modelVersion } : {}),
        inputTokens: result.metadata.inputTokens,
        outputTokens: result.metadata.outputTokens,
        costUsd: result.metadata.costUsd,
        ...(result.metadata.pricingVersion ? { pricingVersion: result.metadata.pricingVersion } : {}),
        latencyMs: result.metadata.latencyMs,
      },
    };
  }
}

export class AgentRuntimeRouter implements AgentRuntimePort {
  constructor(private readonly primary: AgentRuntimePort | null, private readonly fallback: AgentRuntimePort) {}

  async invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>> {
    if (!this.primary) return this.fallback.invoke<TOutput>(request);
    try {
      return await this.primary.invoke<TOutput>(request);
    } catch (error) {
      if (!(error instanceof AgentRuntimeError)) throw error;
      return this.fallback.invoke<TOutput>(request);
    }
  }
}

export { HERMES_POLICY_FINGERPRINT };

function schemaKey(name: string, version: string): string { return `${name}@${version}`; }
function routingMode(value: unknown): HermesRoutingMode {
  if (value === "resilient" || value === "primary-only") return value;
  throw new AgentRuntimeError("Hermes routing mode is not supported");
}
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}