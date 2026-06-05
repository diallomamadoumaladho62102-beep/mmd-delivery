import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessStripeMonitoring,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertCanAccessStripeMonitoring(request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 100), 1), 200);

    const { data, error } = await supabase
      .from("stripe_webhook_events")
      .select(
        "id, stripe_event_id, event_type, livemode, order_id, stripe_payment_intent_id, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
