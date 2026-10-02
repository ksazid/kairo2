import fs from "node:fs";
import { compareAgentEfficiencyProfiles } from "../src/agent-efficiency-benchmark.mjs";

const path = process.argv[2] ?? "evaluation/agent-efficiency-phase2.json";
if (!fs.existsSync(path)) {
  console.error(`Benchmark input not found: ${path}`);
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(path, "utf8"));
const result = compareAgentEfficiencyProfiles(input);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
