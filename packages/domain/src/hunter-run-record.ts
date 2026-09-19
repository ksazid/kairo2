export const HUNTER_RUN_SCHEMA_VERSION = "1" as const;

export type HunterRunTrigger = "manual" | "scheduled";
export type HunterRunStatus = "running" | "succeeded" | "failed";

export interface HunterRunRecord {
  schemaVersion: typeof HUNTER_RUN_SCHEMA_VERSION;
  runId: string;
  workspaceId: string;
  brandId: string;
  snapshotVersion: string;
  planVersion: string;
  trigger: HunterRunTrigger;
  status: HunterRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  evidenceCount: number;
  candidateCount: number;
  opportunityCount: number;
  sourcesScanned: string[];
  degradedSources: string[];
  failureCode?: string;
  failureMessage?: string;
}

export interface StartHunterRunInput {
  workspaceId: string;
  brandId: string;
  snapshotVersion: string;
  planVersion: string;
  trigger: HunterRunTrigger;
  startedAt: string;
}

export interface CompleteHunterRunInput {
  completedAt: string;
  durationMs: number;
  evidenceCount: number;
  candidateCount: number;
  opportunityCount: number;
  sourcesScanned: string[];
  degradedSources: string[];
}

export interface FailHunterRunInput {
  completedAt: string;
  durationMs: number;
  sourcesScanned: string[];
  degradedSources: string[];
  failureCode: string;
  failureMessage: string;
}

export interface HunterRunRepository {
  start(accountId: string, input: StartHunterRunInput): Promise<HunterRunRecord>;
  complete(accountId: string, runId: string, input: CompleteHunterRunInput): Promise<HunterRunRecord>;
  fail(accountId: string, runId: string, input: FailHunterRunInput): Promise<HunterRunRecord>;
  listRecent(accountId: string, brandId: string, limit?: number): Promise<HunterRunRecord[]>;
  getLatest(accountId: string, brandId: string): Promise<HunterRunRecord | undefined>;
}
