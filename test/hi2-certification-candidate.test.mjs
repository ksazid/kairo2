import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGate } from "../src/gate-engine.mjs";
import { verifyCertificationCandidate } from "../src/certification-engine.mjs";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("HI2-01 certification candidate is valid for the exact implementation SHA", () => {
  const config = read(".engineering/pes-v2.json");
  const governance = read("delivery/governance.json");
  const gatePolicy = read(config.gates.policyFile);
  const certificationPolicy = read(config.certification.policyFile);
  const graph = read("state/graph.json");
  const candidate = read("delivery/hi2-01-certification-candidate.json");
  const gateInput = read("delivery/hi2-01-gate-input.json");

  const gateResult = evaluateGate({
    ...gateInput,
    requestedState: "certification",
    governance,
    policy: gatePolicy,
    graph,
    authority: config.authority,
  });

  assert.equal(gateResult.allowed, true);
  assert.deepEqual(gateResult, candidate.gateSnapshot);

  const verification = verifyCertificationCandidate(candidate, {
    graph,
    context: candidate.contextSnapshot,
    gateResult,
    governance,
    policy: certificationPolicy,
    authority: config.authority,
    currentCommitSha: candidate.commitSha,
  });

  assert.deepEqual(verification, { ok: true, blockers: [] });
});
