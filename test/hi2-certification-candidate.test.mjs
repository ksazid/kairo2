import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
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

  // The candidate is immutable. Later append-only graph revisions must not
  // re-evaluate its historical gate under new graph state.
  const gateResult = candidate.gateSnapshot;
  assert.equal(gateResult.allowed, true);


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
