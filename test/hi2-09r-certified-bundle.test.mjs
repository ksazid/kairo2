import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { verifyCertifiedBundle } from "../src/certification-engine.mjs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
test("HI2-09R certified bundle remains valid after unrelated append-only graph revisions",()=>{
 const config=read(".engineering/pes-v2.json");
 const governance=read("delivery/governance.json");
 const policy=read(config.certification.policyFile);
 const graph=read("state/graph.json");
 const bundle=read("delivery/hi2-09r-certified.json");
 assert.deepEqual(verifyCertifiedBundle(bundle,{graph,governance,policy,authority:config.authority,currentCommitSha:bundle.commitSha}),{ok:true,blockers:[]});
});