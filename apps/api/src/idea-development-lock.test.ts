import { describe, expect, it, vi } from "vitest";
import { PgIdeaDevelopmentLock } from "./idea-development-lock";

describe("PgIdeaDevelopmentLock", () => {
  it("holds one Brand-and-Idea advisory lock around the complete development operation", async () => {
    const events: string[] = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[]) => {
        events.push(`${sql.includes("unlock") ? "unlock" : "lock"}:${values[0]}`);
        return { rows: [] };
      }),
      release: vi.fn(() => events.push("release")),
    };
    const lock = new PgIdeaDevelopmentLock({ connect: vi.fn(async () => client) } as never);

    const result = await lock.run("brand-1", "idea-1", async () => {
      events.push("work");
      return "done";
    });

    expect(result).toBe("done");
    expect(events).toEqual([
      "lock:kairo:idea-development:brand-1:idea-1",
      "work",
      "unlock:kairo:idea-development:brand-1:idea-1",
      "release",
    ]);
  });

  it("unlocks and releases when development fails", async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const lock = new PgIdeaDevelopmentLock({ connect: vi.fn(async () => client) } as never);

    await expect(lock.run("brand-1", "idea-1", async () => { throw new Error("generation failed"); })).rejects.toThrow("generation failed");
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
