import { NextResponse } from "next/server";
import { getHomeCreation, startHomeCreation } from "../../../../lib/api";
import { creationDestination, normalizeCreationFormat, viralConcept } from "../../../../lib/home";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const brandId = text(body?.brandId, 200);
  if (!brandId) return NextResponse.json({ error: "Choose a Brand first." }, { status: 400 });
  const source = text(body?.source, 2000);
  try {
    if (source) viralConcept(source);
    const opportunityId = text(body?.opportunityId, 200);
    const creation = await startHomeCreation({
      brandId,
      format: normalizeCreationFormat(text(body?.format, 30)),
      ...(opportunityId ? { opportunityId } : {}),
      ...(text(body?.title, 4000) ? { title: text(body?.title, 4000) } : {}),
      ...(text(body?.direction, 4000) ? { direction: text(body?.direction, 4000) } : {}),
      ...(source ? { source } : {}),
    });
    return NextResponse.json({ creationId: creation.id, status: creation.status }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not start this creation." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const brandId = text(query.get("brandId"), 200);
  const creationId = text(query.get("creationId"), 200);
  if (!brandId || !creationId) return NextResponse.json({ error: "Brand and creation are required." }, { status: 400 });
  try {
    const creation = await getHomeCreation(brandId, creationId);
    return NextResponse.json({
      status: creation.status,
      message: creation.status === "needs-attention" ? creation.failureReason ?? creation.progress.message : creation.progress.message,
      ...(creation.campaignId ? { campaignId: creation.campaignId } : {}),
      ...(creation.assetId ? { assetId: creation.assetId } : {}),
      ...(creation.status === "ready" ? { destination: creationDestination(brandId, creation) } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not read this creation." }, { status: 502 });
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
