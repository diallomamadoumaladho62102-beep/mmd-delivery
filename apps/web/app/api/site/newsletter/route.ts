import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: NextRequest) {
  try {
    const ip = getRequestClientIp(req.headers);
    const rate = checkRateLimit({
      namespace: "site-newsletter",
      key: ip,
      limit: 6,
      windowMs: 60_000,
    });
    if (rate.limited) {
      return NextResponse.json(
        { ok: false, error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const email = String((body as { email?: unknown }).email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const locale = String((body as { locale?: unknown }).locale ?? "en")
      .trim()
      .slice(0, 10) || "en";
    const source = String((body as { source?: unknown }).source ?? "website")
      .trim()
      .slice(0, 80) || "website";

    if (!email || !isEmail(email)) {
      return NextResponse.json({ ok: false, error: "Valid email required" }, { status: 400 });
    }

    const supabase = buildSupabaseAdminClient();
    const { error } = await supabase.from("site_newsletter_subscribers").upsert(
      {
        email,
        locale,
        source,
        status: "active",
      },
      { onConflict: "email" },
    );

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Unable to subscribe" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
