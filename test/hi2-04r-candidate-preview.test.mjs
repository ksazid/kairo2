import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildRankedContext } from "../src/context-engine.mjs";
import { evaluateGate } from "../src/gate-engine.mjs";
import { buildCertificationCandidate, verifyCertificationCandidate } from "../src/certification-engine.mjs";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("HI2-04R certification candidate preview is machine-verifiable", () => {
  const config = read(".engineering/pes-v2.json");
  const governance = read("delivery/governance.json");
  const gatePolicy = read(config.gates.policyFile);
  const certificationPolicy = read(config.certification.policyFile);
  const graph = read("state/graph.json");
  const seeds = [
    "OBJ-HI2-04R",
    "TASK-HI2-04R",
    "ART-HI2-04R",
    "EVAL-HI2-04R",
    "EVID-HI2-04R-01",
    "EVID-HI2-04R-02",
  ];
  const context = buildRankedContext(graph, seeds, config.context);
  const approvals = [
    { type:"scope",status:"approved",actorType:"human",scopeId:"HI2-04R" },
    { type:"policy",status:"approved",actorType:"human",scopeId:"HI2-04R" },
    { type:"implementation",status:"approved",actorType:"human",scopeId:"HI2-04R" },
  ];
  const slice = {
    id:"HI2-04R",
    objectiveId:"OBJ-HI2-04R",
    state:"testing",
    riskLevel:"medium",
    implementationPermission:"runtime-enabled",
  };
  const gateResult = evaluateGate({
    slice,
    requestedState:"certification",
    governance,
    policy:gatePolicy,
    graph,
    context,
    approvals,
    evidenceIds:["EVID-HI2-04R-01","EVID-HI2-04R-02"],
    changedPaths:[
      "apps/worker/src/hunter-shadow-trend-intelligence.ts",
      "apps/worker/src/hunter-shadow-trend-intelligence.test.ts",
      "apps/worker/package.json"
    ],
    deliveryGraph:null,
    authority:config.authority,
  });
  assert.equal(gateResult.allowed, true);

  const candidate = buildCertificationCandidate({
    bundleId:"CERT-HI2-04R-43B78206",
    slice,
    commitSha:"43b78206d262edcbcb30e4b06938beed0149b5f4",
    graph,
    context,
    gateResult,
    approvals,
    artifactIds:["ART-HI2-04R"],
    evidenceIds:["EVID-HI2-04R-01","EVID-HI2-04R-02"],
    evaluationIds:["EVAL-HI2-04R"],
    unresolvedRisks:[],
    governance,
    policy:certificationPolicy,
    authority:config.authority,
    createdAt:"2026-09-20T08:08:00.000Z",
  });
  const verification = verifyCertificationCandidate(candidate, {
    graph,
    context,
    gateResult,
    governance,
    policy:certificationPolicy,
    authority:config.authority,
    currentCommitSha:candidate.commitSha,
  });
  assert.deepEqual(verification, { ok:true, blockers:[] });
  console.log("HI2_04R_CONTEXT=" + JSON.stringify(context));
  console.log("HI2_04R_GATE=" + JSON.stringify(gateResult));
  console.log("HI2_04R_CANDIDATE=" + JSON.stringify(candidate));
});
