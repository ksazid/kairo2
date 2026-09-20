import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { contextHashFor } from "../src/context-engine.mjs";
import { evaluateGate } from "../src/gate-engine.mjs";
import { certificationCandidateHash, verifyCertificationCandidate } from "../src/certification-engine.mjs";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("HI2-02R certification candidate is machine-verifiable", () => {
  const config = read(".engineering/pes-v2.json");
  const governance = read("delivery/governance.json");
  const gatePolicy = read(config.gates.policyFile);
  const certificationPolicy = read(config.certification.policyFile);
  const graph = read("state/graph.json");
  const context = read("delivery/hi2-02r-context.json");
  const gateInput = read("delivery/hi2-02r-gate-input.json");
  const candidate = read("delivery/hi2-02r-certification-candidate.json");

  assert.equal(context.graphRevision, graph.revision);
  assert.equal(contextHashFor(context), context.contextHash);
  assert.equal(certificationCandidateHash(candidate), candidate.candidateHash);

  const gateResult = evaluateGate({
    ...gateInput,
    requestedState: "certification",
    governance,
    policy: gatePolicy,
    graph,
    authority: config.authority,
  });
  assert.deepEqual(gateResult, candidate.gateSnapshot);

  const verification = verifyCertificationCandidate(candidate, {
    graph,
    context,
    gateResult,
    governance,
    policy: certificationPolicy,
    authority: config.authority,
    currentCommitSha: candidate.commitSha,
  });

  assert.deepEqual(verification, { ok: true, blockers: [] });
});
