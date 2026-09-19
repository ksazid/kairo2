import { DomainValidationError } from "./index";

export type MarketingCapability =
  | "social-strategy"
  | "content-strategy"
  | "hook-strategy"
  | "carousel-strategy"
  | "reel-strategy"
  | "copy-editing"
  | "marketing-psychology";

export type MarketingFormat = "text" | "static" | "carousel" | "reel";
export type SkillExecutionMode = "native" | "reference-only" | "sandboxed";
export type SkillStatus = "approved" | "evaluation" | "rejected" | "disabled";
export type SkillBenchmarkStatus = "baseline" | "pending" | "shadow" | "live" | "qualified" | "failed";
export type MarketingBenchmarkExecutionStage = "shadow" | "live";

export type SkillSourceRef =
  | { kind: "kairo-native" }
  | {
      kind: "github";
      repository: string;
      commitSha: string;
      path: string;
      contentHash: string;
      license: string;
    }
  | { kind: "future"; provider: string; version: string };

export interface MarketingSkillPermissions {
  network: boolean;
  secrets: boolean;
  brandPrivateContext: boolean;
  publishing: boolean;
}

export interface MarketingSkillManifest {
  id: string;
  version: string;
  name: string;
  capabilities: MarketingCapability[];
  source: SkillSourceRef;
  executionMode: SkillExecutionMode;
  permissions: MarketingSkillPermissions;
  status: SkillStatus;
  benchmarkStatus: SkillBenchmarkStatus;
}

export interface BrandSkillQualificationEvidence {
  verdict: "qualified-for-brand" | "advance-to-shadow" | "advance-to-live" | "keep-baseline" | "reject-challenger" | "insufficient-evidence";
  workspaceId: string;
  brandId: string;
  capability: MarketingCapability;
  format: MarketingFormat;
  challengerSkillId: string;
  challengerSkillVersion: string;
}

export interface BrandSkillSelection {
  workspaceId: string;
  brandId: string;
  capability: MarketingCapability;
  format: MarketingFormat;
  skillId: string;
  skillVersion: string;
  selectedAt: string;
}

export interface MarketingSkillRegistry {
  readonly manifests: readonly MarketingSkillManifest[];
  listByCapability(capability: MarketingCapability): MarketingSkillManifest[];
  executableByCapability(capability: MarketingCapability): MarketingSkillManifest[];
  get(id: string, version?: string): MarketingSkillManifest | undefined;
}

export function createMarketingSkillRegistry(input: readonly MarketingSkillManifest[]): MarketingSkillRegistry {
  const manifests = input.map(validateMarketingSkillManifest);
  const keys = new Set<string>();
  for (const manifest of manifests) {
    const key = `${manifest.id}@${manifest.version}`;
    if (keys.has(key)) throw new DomainValidationError(`Duplicate marketing skill version: ${key}`);
    keys.add(key);
  }
  return {
    manifests,
    listByCapability(capability) {
      return manifests.filter((manifest) => manifest.capabilities.includes(capability));
    },
    executableByCapability(capability) {
      return manifests.filter((manifest) => manifest.capabilities.includes(capability) && canExecuteMarketingSkill(manifest));
    },
    get(id, version) {
      return manifests.find((manifest) => manifest.id === id && (version === undefined || manifest.version === version));
    },
  };
}

export function validateMarketingSkillManifest(input: MarketingSkillManifest): MarketingSkillManifest {
  const id = text(input.id, "skill.id", 160);
  const version = text(input.version, "skill.version", 120);
  const name = text(input.name, "skill.name", 240);
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) throw new DomainValidationError("skill.capabilities requires at least one capability");
  const capabilities = [...new Set(input.capabilities.map((value) => enumValue(value, CAPABILITIES, "skill.capability")))];
  const executionMode = enumValue(input.executionMode, EXECUTION_MODES, "skill.executionMode");
  const status = enumValue(input.status, STATUSES, "skill.status");
  const benchmarkStatus = enumValue(input.benchmarkStatus, BENCHMARK_STATUSES, "skill.benchmarkStatus");
  const permissions = validatePermissions(input.permissions);
  const source = validateSource(input.source);

  if (source.kind === "kairo-native" && executionMode !== "native") throw new DomainValidationError("Kairo-native skills must use native execution mode");
  if (source.kind !== "kairo-native" && executionMode === "native") throw new DomainValidationError("External skills cannot use native execution mode");
  if (executionMode === "reference-only" && (permissions.network || permissions.secrets || permissions.brandPrivateContext || permissions.publishing)) {
    throw new DomainValidationError("Reference-only skills must have zero runtime permissions");
  }
  if (executionMode === "sandboxed") {
    if (!["shadow", "live", "qualified"].includes(benchmarkStatus)) throw new DomainValidationError("Sandboxed skills require shadow, live or qualified benchmark status");
    if (status === "rejected" || status === "disabled") throw new DomainValidationError("Rejected or disabled skills cannot be sandboxed");
    if (benchmarkStatus === "qualified" && status !== "approved") throw new DomainValidationError("Qualified sandboxed skills require approved status");
  }
  if (permissions.publishing) throw new DomainValidationError("Marketing skills cannot receive publishing authority");

  return { id, version, name, capabilities, source, executionMode, permissions, status, benchmarkStatus };
}

