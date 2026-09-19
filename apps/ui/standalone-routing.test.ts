import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL(".", import.meta.url).pathname;
const forbidden = ["kairo-two-plum.vercel.app", "NEXT_PUBLIC_KAIRO_WEB_URL", "Back to Classic Kairo"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") || entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("Kairo v2 standalone routing", () => {
  it("contains no legacy deployment handoffs", () => {
    const source = sourceFiles(root).map((path) => readFileSync(path, "utf8")).join("\n");
    for (const value of forbidden) expect(source).not.toContain(value);
  });
});
