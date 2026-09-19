import { NextResponse } from "next/server";
import { addBrandBrainSource, saveBrandBrainField, saveBrandDiscoveryTopic } from "../../../lib/brand-brain-api";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = text(body?.action, 40);
  const brandId = text(body?.brandId, 200);
  if (!brandId) return NextResponse.json({ error: "Choose a Brand first." }, { status: 400 });

  try {
    if (action === "edit-field") {
      const fieldKey = text(body?.fieldKey, 100);
      const section = text(body?.section, 40);
      const value = text(body?.value, 10_000);
      if (!fieldKey || !section || !value) return NextResponse.json({ error: "Field, section and value are required." }, { status: 400 });
      const expectedVersion = positiveInteger(body?.expectedVersion);
      const activation = await saveBrandBrainField({ brandId, fieldKey, section, value, ...(expectedVersion ? { expectedVersion } : {}) });
      return NextResponse.json(activation);
    }

    if (action === "add-source") {
      const url = publicHttpUrl(body?.url);
      if (!url) return NextResponse.json({ error: "Enter a valid public HTTP(S) URL." }, { status: 400 });
      const activation = await addBrandBrainSource({ brandId, url });
      return NextResponse.json(activation);
    }

    if (action === "edit-topic") {
      const topicId = text(body?.topicId, 100);
      const name = text(body?.name, 180);
      const audience = text(body?.audience, 240);
      const expectedRevision = positiveInteger(body?.expectedRevision);
      const entities = stringList(body?.entities, 12, 180);
      if (!topicId || !name || !audience || !expectedRevision || !entities.length) {
        return NextResponse.json({ error: "Topic, audience, search entities and current plan revision are required." }, { status: 400 });
      }
      const activation = await saveBrandDiscoveryTopic({ brandId, topicId, expectedRevision, name, audience, entities });
      return NextResponse.json(activation);
    }

    return NextResponse.json({ error: "Unsupported Brand Brain action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not update Brand Brain." }, { status: 400 });
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = text(item, maxLength);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function publicHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
