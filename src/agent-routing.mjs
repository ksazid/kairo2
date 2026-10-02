const ENVIRONMENTS = new Set(["CHAT", "CODEX", "CI-PLAYWRIGHT", "WORK"]);
const MODEL_CLASSES = new Set(["none", "general", "coding", "reasoning", "vision-reasoning"]);
const EFFORTS = new Set(["none", "low", "medium", "high"]);

export function validateAgentRoutingPolicy(policy) {
  if (!policy || policy.schemaVersion !== 1) throw new Error("agent routing policy schemaVersion must be 1");
  if (!Array.isArray(policy.routes) || policy.routes.length === 0) throw new Error("agent routing policy requires routes");
  const seen = new Set();
  for (const route of policy.routes) {
    if (!route?.task || typeof route.task !== "string") throw new Error("route.task is required");
    if (seen.has(route.task)) throw new Error(`duplicate task route: ${route.task}`);
    seen.add(route.task);
    validateRoute(route);
  }
  validateRoute(policy.default);
  return policy;
}

function validateRoute(route) {
  if (!ENVIRONMENTS.has(route.environment)) throw new Error(`unsupported environment: ${route.environment}`);
  if (!MODEL_CLASSES.has(route.modelClass)) throw new Error(`unsupported modelClass: ${route.modelClass}`);
  if (!EFFORTS.has(route.reasoningEffort)) throw new Error(`unsupported reasoningEffort: ${route.reasoningEffort}`);
  if (!Array.isArray(route.verification)) throw new Error("route.verification must be an array");
  if (typeof route.workAllowed !== "boolean") throw new Error("route.workAllowed must be boolean");
  if (route.environment === "WORK" && !route.workAllowed) throw new Error("WORK routes must explicitly allow Work");
  if (route.environment !== "WORK" && route.workAllowed) throw new Error("non-WORK routes cannot allow Work");
}

export function routeAgentTask(policyInput, input) {
  const policy = validateAgentRoutingPolicy(policyInput);
  const task = String(input?.task ?? "").trim();
  const matched = policy.routes.find((route) => route.task === task);
  const source = matched ? "explicit" : "default";
  const route = structuredClone(matched ?? policy.default);
  const failureEvidence = Boolean(input?.failureEvidence);
  const authenticated = Boolean(input?.authenticated);
  const visual = Boolean(input?.visual);

  if (route.requiresFailureEvidence && !failureEvidence) {
    return {
      task,
      source: "guard",
      environment: "CI-PLAYWRIGHT",
      modelClass: "none",
      reasoningEffort: "none",
      verification: ["e2e:kairo"],
      workAllowed: false,
      humanApprovalRequired: false,
      reason: "Browser debugging requires deterministic failure evidence before Work escalation."
    };
  }

  if (route.environment === "WORK" && !(authenticated || visual || failureEvidence)) {
    return {
      task,
      source: "guard",
      environment: "CI-PLAYWRIGHT",
      modelClass: "none",
      reasoningEffort: "none",
      verification: route.verification.length ? route.verification : ["e2e:kairo"],
      workAllowed: false,
      humanApprovalRequired: false,
      reason: "Work is reserved for authenticated, visual, or evidence-backed browser tasks."
    };
  }

  return {
    task,
    source,
    environment: route.environment,
    modelClass: route.modelClass,
    reasoningEffort: route.reasoningEffort,
    verification: [...route.verification],
    workAllowed: route.workAllowed,
    humanApprovalRequired: Boolean(route.humanApprovalRequired),
    reason: reasonFor(route)
  };
}

function reasonFor(route) {
  if (route.environment === "CHAT") return "Use Chat for decisions and reasoning that do not require repository or browser execution.";
  if (route.environment === "CODEX") return "Use Codex for bounded repository implementation and code investigation.";
  if (route.environment === "CI-PLAYWRIGHT") return "Use deterministic automation instead of model-backed browser work.";
  return "Use Work only for authenticated browser interaction, visual QA, or evidence-backed browser debugging.";
}

export function nextRouteBlock(result, next) {
  const approval = result.humanApprovalRequired ? "REQUIRED" : "NOT REQUIRED";
  return [
    "### NEXT EXECUTION ROUTE",
    `**Next:** ${next}`,
    `**Run in:** ${result.environment}`,
    `**Reason:** ${result.reason}`,
    `**Model class:** ${result.modelClass} · reasoning ${result.reasoningEffort}`,
    `**Verification:** ${result.verification.length ? result.verification.join(", ") : "none"}`,
    `**Approval:** ${approval}`
  ].join("\n");
}
