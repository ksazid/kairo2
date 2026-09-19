import { cookies } from "next/headers";

export type MetaConnectionMode = "instagram" | "facebook-instagram" | "facebook";

export type MetaCandidate = {
  id: string;
  channel: "instagram" | "facebook";
  authMethod: "instagram-login" | "facebook-login";
  accountRef: string;
  displayName: string;
  pageName?: string;
  username?: string;
};

export type MetaConnectionResult =
  | { status: "selection-required"; intentId: string; brandId: string; candidates: MetaCandidate[] }
  | { status: "connected"; intentId: string; brandId: string }
  | { status: "no-eligible-account"; intentId: string; brandId: string };

export type InstagramCandidate = { id: string; pageRef: string; pageName: string; accountRef: string; displayName: string; username?: string };

export type InstagramConnectionResult =
  | { status: "selection-required"; intentId: string; brandId: string; candidates: InstagramCandidate[] }
  | { status: "connected"; intentId: string; brandId: string }
  | { status: "no-eligible-account"; intentId: string; brandId: string };

const apiBase = () => (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) throw new MetaConnectionError("Authentication is required", 401);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body != null) headers.set("content-type", "application/json");
  const response = await fetch(`${apiBase()}${path}`, { ...init, cache: "no-store", headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new MetaConnectionError(body?.detail ?? "Channel connection request failed", response.status);
  }
  return response.json() as Promise<T>;
}

export class MetaConnectionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function beginMetaConnection(brandId: string, mode: MetaConnectionMode) {
  return call<{ authorizationUrl: string }>(`/api/v1/brands/${encodeURIComponent(brandId)}/channels/meta/${encodeURIComponent(mode)}/connect`, { method: "POST" });
}

export function completeMetaConnection(mode: MetaConnectionMode, code: string, state: string) {
  return call<MetaConnectionResult>(`/api/v1/channels/meta/${encodeURIComponent(mode)}/callback`, { method: "POST", body: JSON.stringify({ code, state }) });
}

export function getMetaCandidates(brandId: string, intentId: string) {
  return call<MetaCandidate[]>(`/api/v1/brands/${encodeURIComponent(brandId)}/channels/meta/intents/${encodeURIComponent(intentId)}/candidates`);
}

export function selectMetaCandidate(brandId: string, intentId: string, candidateId: string) {
  return call(`/api/v1/brands/${encodeURIComponent(brandId)}/channels/meta/intents/${encodeURIComponent(intentId)}/select`, { method: "POST", body: JSON.stringify({ candidateId }) });
}

export function beginInstagramConnection(brandId: string) {
  return call<{ authorizationUrl: string }>(`/api/v1/brands/${encodeURIComponent(brandId)}/channels/instagram/connect`, { method: "POST" });
}

export function completeInstagramConnection(code: string, state: string) {
  return call<InstagramConnectionResult>("/api/v1/channels/instagram/callback", { method: "POST", body: JSON.stringify({ code, state }) });
}

export function getInstagramCandidates(brandId: string, intentId: string) {
  return call<InstagramCandidate[]>(`/api/v1/brands/${encodeURIComponent(brandId)}/channels/instagram/intents/${encodeURIComponent(intentId)}/candidates`);
}

export function selectInstagramCandidate(brandId: string, intentId: string, candidateId: string) {
  return call(`/api/v1/brands/${encodeURIComponent(brandId)}/channels/instagram/intents/${encodeURIComponent(intentId)}/select`, { method: "POST", body: JSON.stringify({ candidateId }) });
}

export function v2ChannelsHref(brandId: string) {
  return `/settings?tab=channels&brand=${encodeURIComponent(brandId)}`;
}

export function safeV2ChannelsHref(value: string | null | undefined, brandId: string) {
  const fallback = v2ChannelsHref(brandId);
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, "https://kairo.local");
    return parsed.pathname === "/settings" && parsed.searchParams.get("tab") === "channels" && parsed.searchParams.get("brand") === brandId
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
