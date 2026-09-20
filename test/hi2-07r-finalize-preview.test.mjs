import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { finalizeCertification, verifyCertifiedBundle } from "../src/certification-engine.mjs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
test("HI2-07R approved candidate finalizes canonically",()=>{
 const config=read(".engineering/pes-v2.json");
 const governance=read("delivery/governance.json");
 const policy=read(config.certification.policyFile);
 const graph=read("state/graph.json");
 const candidate=read("delivery/hi2-07r-certification-candidate.json");
 const approval=read("delivery/hi2-07r-certification-approval.json");
 const certified=finalizeCertification(candidate,approval,{graph,governance,policy,authority:config.authority,currentCommitSha:candidate.commitSha,certifiedAt:approval.approvedAt});
 assert.deepEqual(verifyCertifiedBundle(certified,{graph,governance,policy,authority:config.authority,currentCommitSha:candidate.commitSha}),{ok:true,blockers:[]});
 console.log("HI2_07R_CERTIFIED="+JSON.stringify(certified));
});