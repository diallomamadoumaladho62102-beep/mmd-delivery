import { NextResponse } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANONICAL_WEBHOOK_URL = "https://www.mmddelivery.com/api/stripe/webhook";

export async function GET() {
  const checks: Record<string, unknown> = {
    ok: true,
    canonical_webhook_url: CANONICAL_WEBHOOK_URL,
    edge_webhook_must_be_disabled: true,
    edge_disable_env: "MMD_STRIPE_WEBHOOK_DISABLED=true",
    vercel_handler: "apps/web/app/api/stripe/webhook/route.ts",
    time: new Date().toISOString(),
  };

  try {
    const supabase = buildSupabaseAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from("stripe_webhook_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);

    checks.recent_webhook_events_24h = error
      ? { ok: false, error: error.message }
      : { ok: true, count: count ?? 0 };

    if (error) {
      checks.ok = false;
    }
  } catch (e) {
    checks.recent_webhook_events_24h = {
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
