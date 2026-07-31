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
      namespace: "site-contact",
      key: ip,
      limit: 8,
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

    const name = String((body as { name?: unknown }).name ?? "").trim().slice(0, 120);
    const email = String((body as { email?: unknown }).email ?? "").trim().slice(0, 200);
    const phone = String((body as { phone?: unknown }).phone ?? "")
      .trim()
      .slice(0, 40);
    const subject = String((body as { subject?: unknown }).subject ?? "")
      .trim()
      .slice(0, 200);
    const message = String((body as { message?: unknown }).message ?? "")
      .trim()
      .slice(0, 5000);

    if (!name || !email || !message) {
      return NextResponse.json(
        { ok: false, error: "Name, email, and message are required" },
        { status: 400 },
      );
    }
    if (!isEmail(email)) {
      return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
    }

    const supabase = buildSupabaseAdminClient();
    const { error } = await supabase.from("site_contact_submissions").insert({
      name,
      email,
      phone: phone || null,
      subject: subject || null,
      message,
      status: "new",
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Unable to save submission" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
