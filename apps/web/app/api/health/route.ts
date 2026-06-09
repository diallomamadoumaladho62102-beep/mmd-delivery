import { NextResponse } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, unknown> = {
    ok: true,
    time: new Date().toISOString(),
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
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
