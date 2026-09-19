import { NextResponse } from "next/server";
import { actOnHomeOpportunity } from "../../../../lib/api";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const brandId = text(body?.brandId, 200);
  const opportunityId = text(body?.opportunityId, 200);
  const action = body?.action === "save" || body?.action === "ignore" ? body.action : null;
  if (!brandId || !opportunityId || !action) return NextResponse.json({ error: "Brand, opportunity and action are required." }, { status: 400 });
  try {
    const opportunity = await actOnHomeOpportunity(brandId, opportunityId, action);
    return NextResponse.json({ opportunity });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not update this opportunity." }, { status: 400 });
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
