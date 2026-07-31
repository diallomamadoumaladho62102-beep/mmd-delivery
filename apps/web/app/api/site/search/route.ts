import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { searchPublishedContent } from "@/lib/siteCms";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ip = getRequestClientIp(req.headers);
    const rate = checkRateLimit({
      namespace: "site-search",
      key: ip,
      limit: 30,
      windowMs: 60_000,
    });
    if (rate.limited) {
      return NextResponse.json(
        { ok: false, error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
      );
    }

    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json({
        ok: true,
        query: q,
        pages: [],
        posts: [],
        faq: [],
      });
    }

    const supabase = buildSupabaseAdminClient();
    const results = await searchPublishedContent(supabase, q);
    return NextResponse.json({ ok: true, query: q, ...results });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
