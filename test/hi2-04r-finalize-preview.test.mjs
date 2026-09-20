import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { finalizeCertification, verifyCertifiedBundle } from "../src/certification-engine.mjs";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("HI2-04R final certification bundle can be generated from the approved candidate", () => {
  const config = read(".engineering/pes-v2.json");
  const governance = read("delivery/governance.json");
  const policy = read(config.certification.policyFile);
  const graph = read("state/graph.json");
  const candidate = read("delivery/hi2-04r-certification-candidate.json");
  const approval = read("delivery/hi2-04r-certification-approval.json");

  const certified = finalizeCertification(candidate, approval, {
    graph,
    governance,
    policy,
    authority: config.authority,
    currentCommitSha: candidate.commitSha,
    certifiedAt: approval.approvedAt,
  });

  const verification = verifyCertifiedBundle(certified, {
    graph,
    governance,
    policy,
    authority: config.authority,
    currentCommitSha: candidate.commitSha,
  });

  assert.deepEqual(verification, { ok: true, blockers: [] });
  console.log("HI2_04R_CERTIFIED=" + JSON.stringify(certified));
});
