import http from "node:http";

const PORT = Number(process.env.KAIRO_E2E_STUB_PORT ?? 4189);
const workspace = { id: "ws-1", name: "Kairo E2E", role: "owner" };
const brands = [{ id: "brand-1", name: "Acme" }];

const baseOpportunities = [
  {
    id: "opp-ai",
    title: "AI workflows your team can use this week",
    rationale: "Useful operational guidance fits the Brand audience.",
    whyNow: "Teams are actively looking for practical AI workflows.",
    developmentDirection: "Turn the trend into a concise carousel with actionable examples.",
    status: "new",
    scores: { relevance: 0.94, audienceFit: 0.92, overall: 0.93 },
    details: {
      recommendedFormat: "carousel",
      recommendedChannel: "instagram",
      targetAudience: "Operations teams",
      objective: "Educate",
      source: "Hunter evidence"
    }
  },
  {
    id: "opp-trust",
    title: "How to build trust before customers compare providers",
    rationale: "Trust-building education aligns with the Brand position.",
    whyNow: "Comparison-led buyer journeys are increasing.",
    developmentDirection: "Create a practical proof-led post.",
    status: "saved",
    scores: { relevance: 0.87, audienceFit: 0.9, overall: 0.89 },
    details: {
      recommendedFormat: "image",
      recommendedChannel: "linkedin",
      targetAudience: "Prospective customers",
      objective: "Build trust",
      source: "Hunter evidence"
    }
  }
];

const opportunityStatus = new Map(baseOpportunities.map((item) => [item.id, item.status]));
let creationStarted = false;
let review = null;
let approval = null;
const commands = [];

function resetState() {
  brands.splice(1);
  for (const item of baseOpportunities) opportunityStatus.set(item.id, item.status);
  creationStarted = false;
  review = null;
  approval = null;
  commands.splice(0, commands.length);
}

const campaign = {
  id: "campaign-ai",
  workspaceId: workspace.id,
  brandId: "brand-1",
  ideaId: "idea-ai",
  name: "AI Workflow Education",
  objective: "Educate operations teams with practical AI workflows",
  status: "draft",
  createdAt: "2026-10-02T00:00:00Z"
};

const asset = {
  id: "asset-ai",
  campaignId: campaign.id,
  channel: "instagram",
  format: "carousel",
  audience: "Operations teams",
  topic: "AI workflows your team can use this week",
  hookType: "practical-guide",
  cta: "Save this workflow guide",
  currentVersion: 1,
  status: "draft",
  createdAt: "2026-10-02T00:00:00Z"
};

const version = {
  id: "version-ai-1",
  assetId: asset.id,
  version: 1,
  content: JSON.stringify({
    caption: "Five practical AI workflows your operations team can use this week.",
    slides: [
      "Start with one repeatable task",
      "Define the input clearly",
      "Add a human review point",
      "Measure the result",
      "Keep the workflow if it saves time"
    ]
  }),
  actor: "ai",
  createdAt: "2026-10-02T00:00:00Z",
  libraryAssetRefs: [{ kind: "image", previewRef: "/malta-car.webp" }]
};

const account = {
  id: "channel-instagram-1",
  channel: "instagram",
  accountRef: "ig-acme",
  displayName: "Acme Instagram",
  capabilities: ["publish-image", "publish-carousel", "publish-reel", "publish-video"],
  status: "connected"
};

function opportunities() {
  return baseOpportunities.map((item) => ({ ...item, status: opportunityStatus.get(item.id) ?? item.status }));
}

function campaignDetail() {
  return { campaign, assets: [{ asset, versions: [version] }] };
}

function activation(brandId) {
  return {
    brain: [],
    sources: [{ id: "src-1", type: "website", status: "active", title: "Public website", sourceUrl: "https://example.com" }],
    status: "ready-for-hunter",
    hunterReady: true,
    readiness: {
      status: "ready",
      score: 96,
      brandIntelligenceScore: 94,
      evidenceCoverage: 90,
      confidence: 0.95,
      gaps: []
    },
    completeness: { score: 100, knownGroups: 7, totalGroups: 7 },
    fields: [],
    weakFields: [],
    recommendedSources: [],
    evidenceSourceCount: 1,
    updatedAt: "2026-10-02T00:00:00Z",
    discoveryPlan: {
      schemaVersion: "1",
      workspaceId: workspace.id,
      brandId,
      revision: 1,
      planVersion: "plan-1",
      snapshotVersion: "snapshot-1",
      state: "initial",
      topics: [{
        id: "topic-1",
        name: "Practical AI workflows",
        priority: "High",
        audience: "Operations teams",
        entities: ["AI workflows", "automation"],
        sourceClasses: ["web"]
      }],
      excludedTopics: [],
      updatedAt: "2026-10-02T00:00:00Z"
    },
    discoveryRun: null,
    schedule: null
  };
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers
  });
  res.end(payload);
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

