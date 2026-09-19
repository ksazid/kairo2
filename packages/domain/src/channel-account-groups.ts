import { DomainValidationError } from "./index";

export interface ChannelAccountGroup {
  id: string;
  workspaceId: string;
  brandId: string;
  name: string;
  memberAccountIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function createChannelAccountGroup(input: ChannelAccountGroup): ChannelAccountGroup {
  const createdAt = timestamp(input.createdAt, "createdAt");
  const updatedAt = timestamp(input.updatedAt, "updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new DomainValidationError("updatedAt cannot be before createdAt");
  return {
    id: text(input.id, "id", 200),
    workspaceId: text(input.workspaceId, "workspaceId", 200),
    brandId: text(input.brandId, "brandId", 200),
    name: text(input.name, "name", 120),
    memberAccountIds: members(input.memberAccountIds),
    createdAt,
    updatedAt,
  };
}

export function updateChannelAccountGroup(
  current: ChannelAccountGroup,
  input: { name: string; memberAccountIds: string[]; updatedAt: string },
): ChannelAccountGroup {
  return createChannelAccountGroup({ ...current, ...input, createdAt: current.createdAt });
}

function members(value: unknown): string[] {
  if (!Array.isArray(value)) throw new DomainValidationError("memberAccountIds must be a list");
  if (value.length < 1 || value.length > 20) throw new DomainValidationError("memberAccountIds must contain between 1 and 20 accounts");
  const normalized = value.map((item, index) => text(item, `memberAccountIds[${index}]`, 200));
  if (new Set(normalized).size !== normalized.length) throw new DomainValidationError("memberAccountIds must not contain duplicates");
  return normalized;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const normalized = text(value, field, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new DomainValidationError(`${field} must be a valid timestamp`);
  return normalized;
}
