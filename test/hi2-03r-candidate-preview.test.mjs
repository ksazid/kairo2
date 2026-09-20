import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildRankedContext } from "../src/context-engine.mjs";
import { evaluateGate } from "../src/gate-engine.mjs";
import { buildCertificationCandidate, verifyCertificationCandidate } from "../src/certification-engine.mjs";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("HI2-03R certification candidate preview is machine-verifiable", () => {
  const config = read(".engineering/pes-v2.json");
  const governance = read("delivery/governance.json");
  const gatePolicy = read(config.gates.policyFile);
  const certificationPolicy = read(config.certification.policyFile);
  const graph = read("state/graph.json");
  const seeds = [
    "OBJ-HI2-03R",
    "TASK-HI2-03R",
    "ART-HI2-03R",
    "EVAL-HI2-03R",
    "EVID-HI2-03R-01",
    "EVID-HI2-03R-02",
  ];
  const context = buildRankedContext(graph, seeds, config.context);
  const approvals = [
    { type:"scope",status:"approved",actorType:"human",scopeId:"HI2-03R" },
    { type:"policy",status:"approved",actorType:"human",scopeId:"HI2-03R" },
    { type:"implementation",status:"approved",actorType:"human",scopeId:"HI2-03R" },
  ];
  const slice = {
    id:"HI2-03R",
    objectiveId:"OBJ-HI2-03R",
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
    evidenceIds:["EVID-HI2-03R-01","EVID-HI2-03R-02"],
    changedPaths:[
      "apps/api/src/hunter-semantic-expansion.ts",
      "apps/worker/src/hunter-shadow-retrieval.ts",
      "apps/worker/src/hunter-shadow-search-gateway.ts",
      "packages/domain/src/hunter-retrieval.ts",
      "apps/worker/package.json",
      "packages/domain/package.json"
    ],
    deliveryGraph:null,
    authority:config.authority,
  });
  assert.equal(gateResult.allowed, true);

  const candidate = buildCertificationCandidate({
    bundleId:"CERT-HI2-03R-0B820201",
    slice,
    commitSha:"0b82020168bd710c83471c204bef16e77380776f",
    graph,
    context,
    gateResult,
    approvals,
    artifactIds:["ART-HI2-03R"],
    evidenceIds:["EVID-HI2-03R-01","EVID-HI2-03R-02"],
    evaluationIds:["EVAL-HI2-03R"],
    unresolvedRisks:[],
    governance,
    policy:certificationPolicy,
    authority:config.authority,
    createdAt:"2026-09-20T02:03:00.000Z",
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
  console.log("HI2_03R_CONTEXT=" + JSON.stringify(context));
  console.log("HI2_03R_GATE=" + JSON.stringify(gateResult));
  console.log("HI2_03R_CANDIDATE=" + JSON.stringify(candidate));
});
