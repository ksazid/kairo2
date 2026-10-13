import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBase = (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

export async function GET(request: Request) {
  const brandId = new URL(request.url).searchParams.get("brandId")?.trim();
  if (!brandId) return NextResponse.json({ error: "Choose a Brand first." }, { status: 400 });
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return NextResponse.json({ error: "Sign in to select production media." }, { status: 401 });
  try {
    const headers = { authorization: `Bearer ${token}` };
    const [librariesResponse, assetsResponse] = await Promise.all([
      fetch(`${apiBase}/api/v1/brands/${encodeURIComponent(brandId)}/content-asset-libraries`, { headers, cache: "no-store" }),
      fetch(`${apiBase}/api/v1/brands/${encodeURIComponent(brandId)}/content-assets?kind=image`, { headers, cache: "no-store" }),
    ]);
    if (!librariesResponse.ok || !assetsResponse.ok) throw new Error("Kairo could not load the Brand media library.");
    const [libraries, assets] = await Promise.all([librariesResponse.json(), assetsResponse.json()]);
    return NextResponse.json({ libraries, assets });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not load media." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const brandId = typeof body?.brandId === "string" ? body.brandId.trim() : "";
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId.trim() : "";
  const assetId = typeof body?.assetId === "string" ? body.assetId.trim() : "";
  const expectedVersion = body?.expectedVersion;
  const libraryAssetIds = body?.libraryAssetIds;
  if (!brandId || !campaignId || !assetId || !Number.isInteger(expectedVersion) || !Array.isArray(libraryAssetIds) || libraryAssetIds.length < 1 || libraryAssetIds.length > 12 || !libraryAssetIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "Choose between 1 and 12 image assets." }, { status: 400 });
  }
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return NextResponse.json({ error: "Sign in to attach production media." }, { status: 401 });
  try {
    const response = await fetch(`${apiBase}/api/v1/brands/${encodeURIComponent(brandId)}/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}/library-assets`, {
      method: "POST", cache: "no-store", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion, libraryAssetIds }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json({ error: payload?.detail ?? payload?.message ?? "Kairo could not attach these assets." }, { status: response.status });
    return NextResponse.json({ message: "Production media attached as a new version." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not attach media." }, { status: 502 });
  }
}