export function canRunMarketingSkillInBenchmark(input: MarketingSkillManifest, stage: MarketingBenchmarkExecutionStage): boolean {
  const skill = validateMarketingSkillManifest(input);
  if (skill.executionMode === "native") return skill.status === "approved" && skill.benchmarkStatus === "baseline";
  if (skill.executionMode !== "sandboxed" || (skill.status !== "evaluation" && skill.status !== "approved")) return false;
  if (stage === "shadow") return skill.benchmarkStatus === "shadow" || skill.benchmarkStatus === "live" || skill.benchmarkStatus === "qualified";
  return skill.benchmarkStatus === "live" || skill.benchmarkStatus === "qualified";
}

export function canExecuteMarketingSkill(input: MarketingSkillManifest): boolean {
  const skill = validateMarketingSkillManifest(input);
  if (skill.status !== "approved") return false;
  if (skill.executionMode === "native") return skill.source.kind === "kairo-native" && skill.benchmarkStatus === "baseline";
  return skill.executionMode === "sandboxed" && skill.benchmarkStatus === "qualified";
}

export function createBrandSkillSelection(input: {
  workspaceId: string;
  brandId: string;
  capability: MarketingCapability;
  format: MarketingFormat;
  skill: MarketingSkillManifest;
  qualification: BrandSkillQualificationEvidence;
  selectedAt: string;
}): BrandSkillSelection {
  const skill = validateMarketingSkillManifest(input.skill);
  const workspaceId = text(input.workspaceId, "workspaceId", 200);
  const brandId = text(input.brandId, "brandId", 200);
  const capability = enumValue(input.capability, CAPABILITIES, "capability");
  const format = enumValue(input.format, FORMATS, "format");
  if (!skill.capabilities.includes(capability)) throw new DomainValidationError("Selected skill does not provide the requested capability");
  if (!canExecuteMarketingSkill(skill)) throw new DomainValidationError("Selected skill is not approved for execution");
  const q = input.qualification;
  if (
    q.verdict !== "qualified-for-brand" ||
    q.workspaceId !== workspaceId ||
    q.brandId !== brandId ||
    q.capability !== capability ||
    q.format !== format ||
    q.challengerSkillId !== skill.id ||
    q.challengerSkillVersion !== skill.version
  ) throw new DomainValidationError("Brand skill selection requires matching Brand qualification evidence");
  return { workspaceId, brandId, capability, format, skillId: skill.id, skillVersion: skill.version, selectedAt: timestamp(input.selectedAt, "selectedAt") };
}

const CAPABILITIES = ["social-strategy", "content-strategy", "hook-strategy", "carousel-strategy", "reel-strategy", "copy-editing", "marketing-psychology"] as const;
const FORMATS = ["text", "static", "carousel", "reel"] as const;
const EXECUTION_MODES = ["native", "reference-only", "sandboxed"] as const;
const STATUSES = ["approved", "evaluation", "rejected", "disabled"] as const;
const BENCHMARK_STATUSES = ["baseline", "pending", "shadow", "live", "qualified", "failed"] as const;

function validateSource(source: SkillSourceRef): SkillSourceRef {
  if (!source || typeof source !== "object") throw new DomainValidationError("skill.source is required");
  if (source.kind === "kairo-native") return { kind: "kairo-native" };
  if (source.kind === "github") {
    const repository = text(source.repository, "skill.source.repository", 240);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new DomainValidationError("GitHub repository must use owner/name");
    const commitSha = exactSha(source.commitSha, "skill.source.commitSha");
    const path = text(source.path, "skill.source.path", 500);
    if (path.startsWith("/") || path.includes("..")) throw new DomainValidationError("GitHub skill path is invalid");
    const contentHash = exactSha(source.contentHash, "skill.source.contentHash");
    return { kind: "github", repository, commitSha, path, contentHash, license: text(source.license, "skill.source.license", 120) };
  }
  if (source.kind === "future") return { kind: "future", provider: text(source.provider, "skill.source.provider", 200), version: text(source.version, "skill.source.version", 120) };
  throw new DomainValidationError("Unsupported skill source kind");
}

function validatePermissions(value: MarketingSkillPermissions): MarketingSkillPermissions {
  if (!value || typeof value !== "object") throw new DomainValidationError("skill.permissions is required");
  for (const key of ["network", "secrets", "brandPrivateContext", "publishing"] as const) if (typeof value[key] !== "boolean") throw new DomainValidationError(`skill.permissions.${key} must be boolean`);
  return { network: value.network, secrets: value.secrets, brandPrivateContext: value.brandPrivateContext, publishing: value.publishing };
}
function exactSha(value: unknown, field: string): string { const normalized = text(value, field, 40); if (!/^[0-9a-f]{40}$/i.test(normalized)) throw new DomainValidationError(`${field} must be an exact 40-character SHA`); return normalized.toLowerCase(); }
function timestamp(value: unknown, field: string): string { const normalized = text(value, field, 80); if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(`${field} must be a valid timestamp`); return normalized; }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`); const normalized = value.trim(); if (normalized.length > max) throw new DomainValidationError(`${field} is too long`); return normalized; }
function enumValue<const T extends string>(value: unknown, values: readonly T[], field: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new DomainValidationError(`${field} is not supported`); return value as T; }
