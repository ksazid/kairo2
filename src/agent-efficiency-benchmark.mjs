const COST_METRICS = ["workBrowserSteps", "modelCalls", "toolCalls", "tokens", "credits", "testRuntimeMs", "ciRuntimeMs"];
const BENEFIT_METRICS = ["deterministicChecks", "passRate"];

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compareCostMetric(name, baselineValue, optimizedValue, provenance) {
  const baseline = numberOrNull(baselineValue);
  const optimized = numberOrNull(optimizedValue);
  if (baseline === null || optimized === null) {
    return { name, measured: false, baseline, optimized };
  }
  const reduction = baseline - optimized;
  return {
    name,
    measured: true,
    baseline,
    optimized,
    reduction,
    reductionPct: baseline > 0 ? Math.round((reduction / baseline) * 10_000) / 100 : null,
    provenance
  };
}

function compareBenefitMetric(name, baselineValue, optimizedValue, provenance) {
  const baseline = numberOrNull(baselineValue);
  const optimized = numberOrNull(optimizedValue);
  if (baseline === null || optimized === null) {
    return { name, measured: false, baseline, optimized };
  }
  return {
    name,
    measured: true,
    baseline,
    optimized,
    increase: optimized - baseline,
    provenance
  };
}

export function compareAgentEfficiencyProfiles(input) {
  const baseline = input?.baseline ?? {};
  const optimized = input?.optimized ?? {};
  const provenance = baseline.measurementKind === "measured" && optimized.measurementKind === "measured"
    ? "measured-vs-measured"
    : "reference-vs-measured";

  const comparisons = {};
  for (const name of COST_METRICS) {
    comparisons[name] = compareCostMetric(name, baseline.metrics?.[name], optimized.metrics?.[name], provenance);
  }
  for (const name of BENEFIT_METRICS) {
    comparisons[name] = compareBenefitMetric(name, baseline.metrics?.[name], optimized.metrics?.[name], provenance);
  }

  const unmeasured = Object.values(comparisons)
    .filter((item) => !item.measured)
    .map((item) => item.name);

  return {
    schemaVersion: 1,
    kind: "kairo-agent-efficiency-benchmark",
    baseline: {
      id: baseline.id ?? "baseline",
      measurementKind: baseline.measurementKind ?? "unknown"
    },
    optimized: {
      id: optimized.id ?? "optimized",
      measurementKind: optimized.measurementKind ?? "unknown"
    },
    comparisons,
    unmeasured,
    creditSavingsMeasured: !unmeasured.includes("credits"),
    tokenSavingsMeasured: !unmeasured.includes("tokens"),
    caution: provenance === "measured-vs-measured"
      ? null
      : "Reference-route comparisons show orchestration changes, not historical billing or token savings. Credit/token savings require measured data from both routes."
  };
}
