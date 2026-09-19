import { randomUUID } from "node:crypto";
import type { Angle, Idea, ResearchDossier } from "./research";
import { createIdea } from "./research";
import { DomainValidationError } from "./index";

export interface IdeaBundle {
  idea: Idea;
  research: ResearchDossier | null;
  angles: Angle[];
}

export interface ResearchRepository {
  createIdea(accountId: string, idea: Idea): Promise<Idea>;
  listIdeas(accountId: string, brandId: string): Promise<Idea[]>;
  getIdeaBundle(accountId: string, brandId: string, ideaId: string): Promise<IdeaBundle | null>;
  selectAngle(accountId: string, brandId: string, ideaId: string, angleId: string, expectedVersion: number): Promise<Angle[]>;
  editAngleFraming(accountId: string, brandId: string, ideaId: string, angleId: string, framing: string, expectedVersion: number): Promise<Angle>;
}

export interface CreateUserIdeaInput { title: string; premise: string }

export class ResearchService {
  constructor(private readonly repository: ResearchRepository, private readonly now: () => Date = () => new Date()) {}

  createUserIdea(accountId: string, workspaceId: string, brandId: string, input: CreateUserIdeaInput): Promise<Idea> {
    return this.repository.createIdea(accountId, createIdea({
      id: randomUUID(), workspaceId, brandId, title: input.title, premise: input.premise,
      source: { type: "user" }, createdAt: this.now().toISOString(),
    }));
  }

  listIdeas(accountId: string, brandId: string): Promise<Idea[]> { return this.repository.listIdeas(accountId, brandId); }
  getIdea(accountId: string, brandId: string, ideaId: string): Promise<IdeaBundle | null> { return this.repository.getIdeaBundle(accountId, brandId, ideaId); }
  selectAngle(accountId: string, brandId: string, ideaId: string, angleId: string, expectedVersion: number): Promise<Angle[]> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new DomainValidationError("expectedVersion must be a positive integer");
    return this.repository.selectAngle(accountId, brandId, ideaId, angleId, expectedVersion);
  }

  editAngleFraming(accountId: string, brandId: string, ideaId: string, angleId: string, framing: string, expectedVersion: number): Promise<Angle> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new DomainValidationError("expectedVersion must be a positive integer");
    const normalized = typeof framing === "string" ? framing.trim() : "";
    if (!normalized) throw new DomainValidationError("framing is required");
    if (normalized.length > 2_000) throw new DomainValidationError("framing is too long");
    return this.repository.editAngleFraming(accountId, brandId, ideaId, angleId, normalized, expectedVersion);
  }
}
