import { cookies } from "next/headers";
import type { HunterRunStatus } from "./discovery-status";
export type { HunterRunStatus } from "./discovery-status";

const apiBase = () => (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

export async function getLatestHunterRun(brandId?: string): Promise<HunterRunStatus | null | undefined> {
  if (!brandId) return undefined;
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return undefined;
  const response = await fetch(`${apiBase()}/api/v1/brands/${encodeURIComponent(brandId)}/hunter-runs/latest`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return undefined;
  return await response.json() as HunterRunStatus | null;
}
