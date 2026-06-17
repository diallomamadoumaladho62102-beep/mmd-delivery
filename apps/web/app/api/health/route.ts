import { NextRequest, NextResponse } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isInternalHealthAuthorized } from "@/lib/internalHealthAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isInternalHealthAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks: Record<string, unknown> = {
    ok: true,
    time: new Date().toISOString(),
  };

  try {
    const supabase = buildSupabaseAdminClient();
    const { count, error } = await supabase
      .from("platform_countries")
      .select("country_code", { count: "exact", head: true });

    checks.platform_countries = error
      ? { ok: false, error: error.message }
      : { ok: true, count: count ?? 0 };
  } catch (e) {
    checks.platform_countries = {
      ok: false,
      error: e instanceof Error ? e.message : "check_failed",
    };
    checks.ok = false;
  }

  return NextResponse.json(checks, {
    status: checks.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
