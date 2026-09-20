import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildRankedContext } from "../src/context-engine.mjs";
import { evaluateGate } from "../src/gate-engine.mjs";
import { buildCertificationCandidate, verifyCertificationCandidate } from "../src/certification-engine.mjs";
const read = path => JSON.parse(fs.readFileSync(path,"utf8"));
test("HI2-07R certification candidate preview is machine-verifiable",()=>{
 const config=read(".engineering/pes-v2.json");
 const governance=read("delivery/governance.json");
 const gatePolicy=read(config.gates.policyFile);
 const certificationPolicy=read(config.certification.policyFile);
 const graph=read("state/graph.json");
 assert.equal(graph.revision,21);
 const context=buildRankedContext(graph,["OBJ-HI2-07R","TASK-HI2-07R","ART-HI2-07R","EVAL-HI2-07R","EVID-HI2-07R-01","EVID-HI2-07R-02"],config.context);
 const approvals=[
  {type:"scope",status:"approved",actorType:"human",scopeId:"HI2-07R"},
  {type:"policy",status:"approved",actorType:"human",scopeId:"HI2-07R"},
  {type:"implementation",status:"approved",actorType:"human",scopeId:"HI2-07R"}
 ];
 const slice={id:"HI2-07R",objectiveId:"OBJ-HI2-07R",state:"testing",riskLevel:"medium",implementationPermission:"runtime-enabled"};
 const gateResult=evaluateGate({
  slice,requestedState:"certification",governance,policy:gatePolicy,graph,context,approvals,
  evidenceIds:["EVID-HI2-07R-01","EVID-HI2-07R-02"],
  changedPaths:["packages/domain/src/feedback-learning-v2.ts","packages/domain/src/feedback-learning-v2.test.ts","apps/worker/src/hunter-shadow-feedback-loop.test.ts","packages/domain/package.json"],
  deliveryGraph:null,
  authority:config.authority
 });
 assert.equal(gateResult.allowed,true,JSON.stringify(gateResult.blockers));
 const candidate=buildCertificationCandidate({
  bundleId:"CERT-HI2-07R-6E596168",slice,commitSha:"6e5961689a0fb35478f26626c1144fb2bc36f04c",graph,context,gateResult,approvals,
  artifactIds:["ART-HI2-07R"],evidenceIds:["EVID-HI2-07R-01","EVID-HI2-07R-02"],evaluationIds:["EVAL-HI2-07R"],
  unresolvedRisks:[],governance,policy:certificationPolicy,authority:config.authority,createdAt:"2026-09-20T09:30:00.000Z"
 });
 const verification=verifyCertificationCandidate(candidate,{graph,context,gateResult,governance,policy:certificationPolicy,authority:config.authority,currentCommitSha:candidate.commitSha});
 assert.deepEqual(verification,{ok:true,blockers:[]});
 console.log("HI2_07R_CONTEXT="+JSON.stringify(context));
 console.log("HI2_07R_GATE="+JSON.stringify(gateResult));
 console.log("HI2_07R_CANDIDATE="+JSON.stringify(candidate));
});