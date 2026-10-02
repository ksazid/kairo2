import { cookies } from "next/headers";
import type { InsightCollectionStatus } from "./data-mode";
import type { LiveMetricRow } from "./insights-live";

const apiBase = () => (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

export async function getInstagramInsightCollectionStatus(brandId?: string): Promise<InsightCollectionStatus[] | undefined> {
  if (!brandId) return undefined;
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return undefined;
  const response = await fetch(`${apiBase()}/api/v1/brands/${encodeURIComponent(brandId)}/performance/instagram-insights`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return undefined;
  return await response.json() as InsightCollectionStatus[];
}


export async function getInsightsMetricData(brandId?: string): Promise<LiveMetricRow[]> {
  if (!brandId) return [];
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return [];
  const response = await fetch(`${apiBase()}/api/v1/brands/${encodeURIComponent(brandId)}/performance/insights-data`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  return await response.json() as LiveMetricRow[];
}
