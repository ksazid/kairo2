import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBase = (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

async function proxy(request: Request, method: "GET" | "POST" | "PATCH") {
  const input = method === "GET" ? Object.fromEntries(new URL(request.url).searchParams) : await request.json().catch(() => null);
  const { brandId, campaignId, assetId, action, projectId, slideId, ...payload } = (input ?? {}) as Record<string, unknown>;
  if (![brandId, campaignId, assetId].every(value => typeof value === "string" && value.length > 0 && value.length < 201)) return NextResponse.json({ error: "Brand, campaign and asset are required." }, { status: 400 });
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return NextResponse.json({ error: "Sign in to review this carousel." }, { status: 401 });
  const base = `/api/v1/brands/${encodeURIComponent(brandId as string)}/campaigns/${encodeURIComponent(campaignId as string)}/assets/${encodeURIComponent(assetId as string)}/carousel-review`;
  let path = base;
  let verb: string = method;
  let body: unknown = payload;
  if (action === "bootstrap") { path += "/bootstrap"; verb = "POST"; body = {}; }
  else if (action === "edit") { path += `/slides/${encodeURIComponent(String(slideId ?? ""))}/text`; verb = "PATCH"; body = { expectedAssetVersion: payload.expectedAssetVersion, headline: payload.headline, body: payload.body }; }
  else if (action === "render") { path = `/api/v1/brands/${encodeURIComponent(brandId as string)}/carousel-projects/${encodeURIComponent(String(projectId ?? ""))}/render`; verb = "POST"; body = { expectedAssetVersion: payload.expectedAssetVersion }; }
  else if (action === "delivery") { path = `/api/v1/brands/${encodeURIComponent(brandId as string)}/carousel-projects/${encodeURIComponent(String(projectId ?? ""))}/rendered-asset-versions/${encodeURIComponent(String(payload.versionId ?? ""))}/temporary-delivery`; verb = "POST"; body = {}; }
  else if (action === "approve") { path += "/approve"; verb = "POST"; body = { expectedAssetVersion: payload.expectedAssetVersion, renderVersionId: payload.renderVersionId }; }
  else if (method !== "GET") return NextResponse.json({ error: "Unsupported carousel action." }, { status: 400 });
  try {
    const response = await fetch(`${apiBase}${path}`, { method: verb, cache: "no-store", headers: { authorization: `Bearer ${token}`, ...(verb === "GET" ? {} : { "content-type": "application/json" }) }, ...(verb === "GET" ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => null);
    return NextResponse.json(response.ok ? result : { error: result?.detail ?? result?.message ?? result?.error ?? "Carousel request failed." }, { status: response.status });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Carousel request failed." }, { status: 502 }); }
}

export const GET = (request: Request) => proxy(request, "GET");
export const POST = (request: Request) => proxy(request, "POST");
