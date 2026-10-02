import test from "node:test";
import assert from "node:assert/strict";
import { compareAgentEfficiencyProfiles } from "../src/agent-efficiency-benchmark.mjs";

test("agent efficiency benchmark distinguishes reference savings from measured credit savings", () => {
  const result = compareAgentEfficiencyProfiles({
    baseline: {
      id: "work-heavy-reference",
      measurementKind: "reference",
      metrics: {
        workBrowserSteps: 7,
        deterministicChecks: 0,
        credits: null,
        tokens: null
      }
    },
    optimized: {
      id: "playwright",
      measurementKind: "measured",
      metrics: {
        workBrowserSteps: 0,
        deterministicChecks: 4,
        credits: null,
        tokens: null
      }
    }
  });

  assert.equal(result.comparisons.workBrowserSteps.measured, true);
  assert.equal(result.comparisons.workBrowserSteps.reduction, 7);
  assert.equal(result.comparisons.workBrowserSteps.reductionPct, 100);
  assert.equal(result.comparisons.deterministicChecks.increase, 4);
  assert.equal(result.creditSavingsMeasured, false);
  assert.equal(result.tokenSavingsMeasured, false);
  assert.match(result.caution, /not historical billing/i);
});

test("agent efficiency benchmark calculates measured-to-measured reductions when evidence exists", () => {
  const result = compareAgentEfficiencyProfiles({
    baseline: {
      id: "before",
      measurementKind: "measured",
      metrics: { modelCalls: 8, toolCalls: 20, credits: 10, tokens: 1000, passRate: 0.75 }
    },
    optimized: {
      id: "after",
      measurementKind: "measured",
      metrics: { modelCalls: 2, toolCalls: 8, credits: 4, tokens: 400, passRate: 1 }
    }
  });

  assert.equal(result.comparisons.modelCalls.reductionPct, 75);
  assert.equal(result.comparisons.credits.reductionPct, 60);
  assert.equal(result.comparisons.tokens.reductionPct, 60);
  assert.equal(result.comparisons.passRate.increase, 0.25);
  assert.equal(result.creditSavingsMeasured, true);
  assert.equal(result.caution, null);
});
