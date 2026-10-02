import fs from "node:fs";
import { nextRouteBlock, routeAgentTask } from "../src/agent-routing.mjs";

const policy = JSON.parse(fs.readFileSync(".engineering/agent-routing.json", "utf8"));
const args = process.argv.slice(2);
let task = "";
let next = "Continue the smallest approved Kairo slice.";
let authenticated = false;
let visual = false;
let failureEvidence = false;
let jsonOnly = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--task") task = args[++i] ?? "";
  else if (arg === "--next") next = args[++i] ?? next;
  else if (arg === "--authenticated") authenticated = true;
  else if (arg === "--visual") visual = true;
  else if (arg === "--failure-evidence") failureEvidence = true;
  else if (arg === "--json") jsonOnly = true;
  else if (!task) task = arg;
}

if (!task) {
  console.error("Usage: npm run agent:route -- --task <task> [--authenticated] [--visual] [--failure-evidence] [--next \"action\"] [--json]");
  process.exit(2);
}

const result = routeAgentTask(policy, { task, authenticated, visual, failureEvidence });
if (jsonOnly) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else process.stdout.write(`${JSON.stringify(result, null, 2)}\n\n${nextRouteBlock(result, next)}\n`);
