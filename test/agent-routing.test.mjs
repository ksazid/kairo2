import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { nextRouteBlock, routeAgentTask, validateAgentRoutingPolicy } from "../src/agent-routing.mjs";

const policy = JSON.parse(fs.readFileSync(".engineering/agent-routing.json", "utf8"));

test("agent routing policy is valid and unique", () => {
  assert.equal(validateAgentRoutingPolicy(policy), policy);
});

test("routine implementation routes to Codex with medium coding effort", () => {
  const result = routeAgentTask(policy, { task: "implementation" });
  assert.equal(result.environment, "CODEX");
  assert.equal(result.modelClass, "coding");
  assert.equal(result.reasoningEffort, "medium");
  assert.deepEqual(result.verification, ["agent:verify"]);
  assert.equal(result.workAllowed, false);
});

test("repeatable browser regression uses Playwright with no model", () => {
  const result = routeAgentTask(policy, { task: "browser-regression" });
  assert.equal(result.environment, "CI-PLAYWRIGHT");
  assert.equal(result.modelClass, "none");
  assert.equal(result.reasoningEffort, "none");
});

test("browser debug cannot escalate to Work without failure evidence", () => {
  const guarded = routeAgentTask(policy, { task: "browser-debug" });
  assert.equal(guarded.environment, "CI-PLAYWRIGHT");
  assert.equal(guarded.source, "guard");

  const escalated = routeAgentTask(policy, { task: "browser-debug", failureEvidence: true });
  assert.equal(escalated.environment, "WORK");
  assert.equal(escalated.reasoningEffort, "high");
});

test("authenticated browser work may route to Work", () => {
  const result = routeAgentTask(policy, { task: "authenticated-browser", authenticated: true });
  assert.equal(result.environment, "WORK");
  assert.equal(result.workAllowed, true);
});

test("Work route without qualifying browser need falls back to deterministic automation", () => {
  const result = routeAgentTask(policy, { task: "visual-qa" });
  assert.equal(result.environment, "CI-PLAYWRIGHT");
  assert.equal(result.source, "guard");
});

test("release decision preserves human approval requirement", () => {
  const result = routeAgentTask(policy, { task: "release-decision" });
  assert.equal(result.environment, "CHAT");
  assert.equal(result.humanApprovalRequired, true);
  assert.match(nextRouteBlock(result, "Review release evidence."), /Approval:\*\* REQUIRED/);
});
