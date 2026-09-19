import { cookies } from "next/headers";
import { getHomeData } from "./api";
import type { BrandBrainRuntimeData } from "./brand-brain-runtime";

const apiBase = () => (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

export interface BrandBrainPageData {
  authenticated: boolean;
  brandId?: string;
  brandName: string;
  activation?: BrandBrainRuntimeData;
}

async function accessToken() {
  return (await cookies()).get("kairo_access_token")?.value ?? null;
}

function api(token: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body != null) headers.set("content-type", "application/json");
  return fetch(`${apiBase()}${path}`, { ...init, cache: "no-store", headers });
}

async function bodyOrError<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? fallback);
  }
  return response.json() as Promise<T>;
}

export async function getBrandBrainData(requestedBrandId?: string): Promise<BrandBrainPageData> {
  const identity = await getHomeData(requestedBrandId);
  if (!identity.authenticated || !identity.brandId) return { authenticated: identity.authenticated, brandName: identity.brandName };
  const token = await accessToken();
  if (!token) return { authenticated: false, brandName: identity.brandName };
  const response = await api(token, `/api/v1/brands/${encodeURIComponent(identity.brandId)}/brain/activation`);
  if (!response.ok) return { authenticated: true, brandId: identity.brandId, brandName: identity.brandName };
  const activation = await response.json() as BrandBrainRuntimeData;
  return { authenticated: true, brandId: identity.brandId, brandName: identity.brandName, activation };
}

export async function getBrandBrainActivation(brandId: string): Promise<BrandBrainRuntimeData> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to refresh Brand Brain.");
  return bodyOrError<BrandBrainRuntimeData>(
    await api(token, `/api/v1/brands/${encodeURIComponent(brandId)}/brain/activation`),
    "Kairo could not refresh Brand Brain.",
  );
}

export async function saveBrandBrainField(input: {
  brandId: string;
  fieldKey: string;
  section: string;
  value: string;
  expectedVersion?: number;
}): Promise<BrandBrainRuntimeData> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to edit Brand Brain.");
  const brand = encodeURIComponent(input.brandId);
  const field = encodeURIComponent(input.fieldKey);
  await bodyOrError(await api(token, `/api/v1/brands/${brand}/brain/${field}`, {
    method: "PUT",
    body: JSON.stringify({ section: input.section, value: input.value, ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}) }),
  }), "Kairo could not save this Brand Brain field.");
  return bodyOrError<BrandBrainRuntimeData>(await api(token, `/api/v1/brands/${brand}/brain/activation`), "Kairo could not refresh Brand Brain.");
}

export async function addBrandBrainSource(input: { brandId: string; url: string }): Promise<BrandBrainRuntimeData> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to add a Brand source.");
  const brand = encodeURIComponent(input.brandId);
  await bodyOrError(await api(token, `/api/v1/brands/${brand}/sources`, {
    method: "POST",
    body: JSON.stringify({ type: "url", url: input.url }),
  }), "Kairo could not add this source.");
  await bodyOrError(await api(token, `/api/v1/brands/${brand}/brain/bootstrap`, {
    method: "POST",
    body: JSON.stringify({ publicReferenceUrl: input.url }),
  }), "The source was saved, but Kairo could not recalculate Brand Brain from it.");
  return bodyOrError<BrandBrainRuntimeData>(await api(token, `/api/v1/brands/${brand}/brain/activation`), "Kairo could not refresh Brand Brain.");
}

export async function saveBrandDiscoveryTopic(input: {
  brandId: string;
  topicId: string;
  expectedRevision: number;
  name: string;
  audience: string;
  entities: string[];
}): Promise<BrandBrainRuntimeData> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to edit Discovery Intelligence.");
  const brand = encodeURIComponent(input.brandId);
  const topic = encodeURIComponent(input.topicId);
  await bodyOrError(await api(token, `/api/v1/brands/${brand}/discovery-plan/topics/${topic}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedRevision: input.expectedRevision, name: input.name, audience: input.audience, entities: input.entities }),
  }), "Kairo could not save this Discovery topic.");
  return bodyOrError<BrandBrainRuntimeData>(await api(token, `/api/v1/brands/${brand}/brain/activation`), "Kairo could not refresh Discovery Intelligence.");
}
