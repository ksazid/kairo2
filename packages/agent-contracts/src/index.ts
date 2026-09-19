export class AgentContractError extends Error {
  readonly code = "agent_contract_error";
}

export type AgentRole = "hunter" | "researcher" | "strategist" | "drafter" | "critic" | "judge";
export type PrivacyClass = "global-public" | "brand-private";
export type QualityTier = "economy" | "balanced" | "high";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type InvocationScope =
  | { visibility: "global-public" }
  | { visibility: "brand-private"; workspaceId: string; brandId: string };

export interface AgentBudget {
  maxOutputTokens: number;
  maxToolCalls: number;
  maxCostUsd: number;
  timeoutMs: number;
}

export interface OutputSchemaRef {
  name: string;
  version: string;
}

export interface AgentTaskInput {
  instruction: string;
  context: Record<string, JsonValue>;
}

export interface AgentInvocationInput {
  role: AgentRole;
  scope: InvocationScope;
  approvedContextVersion: string;
  capabilities: string[];
  task: AgentTaskInput;
  outputSchema: OutputSchemaRef;
  budget: AgentBudget;
}

export interface AgentInvocationRequest extends AgentInvocationInput {
  capabilities: string[];
}

export interface AgentInvocationMetadata {
  runtime: string;
  runtimeVersion?: string;
  provider?: string;
  model?: string;
  modelVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  pricingVersion?: string;
  latencyMs: number;
}

export interface AgentRuntimeResult<TOutput> {
  output: TOutput;
  metadata: AgentInvocationMetadata;
}

export interface AgentRuntimePort {
  invoke<TOutput>(request: AgentInvocationRequest): Promise<AgentRuntimeResult<TOutput>>;
}

export interface ModelPolicyInput {
  qualityTier: QualityTier;
  privacyClass: PrivacyClass;
  maxCostUsd: number;
  maxOutputTokens: number;
  allowedProviders?: string[];
}

export interface ModelPolicy {
  qualityTier: QualityTier;
  privacyClass: PrivacyClass;
  maxCostUsd: number;
  maxOutputTokens: number;
  allowedProviders: string[];
}

export interface ModelGatewayRequest {
  role: AgentRole;
  scope: InvocationScope;
  policy: ModelPolicy;
  input: string;
  outputSchema: OutputSchemaRef;
}

export interface ModelInvocationMetadata {
  provider: string;
  model: string;
  modelVersion?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  pricingVersion?: string;
  latencyMs: number;
}

export interface ModelGatewayResult<TOutput> {
  output: TOutput;
  metadata: ModelInvocationMetadata;
}

export interface ModelGatewayPort {
  generate<TOutput>(request: ModelGatewayRequest): Promise<ModelGatewayResult<TOutput>>;
}

export interface ToolRequestInput {
  capability: string;
  scope: InvocationScope;
  input: Record<string, unknown>;
  timeoutMs: number;
}

export interface ToolRequest extends ToolRequestInput {}

export interface ToolProvenance {
  provider: string;
  providerVersion?: string;
  sourceUrl?: string;
  retrievedAt: string;
}

export interface ToolResult<TOutput> {
  output: TOutput;
  provenance: ToolProvenance[];
}

export interface ToolGatewayPort {
  invoke<TOutput>(request: ToolRequest): Promise<ToolResult<TOutput>>;
}

export interface DiscoveryRequest {
  query: string;
  scope: InvocationScope;
  maxResults: number;
  timeoutMs: number;
}

export interface DiscoveryEvidence {
  title: string;
  summary?: string;
  sourceUrl: string;
  platform: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: string;
  provider: string;
  providerVersion?: string;
  contentHash?: string;
}

export interface DiscoverySourceProvider {
  discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]>;
}

export * from "./source-intelligence";

const ALLOWED_CAPABILITIES = new Set([
  "public-content-search",
  "public-content-fetch",
]);

const FORBIDDEN_CONTEXT_KEY = /(api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret|cookie|session[-_]?token|private[-_]?key)/i;

export function prepareAgentInvocation(input: AgentInvocationInput): AgentInvocationRequest {
  if (!["hunter", "researcher", "strategist", "drafter", "critic", "judge"].includes(input.role)) throw new AgentContractError("agent role is not enabled");
  const scope = prepareScope(input.scope);
  const approvedContextVersion = requiredText(input.approvedContextVersion, "approvedContextVersion", 160);
  const capabilities = uniqueCapabilities(input.capabilities);
  if (input.role === "hunter" && !capabilities.length) throw new AgentContractError("Hunter requires at least one capability");
  const task = prepareTask(input.task);
  const outputSchema = prepareOutputSchema(input.outputSchema);
  const budget = prepareBudget(input.budget);
  return { role: input.role, scope, approvedContextVersion, capabilities, task, outputSchema, budget };
}

