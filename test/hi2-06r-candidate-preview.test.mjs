import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildRankedContext } from "../src/context-engine.mjs";
import { evaluateGate } from "../src/gate-engine.mjs";
import { buildCertificationCandidate, verifyCertificationCandidate } from "../src/certification-engine.mjs";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("HI2-06R certification candidate preview is machine-verifiable", () => {
  const config = read(".engineering/pes-v2.json");
  const governance = read("delivery/governance.json");
  const gatePolicy = read(config.gates.policyFile);
  const certificationPolicy = read(config.certification.policyFile);
  const graph = read("state/graph.json");
  const seeds = [
    "OBJ-HI2-06R","TASK-HI2-06R","ART-HI2-06R",
    "EVAL-HI2-06R","EVID-HI2-06R-01","EVID-HI2-06R-02"
  ];
  const context = buildRankedContext(graph, seeds, config.context);
  const approvals = [
    { type:"scope",status:"approved",actorType:"human",scopeId:"HI2-06R" },
    { type:"policy",status:"approved",actorType:"human",scopeId:"HI2-06R" },
    { type:"implementation",status:"approved",actorType:"human",scopeId:"HI2-06R" },
  ];
  const slice = {
    id:"HI2-06R",
    objectiveId:"OBJ-HI2-06R",
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
    evidenceIds:["EVID-HI2-06R-01","EVID-HI2-06R-02"],
    changedPaths:[
      "apps/worker/src/hunter-shadow-eei-v2.ts",
      "apps/worker/src/hunter-shadow-eei-v2.test.ts",
      "apps/worker/package.json"
    ],
    deliveryGraph:null,
    authority:config.authority,
  });
  assert.equal(gateResult.allowed, true);

  const candidate = buildCertificationCandidate({
    bundleId:"CERT-HI2-06R-C2952E3C",
    slice,
    commitSha:"c2952e3c354b84e87903b49c61e91bd52b141ec0",
    graph,
    context,
    gateResult,
    approvals,
    artifactIds:["ART-HI2-06R"],
    evidenceIds:["EVID-HI2-06R-01","EVID-HI2-06R-02"],
    evaluationIds:["EVAL-HI2-06R"],
    unresolvedRisks:[],
    governance,
    policy:certificationPolicy,
    authority:config.authority,
    createdAt:"2026-09-20T08:57:00.000Z",
  });
  const verification = verifyCertificationCandidate(candidate, {
    graph,context,gateResult,governance,policy:certificationPolicy,
    authority:config.authority,currentCommitSha:candidate.commitSha,
  });
  assert.deepEqual(verification,{ok:true,blockers:[]});
  console.log("HI2_06R_CONTEXT="+JSON.stringify(context));
  console.log("HI2_06R_GATE="+JSON.stringify(gateResult));
  console.log("HI2_06R_CANDIDATE="+JSON.stringify(candidate));
});
