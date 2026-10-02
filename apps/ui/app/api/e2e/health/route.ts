export function GET() {
  if (process.env.KAIRO_E2E !== "1") {
    return new Response(null, { status: 404 });
  }

  return Response.json({ ok: true });
}