export function prepareModelPolicy(input: ModelPolicyInput): ModelPolicy {
  if (!["economy", "balanced", "high"].includes(input.qualityTier)) throw new AgentContractError("qualityTier is not supported");
  if (!["global-public", "brand-private"].includes(input.privacyClass)) throw new AgentContractError("privacyClass is not supported");
  const maxCostUsd = boundedNumber(input.maxCostUsd, "maxCostUsd", 0, 100);
  const maxOutputTokens = boundedInteger(input.maxOutputTokens, "maxOutputTokens", 1, 100_000);
  const allowedProviders = [...new Set((input.allowedProviders ?? []).map((provider) => provider.trim().toLowerCase()).filter(Boolean))];
  for (const provider of allowedProviders) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(provider)) throw new AgentContractError("allowedProviders contains an invalid provider identifier");
  }
  return { qualityTier: input.qualityTier, privacyClass: input.privacyClass, maxCostUsd, maxOutputTokens, allowedProviders };
}

export function prepareToolRequest(input: ToolRequestInput): ToolRequest {
  const capability = requiredText(input.capability, "capability", 120).toLowerCase();
  if (!ALLOWED_CAPABILITIES.has(capability)) throw new AgentContractError(`capability ${capability} is not allowed`);
  const scope = prepareScope(input.scope);
  const timeoutMs = boundedInteger(input.timeoutMs, "timeoutMs", 100, 300_000);
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) throw new AgentContractError("tool input must be an object");
  rejectForbiddenKeys(input.input, "tool.input");
  return { capability, scope, input: { ...input.input }, timeoutMs };
}

function prepareTask(task: AgentTaskInput): AgentTaskInput {
  if (!task || typeof task !== "object") throw new AgentContractError("task is required");
  const instruction = requiredText(task.instruction, "task.instruction", 8_000);
  if (!task.context || typeof task.context !== "object" || Array.isArray(task.context)) throw new AgentContractError("task.context must be an object");
  rejectForbiddenKeys(task.context, "task.context");
  return { instruction, context: structuredClone(task.context) };
}

function rejectForbiddenKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CONTEXT_KEY.test(key)) throw new AgentContractError(`${path} contains forbidden secret-like field ${key}`);
    rejectForbiddenKeys(nested, `${path}.${key}`);
  }
}

function prepareScope(scope: InvocationScope): InvocationScope {
  if (!scope || typeof scope !== "object") throw new AgentContractError("scope is required");
  if (scope.visibility === "global-public") return { visibility: "global-public" };
  if (scope.visibility === "brand-private") {
    return {
      visibility: "brand-private",
      workspaceId: requiredText(scope.workspaceId, "workspaceId", 200),
      brandId: requiredText(scope.brandId, "brandId", 200),
    };
  }
  throw new AgentContractError("scope visibility is not supported");
}

function uniqueCapabilities(capabilities: string[]): string[] {
  if (!Array.isArray(capabilities)) throw new AgentContractError("capabilities must be an array");
  const normalized = [...new Set(capabilities.map((capability) => requiredText(capability, "capability", 120).toLowerCase()))];
  for (const capability of normalized) {
    if (!ALLOWED_CAPABILITIES.has(capability)) throw new AgentContractError(`capability ${capability} is not allowed`);
  }
  return normalized;
}

function prepareOutputSchema(schema: OutputSchemaRef): OutputSchemaRef {
  if (!schema || typeof schema !== "object") throw new AgentContractError("outputSchema is required");
  return {
    name: requiredText(schema.name, "outputSchema.name", 120),
    version: requiredText(schema.version, "outputSchema.version", 80),
  };
}

function prepareBudget(budget: AgentBudget): AgentBudget {
  if (!budget || typeof budget !== "object") throw new AgentContractError("budget is required");
  return {
    maxOutputTokens: boundedInteger(budget.maxOutputTokens, "maxOutputTokens", 1, 100_000),
    maxToolCalls: boundedInteger(budget.maxToolCalls, "maxToolCalls", 0, 100),
    maxCostUsd: boundedNumber(budget.maxCostUsd, "maxCostUsd", 0, 100),
    timeoutMs: boundedInteger(budget.timeoutMs, "timeoutMs", 100, 300_000),
  };
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new AgentContractError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new AgentContractError(`${field} is required`);
  if (normalized.length > maxLength) throw new AgentContractError(`${field} is too long`);
  return normalized;
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new AgentContractError(`${field} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function boundedNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new AgentContractError(`${field} must be a number from ${min} to ${max}`);
  }
  return value;
}
