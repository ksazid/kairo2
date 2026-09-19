import { NextResponse } from "next/server";
import { saveSettingsPresenter } from "../../../../lib/api";

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const brandId = text(body?.brandId, 200);
  if (!brandId) return NextResponse.json({ error: "Choose a Brand before saving a presenter." }, { status: 400 });
  try {
    const presenter = await saveSettingsPresenter(brandId, {
      displayName: text(body?.displayName, 120),
      status: body?.status,
      mode: body?.mode,
      visualStyle: text(body?.visualStyle, 240),
      voiceStyle: text(body?.voiceStyle, 240),
      background: text(body?.background, 240),
      ...(Number.isInteger(body?.expectedVersion) ? { expectedVersion: body?.expectedVersion } : {}),
    });
    return NextResponse.json(presenter);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not save this presenter." }, { status: 400 });
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
