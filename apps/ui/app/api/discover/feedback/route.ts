import { NextResponse } from "next/server";
import { recordOpportunityFeedback, type OpportunityFeedbackAction } from "../../../../lib/api";

const actions = new Set<OpportunityFeedbackAction>([
  "opened", "saved", "dismissed", "not_relevant", "seen_before", "wrong_audience",
  "wrong_brand", "wrong_timing", "not_credible", "developed", "generated", "approved", "published",
]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const brandId = text(body?.brandId, 200);
  const opportunityId = text(body?.opportunityId, 200);
  const action = text(body?.action, 80) as OpportunityFeedbackAction;
  if (!brandId || !opportunityId || !actions.has(action)) {
    return NextResponse.json({ error: "Brand, opportunity and supported feedback action are required." }, { status: 400 });
  }
  try {
    const recorded = await recordOpportunityFeedback(brandId, opportunityId, action, {
      surface: text(body?.surface, 80) || "discover",
      ...(text(body?.rankingVersion, 120) ? { rankingVersion: text(body?.rankingVersion, 120) } : {}),
      ...(text(body?.reason, 500) ? { reason: text(body?.reason, 500) } : {}),
    });
    return NextResponse.json({ recorded });
  } catch {
    return NextResponse.json({ recorded: false });
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
