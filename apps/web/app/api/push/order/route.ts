import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
} as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: JSON_HEADERS,
  });
}

/** @deprecated Use POST /api/push/send with participant context validation. */
export async function POST() {
  return json(
    {
      ok: false,
      error: "deprecated_use_push_send",
      message: "Use POST /api/push/send with user_id, context_type, and context_id.",
    },
    410,
  );
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
