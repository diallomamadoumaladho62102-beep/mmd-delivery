import { NextResponse } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { countStripeWebhookEvents24h } from "@/lib/stripeWebhookEventsHealth";

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
    const recent = await countStripeWebhookEvents24h(supabase);

    checks.recent_webhook_events_24h = recent.ok
      ? {
          ok: true,
          count: recent.count,
          column: recent.column,
          ...(recent.fallback ? { fallback: recent.fallback } : {}),
          ...(recent.warning ? { warning: recent.warning } : {}),
        }
      : { ok: false, error: recent.error || "count_failed" };
  } catch (e) {
    checks.recent_webhook_events_24h = {
      ok: false,
      error: e instanceof Error ? e.message : "check_failed",
    };
  }

  return NextResponse.json(checks, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
