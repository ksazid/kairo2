import { NextResponse } from "next/server";
import { viralConcept } from "../../../../lib/home";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { url?: unknown } | null;
  try {
    const concept = viralConcept(typeof body?.url === "string" ? body.url : "");
    return NextResponse.json({ concept });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kairo could not analyse that link." }, { status: 400 });
  }
}