function brandIdFrom(pathname) {
  return pathname.match(/^\/api\/v1\/brands\/([^/]+)/)?.[1] ?? "brand-1";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/health") return send(res, 200, { ok: true });
  if (path === "/__e2e/reset" && req.method === "POST") {
    resetState();
    return send(res, 200, { ok: true });
  }

  if (path === "/api/v1/session" && req.method === "GET") {
    return send(res, 200, {
      account: { id: "acct-1", email: "e2e@kairo.local", displayName: "Kairo E2E" },
      workspaces: [workspace]
    });
  }

  if (path === `/api/v1/workspaces/${workspace.id}/brands`) {
    if (req.method === "GET") return send(res, 200, brands);
    if (req.method === "POST") {
      const input = await body(req);
      const id = `brand-${brands.length + 1}`;
      const created = { id, name: input.brandName || "New Brand", workspaceId: workspace.id };
      brands.push({ id, name: created.name });
      return send(res, 201, created);
    }
  }

  const brandId = brandIdFrom(path);

  if (/\/brain\/bootstrap$/.test(path) && req.method === "POST") {
    return send(res, 200, activation(brandId), { "x-kairo-runtime": "e2e-stub" });
  }
  if (/\/brain\/activation$/.test(path) && req.method === "GET") return send(res, 200, activation(brandId));
  if (/\/hunter-runs\/latest$/.test(path) && req.method === "GET") {
    return send(res, 200, {
      status: "completed",
      evidenceCount: 8,
      candidateCount: 5,
      opportunityCount: opportunities().length,
      sourcesScanned: ["web"],
      degradedSources: []
    });
  }

  if (/\/recommendations$/.test(path) && req.method === "POST") {
    return send(res, 200, { evidenceCount: 8, candidateCount: 5, opportunityCount: opportunities().length, degradedSources: [] });
  }

  if (/\/opportunities$/.test(path) && req.method === "GET") return send(res, 200, opportunities());

  const opportunityMatch = path.match(/\/opportunities\/([^/]+)\/(develop|development)$/);
  if (opportunityMatch && req.method === "POST") {
    const [, opportunityId, action] = opportunityMatch;
    if (action === "develop") {
      opportunityStatus.set(opportunityId, "developing");
      return send(res, 200, opportunities().find((item) => item.id === opportunityId));
    }
    return send(res, 200, { ideaId: "idea-ai" });
  }

  if (/\/opportunities\/[^/]+\/feedback\/[^/]+$/.test(path) && req.method === "POST") {
    return send(res, 200, { ok: true });
  }

  if (/\/simple-creations$/.test(path) && req.method === "POST") {
    creationStarted = true;
    return send(res, 202, {
      id: "creation-ai",
      status: "queued",
      progress: { message: "Starting content generation…" }
    });
  }

  if (/\/simple-creations\/creation-ai$/.test(path) && req.method === "GET") {
    return send(res, 200, {
      id: "creation-ai",
      status: "ready",
      progress: { message: "Content ready for review." },
      campaignId: campaign.id,
      assetId: asset.id
    });
  }

  if (/\/campaigns$/.test(path) && req.method === "GET") {
    return send(res, 200, creationStarted ? [campaign] : []);
  }

  if (path.endsWith(`/campaigns/${campaign.id}`) && req.method === "GET") {
    return send(res, 200, campaignDetail());
  }

  if (/\/ideas$/.test(path) && req.method === "GET") return send(res, 200, []);
  if (/\/learnings$/.test(path) && req.method === "GET") return send(res, 200, []);
  if (/\/calendar$/.test(path) && req.method === "GET") return send(res, 200, commands);
  if (/\/channel-accounts$/.test(path) && req.method === "GET") return send(res, 200, [account]);

  if (path.endsWith(`/assets/${asset.id}/review-status`) && req.method === "GET") {
    return send(res, 200, { review, approval });
  }

  if (path.endsWith(`/campaigns/${campaign.id}/assets/${asset.id}/review`) && req.method === "POST") {
    review = {
      versionId: version.id,
      status: "passed",
      truth: { findings: [] },
      critic: { score: 0.96, findings: [] }
    };
    return send(res, 200, review);
  }

  if (path.endsWith(`/campaigns/${campaign.id}/assets/${asset.id}/approve`) && req.method === "POST") {
    const input = await body(req);
    approval = {
      versionId: version.id,
      approvedAt: "2026-10-02T00:10:00Z",
      destination: input.destination ?? { channel: account.channel, accountRef: account.accountRef }
    };
    return send(res, 200, approval);
  }

  if (path.endsWith(`/campaigns/${campaign.id}/assets/${asset.id}/schedule`) && req.method === "POST") {
    const input = await body(req);
    const command = {
      assetId: asset.id,
      versionId: version.id,
      scheduledFor: input.scheduledFor,
      status: "scheduled",
      createdAt: "2026-10-02T00:12:00Z"
    };
    commands.splice(0, commands.length, command);
    return send(res, 200, command);
  }

  return send(res, 404, { detail: `Unhandled E2E stub route: ${req.method} ${path}` });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Kairo E2E stub listening on http://127.0.0.1:${PORT}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
