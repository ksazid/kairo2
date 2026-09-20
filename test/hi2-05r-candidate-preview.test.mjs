import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildRankedContext } from "../src/context-engine.mjs";
import { evaluateGate } from "../src/gate-engine.mjs";
import { buildCertificationCandidate, verifyCertificationCandidate } from "../src/certification-engine.mjs";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("HI2-05R certification candidate preview is machine-verifiable", () => {
  const config = read(".engineering/pes-v2.json");
  const governance = read("delivery/governance.json");
  const gatePolicy = read(config.gates.policyFile);
  const certificationPolicy = read(config.certification.policyFile);
  const graph = read("state/graph.json");
  const seeds = [
    "OBJ-HI2-05R","TASK-HI2-05R","ART-HI2-05R",
    "EVAL-HI2-05R","EVID-HI2-05R-01","EVID-HI2-05R-02"
  ];
  const context = buildRankedContext(graph, seeds, config.context);
  const approvals = [
    { type:"scope",status:"approved",actorType:"human",scopeId:"HI2-05R" },
    { type:"policy",status:"approved",actorType:"human",scopeId:"HI2-05R" },
    { type:"implementation",status:"approved",actorType:"human",scopeId:"HI2-05R" },
  ];
  const slice = {
    id:"HI2-05R",
    objectiveId:"OBJ-HI2-05R",
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
    evidenceIds:["EVID-HI2-05R-01","EVID-HI2-05R-02"],
    changedPaths:[
      "packages/domain/src/hunter-multistage.ts",
      "apps/worker/src/hunter-shadow-multistage-intelligence.ts",
      "packages/domain/package.json",
      "apps/worker/package.json"
    ],
    deliveryGraph:null,
    authority:config.authority,
  });
  assert.equal(gateResult.allowed, true);

  const candidate = buildCertificationCandidate({
    bundleId:"CERT-HI2-05R-4321BA21",
    slice,
    commitSha:"4321ba2149f68498daca51a36e4b7fb69488a487",
    graph,
    context,
    gateResult,
    approvals,
    artifactIds:["ART-HI2-05R"],
    evidenceIds:["EVID-HI2-05R-01","EVID-HI2-05R-02"],
    evaluationIds:["EVAL-HI2-05R"],
    unresolvedRisks:[],
    governance,
    policy:certificationPolicy,
    authority:config.authority,
    createdAt:"2026-09-20T08:34:00.000Z",
  });
  const verification = verifyCertificationCandidate(candidate, {
    graph,context,gateResult,governance,policy:certificationPolicy,
    authority:config.authority,currentCommitSha:candidate.commitSha,
  });
  assert.deepEqual(verification,{ok:true,blockers:[]});
  console.log("HI2_05R_CONTEXT="+JSON.stringify(context));
  console.log("HI2_05R_GATE="+JSON.stringify(gateResult));
  console.log("HI2_05R_CANDIDATE="+JSON.stringify(candidate));
});
