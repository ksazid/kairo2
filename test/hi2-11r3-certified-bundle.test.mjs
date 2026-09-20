import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { verifyCertifiedBundle } from "../src/certification-engine.mjs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
test("HI2-11R3 certified bundle remains valid after append-only graph revisions",()=>{const c=read(".engineering/pes-v2.json"),g=read("state/graph.json"),b=read("delivery/hi2-11r3-certified.json");assert.deepEqual(verifyCertifiedBundle(b,{graph:g,governance:read("delivery/governance.json"),policy:read(c.certification.policyFile),authority:c.authority,currentCommitSha:b.commitSha}),{ok:true,blockers:[]});});
