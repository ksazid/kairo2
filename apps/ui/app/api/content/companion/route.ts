import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBase = (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const brandId = typeof body?.brandId === "string" ? body.brandId : "";
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : "";
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
  if (!brandId || !campaignId || brandId.length > 200 || campaignId.length > 200 || !caption || caption.length > 5000) return NextResponse.json({ error: "Campaign and caption are required." }, { status: 400 });
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return NextResponse.json({ error: "Sign in to create campaign content." }, { status: 401 });
  try {
    const response = await fetch(`${apiBase}/api/v1/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(campaignId)}/assets`, {
      method: "POST", cache: "no-store", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "instagram", format: "carousel", audience: "Duke 390 riders", topic: "Duke 390 pre-ride checklist", hookType: "practical-checklist", cta: "Save this checklist and consult your model's owner manual", content: caption }),
    });
    const detail = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json({ error: detail?.detail ?? "Kairo could not create the carousel asset." }, { status: response.status });
    const asset = detail?.assets?.findLast((entry: { asset?: { format?: string } }) => entry.asset?.format === "carousel")?.asset;
    return NextResponse.json({ assetId: asset?.id });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not create the carousel asset." }, { status: 502 }); }
}
