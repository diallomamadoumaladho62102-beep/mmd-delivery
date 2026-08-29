import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getRequestClientIp(req.headers);
    const rate = checkRateLimit({
      namespace: "site-analytics",
      key: ip,
      limit: 20,
      windowMs: 60_000,
    });
    if (rate.limited) {
      return NextResponse.json(
        { ok: false, error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
      );
    }

    let body: unknown = null;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await req.json().catch(() => null);
    } else {
      const text = await req.text().catch(() => "");
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const event_name = String((body as { event_name?: unknown }).event_name ?? "")
      .trim()
      .slice(0, 80);
    const path = String((body as { path?: unknown }).path ?? "")
      .trim()
      .slice(0, 500);
    const session_id = String((body as { session_id?: unknown }).session_id ?? "")
      .trim()
      .slice(0, 120);
    const meta =
      (body as { meta?: unknown }).meta &&
      typeof (body as { meta?: unknown }).meta === "object"
        ? (body as { meta: object }).meta
        : {};

    if (!event_name) {
      return NextResponse.json(
        { ok: false, error: "event_name required" },
        { status: 400 },
      );
    }

    const supabase = buildSupabaseAdminClient();
    const { error } = await supabase.from("site_analytics_events").insert({
      event_name,
      path: path || null,
      meta,
      session_id: session_id || null,
    });

    if (error) {
      return NextResponse.json({ ok: false, error: "Unable to record" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
