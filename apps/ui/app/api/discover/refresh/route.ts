import { NextResponse } from "next/server";
import { getHomeOpportunities, runManualHunter } from "../../../../lib/api";
import { getBrandBrainActivation } from "../../../../lib/brand-brain-api";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const brandId = typeof body?.brandId === "string" ? body.brandId.trim().slice(0, 200) : "";
  if (!brandId) return NextResponse.json({ error: "Brand is required." }, { status: 400 });

  try {
    const run = await runManualHunter(brandId);
    const [opportunities, activation] = await Promise.all([
      getHomeOpportunities(brandId),
      getBrandBrainActivation(brandId),
    ]);
    return NextResponse.json({ run, opportunities, activation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not refresh discovery." }, { status: 400 });
  }
}
